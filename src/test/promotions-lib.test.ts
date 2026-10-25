import { beforeEach, describe, expect, it, vi } from "vitest";

// Promotions : statut calculé à partir des dates, réduction annoncée, lecture publique, écritures administrateur, formulaire et visuels.
// Faux client Supabase : on vérifie les requêtes envoyées (table, filtres, données) et la gestion des réponses. Aucun appel réseau.
const h = vi.hoisted(() => {
  type Reply = { data: unknown; error: null | { message?: string; code?: string; status?: number } };
  type Call = { table: string; op: "select" | "insert" | "update" | "delete"; cols: string; payload?: Record<string, unknown>; filters: [string, unknown][]; order?: [string, unknown] };
  const state = {
    calls: [] as Call[], reply: ((): Reply => ({ data: [], error: null })) as (c: Call) => Reply,
    storage: { uploads: [] as string[], removed: [] as string[], uploadError: null as null | { message: string } },
  };
  const client = {
    from: (table: string) => {
      const call: Call = { table, op: "select", cols: "", filters: [] };
      const b: Record<string, unknown> = {
        select: (cols: string) => { call.cols = cols; return b; },
        order: (col: string, o?: unknown) => { call.order = [col, o]; return b; },
        is: (col: string, v: unknown) => { call.filters.push([`is:${col}`, v]); return b; },
        eq: (col: string, v: unknown) => { call.filters.push([col, v]); return b; },
        insert: (p: Record<string, unknown>) => { call.op = "insert"; call.payload = p; return b; },
        update: (p: Record<string, unknown>) => { call.op = "update"; call.payload = p; return b; },
        delete: () => { call.op = "delete"; return b; },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
          state.calls.push(call);
          try { return Promise.resolve(state.reply(call)).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); }
        },
      };
      return b;
    },
    storage: {
      from: () => ({
        upload: async (path: string) => { if (state.storage.uploadError) return { error: state.storage.uploadError }; state.storage.uploads.push(path); return { error: null }; },
        remove: async (paths: string[]) => { state.storage.removed.push(...paths); return { error: null }; },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/catalog-images/${path}` } }),
      }),
    },
  };
  return { state, client };
});

vi.mock("@/lib/supabase", () => ({ adminSupabase: h.client, supabase: h.client }));
vi.mock("@/lib/images", () => ({ compressImage: async () => new Blob(["x"], { type: "image/webp" }) }));

import { AdminError } from "@/lib/admin-api";
import { removePromotionImage, uploadPromotionImage } from "@/lib/admin-images";
import {
  PromotionsNotInstalledError, createAdminPromotion, deleteAdminPromotion, emptyPromotionForm, formToPromotionInput, listAdminPromotions,
  promotionFormSchema, promotionToForm, setPromotionPublication, toRowValues, updateAdminPromotion, type PromotionFormValues, type PromotionInput,
} from "@/lib/admin-promotions";
import {
  PROMO_NOTICE, discountPercent, fetchPublicPromotions, fromRow, isPublic, periodLabel, promotionStatus, promotionTarget, type Promotion, type PromotionRow,
} from "@/lib/promotions";

const TODAY = "2026-10-25";
const row = (o: Partial<PromotionRow> = {}): PromotionRow => ({
  id: "p1", title: "Massage -30 %", description: null, image_url: null, kind: "announcement", original_price_fcfa: null, promo_price_fcfa: null,
  percent_off: null, starts_on: null, ends_on: null, status: "published", service_id: null, product_id: null, deleted_at: null,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...o,
});
const promo = (o: Partial<PromotionRow> = {}): Promotion => fromRow(row(o));
const ok = (data: unknown) => ({ data, error: null });

beforeEach(() => {
  h.state.calls = []; h.state.reply = () => ok([]);
  h.state.storage.uploads = []; h.state.storage.removed = []; h.state.storage.uploadError = null;
});

describe("statut calculé", () => {
  const st = (publication: PromotionRow["status"], s: string | null, e: string | null) => promotionStatus(promo({ status: publication, starts_on: s, ends_on: e }), TODAY);

  it("brouillon et désactivée : jamais actifs, quelles que soient les dates", () => {
    for (const [s, e] of [[null, null], ["2026-10-01", "2026-12-01"], ["2026-12-01", null], [null, "2026-01-01"]] as const) {
      expect(st("draft", s, e)).toBe("draft");
      expect(st("disabled", s, e)).toBe("disabled");
    }
  });
  it("publiée sans aucune date : active", () => { expect(st("published", null, null)).toBe("active"); });
  it("publiée, début seul : programmée avant, active à partir du jour J", () => {
    expect(st("published", "2026-10-26", null)).toBe("scheduled");
    expect(st("published", "2026-10-25", null)).toBe("active");
    expect(st("published", "2026-01-01", null)).toBe("active");
  });
  it("publiée, fin seule : active jusqu'au jour J INCLUS, expirée le lendemain", () => {
    expect(st("published", null, "2026-10-25")).toBe("active");
    expect(st("published", null, "2026-10-24")).toBe("expired");
    expect(st("published", null, "2030-01-01")).toBe("active");
  });
  it("publiée avec période : programmée, active (bornes incluses) puis expirée", () => {
    expect(st("published", "2026-10-26", "2026-11-01")).toBe("scheduled");
    expect(st("published", "2026-10-25", "2026-10-25")).toBe("active");
    expect(st("published", "2026-10-20", "2026-10-30")).toBe("active");
    expect(st("published", "2026-10-01", "2026-10-24")).toBe("expired");
  });
  it("une promotion publiée hors période n'est JAMAIS active", () => {
    expect(st("published", "2027-01-01", "2027-02-01")).not.toBe("active");
    expect(st("published", "2025-01-01", "2025-02-01")).not.toBe("active");
  });
});

describe("visibilité publique", () => {
  it("seules les promotions actives et non supprimées sont publiques", () => {
    expect(isPublic(promo(), TODAY)).toBe(true);
    expect(isPublic(promo({ deleted_at: "2026-10-02T00:00:00Z" }), TODAY)).toBe(false);
    expect(isPublic(promo({ status: "draft" }), TODAY)).toBe(false);
    expect(isPublic(promo({ status: "disabled" }), TODAY)).toBe(false);
    expect(isPublic(promo({ starts_on: "2026-11-01" }), TODAY)).toBe(false);
    expect(isPublic(promo({ ends_on: "2026-10-01" }), TODAY)).toBe(false);
  });
});

describe("réduction et prix annoncés", () => {
  it("type prix : calculée à partir des DEUX prix saisis", () => {
    expect(discountPercent(promo({ kind: "price", original_price_fcfa: 20000, promo_price_fcfa: 15000 }))).toBe(25);
    expect(discountPercent(promo({ kind: "price", original_price_fcfa: 15000, promo_price_fcfa: 10000 }))).toBe(33);
    expect(discountPercent(promo({ kind: "price", original_price_fcfa: 5000, promo_price_fcfa: 0 }))).toBe(100);
  });
  it("type prix : réduction inférieure à 1 % ou prix incohérents -> pas de pastille", () => {
    expect(discountPercent(promo({ kind: "price", original_price_fcfa: 100000, promo_price_fcfa: 99999 }))).toBeNull();
    expect(discountPercent(promo({ kind: "price", original_price_fcfa: 1000, promo_price_fcfa: 1000 }))).toBeNull();
    expect(discountPercent(promo({ kind: "price", original_price_fcfa: 1000, promo_price_fcfa: null }))).toBeNull();
  });
  it("type pourcentage : le pourcentage saisi ; annonce : aucune réduction", () => {
    expect(discountPercent(promo({ kind: "percent", percent_off: 20 }))).toBe(20);
    expect(discountPercent(promo({ kind: "announcement" }))).toBeNull();
  });
  it("la mention d'information précise que le prix n'est pas appliqué automatiquement", () => {
    expect(PROMO_NOTICE).toMatch(/pas appliqué automatiquement/);
    expect(PROMO_NOTICE).toMatch(/réservation/);
  });
});

describe("période et cible", () => {
  it("libellés de période", () => {
    expect(periodLabel(promo())).toBeNull();
    expect(periodLabel(promo({ starts_on: "2026-11-01", ends_on: "2026-11-30" }))).toBe("Du 1 novembre 2026 au 30 novembre 2026");
    expect(periodLabel(promo({ starts_on: "2026-11-01" }))).toBe("À partir du 1 novembre 2026");
    expect(periodLabel(promo({ ends_on: "2026-11-30" }))).toBe("Jusqu’au 30 novembre 2026");
    expect(periodLabel(promo({ starts_on: "2026-11-05", ends_on: "2026-11-05" }))).toBe("Le 5 novembre 2026");
  });
  it("cible : prestation, produit ou rien", () => {
    expect(promotionTarget(promo({ service_id: "pedicure" }))).toEqual({ kind: "service", id: "pedicure" });
    expect(promotionTarget(promo({ product_id: "creme" }))).toEqual({ kind: "product", id: "creme" });
    expect(promotionTarget(promo())).toBeNull();
  });
});

describe("lecture publique (fetchPublicPromotions)", () => {
  it("un administrateur lit aussi les brouillons, programmées, expirées, désactivées et supprimées : le public n'en voit aucune", async () => {
    h.state.reply = () => ok([
      row({ id: "a", title: "Active" }), row({ id: "b", status: "draft" }), row({ id: "c", status: "disabled" }),
      row({ id: "d", starts_on: "2099-01-01" }), row({ id: "e", ends_on: "2000-01-01" }), row({ id: "f", deleted_at: "2026-01-01T00:00:00Z" }),
    ]);
    expect((await fetchPublicPromotions(TODAY)).map((p) => p.id)).toEqual(["a"]);
  });
  it("lit la table promotions, la plus récente d'abord, et rien d'autre", async () => {
    await fetchPublicPromotions(TODAY);
    expect(h.state.calls).toHaveLength(1);
    expect(h.state.calls[0]).toMatchObject({ table: "promotions", op: "select", order: ["created_at", { ascending: false }] });
  });
  it("table absente (migration non appliquée) : liste vide, pas d'erreur", async () => {
    for (const error of [{ code: "42P01" }, { code: "PGRST205" }, { status: 404, message: "relation \"public.promotions\" does not exist" }]) {
      h.state.reply = () => ({ data: null, error });
      await expect(fetchPublicPromotions(TODAY)).resolves.toEqual([]);
    }
  });
  it("autre erreur : levée (la page propose de réessayer)", async () => {
    h.state.reply = () => ({ data: null, error: { message: "boom", code: "XX000" } });
    await expect(fetchPublicPromotions(TODAY)).rejects.toThrow();
  });
});

describe("administration : lecture", () => {
  it("exclut les promotions supprimées (suppression logique) et trie par date de création décroissante", async () => {
    h.state.reply = () => ok([row({ id: "x" })]);
    const out = await listAdminPromotions();
    expect(out.map((p) => p.id)).toEqual(["x"]);
    expect(h.state.calls[0]).toMatchObject({ table: "promotions", filters: [["is:deleted_at", null]], order: ["created_at", { ascending: false }] });
  });
  it("table absente : PromotionsNotInstalledError ; autre erreur : pas confondue", async () => {
    h.state.reply = () => ({ data: null, error: { code: "42P01" } });
    await expect(listAdminPromotions()).rejects.toBeInstanceOf(PromotionsNotInstalledError);
    h.state.reply = () => ({ data: null, error: { message: "Failed to fetch" } });
    const e = await listAdminPromotions().catch((x) => x);
    expect(e).toBeInstanceOf(AdminError);
    expect(e).not.toBeInstanceOf(PromotionsNotInstalledError);
  });
});

const input = (o: Partial<PromotionInput> = {}): PromotionInput => ({
  title: "Massage -30 %", description: "", kind: "announcement", originalPrice: null, promoPrice: null, percentOff: null,
  startsOn: null, endsOn: null, publication: "draft", serviceId: null, productId: null, ...o,
});

describe("administration : écriture", () => {
  it("les champs qui ne concernent pas le type sont vidés (contrainte de la base)", () => {
    expect(toRowValues(input({ kind: "announcement", originalPrice: 10, promoPrice: 5, percentOff: 50 }))).toMatchObject({ original_price_fcfa: null, promo_price_fcfa: null, percent_off: null });
    expect(toRowValues(input({ kind: "percent", originalPrice: 10, promoPrice: 5, percentOff: 50 }))).toMatchObject({ original_price_fcfa: null, promo_price_fcfa: null, percent_off: 50 });
    expect(toRowValues(input({ kind: "price", originalPrice: 20000, promoPrice: 15000, percentOff: 50 }))).toMatchObject({ original_price_fcfa: 20000, promo_price_fcfa: 15000, percent_off: null });
  });
  it("création : insertion dans promotions avec l'identifiant fourni, rien dans services, products ni bookings", async () => {
    await createAdminPromotion("11111111-1111-4111-8111-111111111111", input({ kind: "price", originalPrice: 20000, promoPrice: 15000, serviceId: "pedicure" }));
    expect(h.state.calls).toHaveLength(1);
    expect(h.state.calls[0]).toMatchObject({ table: "promotions", op: "insert", payload: { id: "11111111-1111-4111-8111-111111111111", title: "Massage -30 %", original_price_fcfa: 20000, promo_price_fcfa: 15000, service_id: "pedicure", status: "draft" } });
  });
  it("création rejouée après une réponse perdue (identifiant déjà présent) : considérée comme faite, sans erreur", async () => {
    h.state.reply = () => ({ data: null, error: { code: "23505", message: "duplicate key" } });
    await expect(createAdminPromotion("11111111-1111-4111-8111-111111111111", input())).resolves.toEqual({ id: "11111111-1111-4111-8111-111111111111" });
  });
  it("création refusée par la base : message exploitable", async () => {
    h.state.reply = () => ({ data: null, error: { code: "23514", message: "check" } });
    await expect(createAdminPromotion("11111111-1111-4111-8111-111111111111", input())).rejects.toThrow(/refusées par la base/);
    h.state.reply = () => ({ data: null, error: { code: "23503", message: "fk" } });
    await expect(createAdminPromotion("11111111-1111-4111-8111-111111111111", input())).rejects.toThrow(/n'existe plus/);
    h.state.reply = () => ({ data: null, error: { code: "42501", message: "rls" } });
    await expect(createAdminPromotion("11111111-1111-4111-8111-111111111111", input())).rejects.toMatchObject({ code: "forbidden" });
  });
  it("modification : update ciblé par identifiant, sur une promotion non supprimée ; aucune ligne touchée = erreur", async () => {
    h.state.reply = () => ok([{ id: "p1" }]);
    await updateAdminPromotion("p1", input({ title: "Nouveau titre" }));
    expect(h.state.calls[0]).toMatchObject({ op: "update", filters: [["id", "p1"], ["is:deleted_at", null]], payload: { title: "Nouveau titre" } });
    h.state.reply = () => ok([]);
    await expect(updateAdminPromotion("p1", input())).rejects.toThrow(/rien n'a été modifié/);
  });
  it("activer / désactiver : seul le statut de publication change", async () => {
    h.state.reply = () => ok([{ id: "p1" }]);
    await setPromotionPublication("p1", "disabled");
    await setPromotionPublication("p1", "published");
    expect(h.state.calls.map((c) => c.payload)).toEqual([{ status: "disabled" }, { status: "published" }]);
    h.state.reply = () => ok([]);
    await expect(setPromotionPublication("p1", "published")).rejects.toThrow(/rien n'a été modifié/);
  });
  it("suppression LOGIQUE : un update de deleted_at, jamais de DELETE", async () => {
    h.state.reply = () => ok([{ id: "p1" }]);
    await deleteAdminPromotion("p1");
    expect(h.state.calls).toHaveLength(1);
    expect(h.state.calls[0]!.op).toBe("update");
    expect(Object.keys(h.state.calls[0]!.payload!)).toEqual(["deleted_at"]);
    expect(typeof h.state.calls[0]!.payload!["deleted_at"]).toBe("string");
    expect(h.state.calls.some((c) => c.op === "delete")).toBe(false);
    h.state.reply = () => ok([]);
    await expect(deleteAdminPromotion("p1")).rejects.toThrow(/rien n'a été modifié/);
  });
  it("aucune écriture hors de la table promotions", async () => {
    h.state.reply = () => ok([{ id: "p1" }]);
    await createAdminPromotion("11111111-1111-4111-8111-111111111111", input());
    await updateAdminPromotion("p1", input());
    await setPromotionPublication("p1", "disabled");
    await deleteAdminPromotion("p1");
    expect(new Set(h.state.calls.map((c) => c.table))).toEqual(new Set(["promotions"]));
  });
});

describe("formulaire", () => {
  const valid: PromotionFormValues = { ...emptyPromotionForm, title: "Massage -30 %" };
  const issues = (o: Partial<PromotionFormValues>) => {
    const r = promotionFormSchema.safeParse({ ...valid, ...o });
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}`);
  };
  const has = (o: Partial<PromotionFormValues>, field: string) => expect(issues(o)).toContain(field);

  it("annonce minimale valide : titre seul", () => { expect(issues({})).toEqual([]); });
  it("titre obligatoire (2 à 120 caractères)", () => { has({ title: "" }, "title"); has({ title: " a " }, "title"); has({ title: "x".repeat(121) }, "title"); });
  it("description limitée à 1 000 caractères", () => { has({ description: "x".repeat(1001) }, "description"); expect(issues({ description: "x".repeat(1000) })).toEqual([]); });
  it("type prix : les deux prix sont obligatoires, entiers, et le prix promotionnel est inférieur au prix initial", () => {
    const p = (originalPrice: string, promoPrice: string) => ({ kind: "price" as const, originalPrice, promoPrice });
    has(p("", "10"), "originalPrice"); has(p("100", ""), "promoPrice");
    has(p("abc", "10"), "originalPrice"); has(p("100", "1,5"), "promoPrice"); has(p("0", "0"), "originalPrice"); has(p("-5", "1"), "originalPrice");
    has(p("100", "100"), "promoPrice"); has(p("100", "200"), "promoPrice"); has(p("999999999", "1"), "originalPrice");
    expect(issues(p("20 000", "15 000"))).toEqual([]);
    expect(issues(p("5000", "0"))).toEqual([]);
  });
  it("type prix : les prix d'un autre type sont ignorés (pas de faux refus)", () => {
    expect(issues({ kind: "announcement", originalPrice: "abc", promoPrice: "x", percentOff: "999" })).toEqual([]);
    expect(issues({ kind: "percent", percentOff: "20", originalPrice: "abc" })).toEqual([]);
  });
  it("type pourcentage : entier de 1 à 99", () => {
    for (const bad of ["", "0", "100", "-5", "12,5", "abc"]) has({ kind: "percent", percentOff: bad }, "percentOff");
    for (const good of ["1", "20", "99"]) expect(issues({ kind: "percent", percentOff: good })).toEqual([]);
  });
  it("dates : facultatives, valides, fin non antérieure au début ; début = fin accepté", () => {
    expect(issues({ startsOn: "", endsOn: "" })).toEqual([]);
    expect(issues({ startsOn: "2026-11-01", endsOn: "" })).toEqual([]);
    expect(issues({ startsOn: "", endsOn: "2026-11-01" })).toEqual([]);
    expect(issues({ startsOn: "2026-11-01", endsOn: "2026-11-01" })).toEqual([]);
    has({ startsOn: "2026-11-02", endsOn: "2026-11-01" }, "endsOn");
    has({ startsOn: "31/10/2026" }, "startsOn"); has({ endsOn: "2026-02-31" }, "endsOn"); has({ startsOn: "2026-13-01" }, "startsOn");
  });
  it("lien : un élément est obligatoire dès qu'un type de lien est choisi", () => {
    has({ linkType: "service", linkId: "" }, "linkId"); has({ linkType: "product", linkId: " " }, "linkId");
    expect(issues({ linkType: "service", linkId: "pedicure" })).toEqual([]);
    expect(issues({ linkType: "none", linkId: "" })).toEqual([]);
  });
  it("statut de publication : brouillon ou publiée seulement", () => {
    has({ publication: "disabled" as never }, "publication");
    expect(issues({ publication: "published" })).toEqual([]);
  });

  it("formulaire -> données : prix en nombres, dates vides -> null, lien exclusif", () => {
    const i = formToPromotionInput({ ...valid, kind: "price", originalPrice: "20 000", promoPrice: "15000", startsOn: "2026-11-01", endsOn: "", linkType: "product", linkId: "creme", publication: "published", title: "  Crème -25 %  " });
    expect(i).toEqual({ title: "Crème -25 %", description: "", kind: "price", originalPrice: 20000, promoPrice: 15000, percentOff: null, startsOn: "2026-11-01", endsOn: null, publication: "published", serviceId: null, productId: "creme" });
  });
  it("une promotion désactivée le reste tant qu'on ne choisit pas « Publiée »", () => {
    const disabled = promo({ status: "disabled" });
    expect(promotionToForm(disabled).publication).toBe("draft");
    expect(formToPromotionInput(promotionToForm(disabled), disabled).publication).toBe("disabled");
    expect(formToPromotionInput({ ...promotionToForm(disabled), publication: "published" }, disabled).publication).toBe("published");
    expect(formToPromotionInput(valid).publication).toBe("draft");
  });
  it("données -> formulaire : aller-retour sans perte", () => {
    const p = promo({ kind: "price", original_price_fcfa: 20000, promo_price_fcfa: 15000, starts_on: "2026-11-01", ends_on: "2026-11-30", service_id: "pedicure", description: "Texte", status: "published" });
    expect(formToPromotionInput(promotionToForm(p), p)).toMatchObject({ kind: "price", originalPrice: 20000, promoPrice: 15000, startsOn: "2026-11-01", endsOn: "2026-11-30", serviceId: "pedicure", description: "Texte", publication: "published" });
  });
});

describe("visuels", () => {
  const file = (name = "a.png", type = "image/png") => new File(["x"], name, { type });
  beforeEach(() => { h.state.reply = () => ok([{ id: "p1" }]); });

  it("envoi : chemin promotions/<id>/…, référence enregistrée dans promotions.image_url uniquement", async () => {
    const url = await uploadPromotionImage("p1", file(), null);
    expect(h.state.storage.uploads).toHaveLength(1);
    expect(h.state.storage.uploads[0]).toMatch(/^promotions\/p1\/\d+-[a-z0-9]+\.webp$/);
    expect(url).toContain("/catalog-images/promotions/p1/");
    expect(h.state.calls).toHaveLength(1);
    expect(h.state.calls[0]).toMatchObject({ table: "promotions", op: "update", payload: { image_url: url }, filters: [["id", "p1"]] });
  });
  it("remplacement : l'ancien visuel de CETTE promotion est supprimé", async () => {
    const old = "https://x.supabase.co/storage/v1/object/public/catalog-images/promotions/p1/old.webp";
    await uploadPromotionImage("p1", file(), old);
    expect(h.state.storage.removed).toEqual(["promotions/p1/old.webp"]);
  });
  it("une image de produit, de prestation ou d'une autre promotion n'est JAMAIS supprimée", async () => {
    for (const path of ["products/creme/1.webp", "services/pedicure/1.webp", "promotions/autre/1.webp", "autre/p1/1.webp"]) {
      h.state.storage.removed = [];
      await uploadPromotionImage("p1", file(), `https://x.supabase.co/storage/v1/object/public/catalog-images/${path}`);
      expect(h.state.storage.removed).toEqual([]);
    }
    h.state.storage.removed = [];
    await removePromotionImage("p1", "https://x.supabase.co/storage/v1/object/public/catalog-images/products/creme/1.webp");
    expect(h.state.storage.removed).toEqual([]);
  });
  it("retrait : référence effacée puis objet supprimé s'il appartient à la promotion", async () => {
    await removePromotionImage("p1", "https://x.supabase.co/storage/v1/object/public/catalog-images/promotions/p1/old.webp");
    expect(h.state.calls[0]).toMatchObject({ op: "update", payload: { image_url: null } });
    expect(h.state.storage.removed).toEqual(["promotions/p1/old.webp"]);
  });
  it("enregistrement refusé par la RLS : l'objet envoyé est retiré, aucune référence invalide", async () => {
    h.state.reply = () => ok([]);
    await expect(uploadPromotionImage("p1", file(), null)).rejects.toThrow(/Accès refusé/);
    expect(h.state.storage.removed).toEqual(h.state.storage.uploads);
  });
  it("format refusé avant tout envoi", async () => {
    await expect(uploadPromotionImage("p1", file("a.gif", "image/gif"), null)).rejects.toThrow(/Format non pris en charge/);
    expect(h.state.storage.uploads).toEqual([]);
  });
  it("échec de l'envoi : aucune écriture en base", async () => {
    h.state.storage.uploadError = { message: "boom" };
    await expect(uploadPromotionImage("p1", file(), null)).rejects.toBeInstanceOf(AdminError);
    expect(h.state.calls).toEqual([]);
  });
});
