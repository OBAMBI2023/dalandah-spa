import { beforeEach, describe, expect, it, vi } from "vitest";

// Catégories de prestations : liste (code + base), filtre « au moins une prestation », lecture publique avec repli, création administrateur.
// Faux client Supabase : aucun appel réseau.
const h = vi.hoisted(() => {
  type Reply = { data: unknown; error: null | { message?: string; code?: string; status?: number } };
  const state = { rpcCalls: [] as { fn: string; args: unknown }[], rpcReply: { data: null, error: null } as Reply, selectReply: { data: [], error: null } as Reply, tables: [] as string[] };
  const client = {
    from: (table: string) => {
      state.tables.push(table);
      const b: Record<string, unknown> = {
        select: () => b,
        order: () => b,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(state.selectReply).then(res, rej),
      };
      return b;
    },
    rpc: (fn: string, args: unknown) => { state.rpcCalls.push({ fn, args }); return Promise.resolve(state.rpcReply); },
  };
  return { state, client };
});
vi.mock("@/lib/supabase", () => ({ adminSupabase: h.client, supabase: null }));

import { defaultCategoryImage, serviceCategories } from "@/data/services";
import { createApi, type DataClient } from "@/lib/api";
import { AdminError } from "@/lib/admin-api";
import { createAdminServiceCategory, listAdminServiceCategories, ServiceCategoriesNotInstalledError } from "@/lib/admin-service-categories";
import { buildCategories, categoriesInUse, parseCategoryParam } from "@/lib/service-categories";

const ORIGINAL_IDS = ["visage", "massage", "corps", "onglerie", "coiffure", "spa"];
const row = (id: string, label: string, over: Record<string, unknown> = {}) => ({ id, label, title: label, description: "", image_url: null, sort_order: 70, ...over });

beforeEach(() => { h.state.rpcCalls = []; h.state.tables = []; h.state.selectReply = { data: [], error: null }; h.state.rpcReply = { data: null, error: null }; });

describe("buildCategories", () => {
  it("sans liste de la base (table absente, réseau) : exactement les 6 catégories d'origine, dans leur ordre, avec leurs libellés et images", () => {
    for (const rows of [undefined, null, "n'importe quoi", 42]) {
      const out = buildCategories(rows);
      expect(out.map((c) => c.id)).toEqual(ORIGINAL_IDS);
      expect(out).toEqual(serviceCategories);
    }
  });

  it("les catégories d'origine gardent libellé, titre, description et image du code, même si la base dit autre chose", () => {
    const out = buildCategories([row("visage", "FAUX", { title: "Faux", description: "Faux", image_url: "https://x/faux.jpg", sort_order: 999 })]);
    expect(out.slice(0, 6)).toEqual(serviceCategories);
    expect(out).toHaveLength(6);
  });

  it("une catégorie créée s'ajoute à la fin, avec l'image par défaut, son libellé pour titre et une description vide", () => {
    const out = buildCategories([row("sauna", "Sauna")]);
    expect(out.map((c) => c.id)).toEqual([...ORIGINAL_IDS, "sauna"]);
    expect(out[6]).toEqual({ id: "sauna", label: "Sauna", title: "Sauna", description: "", image: defaultCategoryImage });
    expect(defaultCategoryImage).toBeTruthy();
  });

  it("une catégorie créée avec photo garde sa photo", () => {
    expect(buildCategories([row("sauna", "Sauna", { image_url: "https://x/sauna.webp" })])[6]!.image).toBe("https://x/sauna.webp");
  });

  it("catégories créées triées par ordre d'affichage puis identifiant", () => {
    const out = buildCategories([row("c-zen", "Zen", { sort_order: 90 }), row("b-bain", "Bain", { sort_order: 70 }), row("a-aroma", "Aroma", { sort_order: 70 })]);
    expect(out.slice(6).map((c) => c.id)).toEqual(["a-aroma", "b-bain", "c-zen"]);
  });

  it("lignes illisibles ou invalides ignorées (identifiant hors format, libellé vide, valeurs absentes)", () => {
    const out = buildCategories([null, 3, {}, row("Bad Id", "X"), row("ok-id", ""), { id: "sans-libelle" }, row("valide", "Valide")]);
    expect(out.slice(6).map((c) => c.id)).toEqual(["valide"]);
  });

  it("doublons d'identifiant : une seule entrée", () => {
    expect(buildCategories([row("sauna", "Sauna"), row("sauna", "Sauna bis")]).filter((c) => c.id === "sauna")).toHaveLength(1);
  });

  it("une catégorie utilisée par une prestation mais absente de la liste est ajoutée (jamais de prestation masquée)", () => {
    const out = buildCategories([], ["visage", "soins-du-dos"]);
    expect(out.at(-1)).toMatchObject({ id: "soins-du-dos", label: "Soins du dos", image: defaultCategoryImage });
    expect(out).toHaveLength(7);
  });
});

describe("categoriesInUse : une catégorie n'est montrée aux clients que si elle a au moins une prestation", () => {
  const cats = buildCategories([row("sauna", "Sauna"), row("vide", "Vide")]);
  it("catégories sans prestation masquées, ordre conservé", () => {
    const shown = categoriesInUse(cats, [{ category: "sauna" }, { category: "visage" }, { category: "visage" }]);
    expect(shown.map((c) => c.id)).toEqual(["visage", "sauna"]);
  });
  it("aucune prestation : aucune catégorie", () => { expect(categoriesInUse(cats, [])).toEqual([]); });
  it("une nouvelle catégorie apparaît dès sa première prestation", () => {
    expect(categoriesInUse(cats, [{ category: "visage" }]).map((c) => c.id)).not.toContain("sauna");
    expect(categoriesInUse(cats, [{ category: "visage" }, { category: "sauna" }]).map((c) => c.id)).toContain("sauna");
  });
});

describe("parseCategoryParam (?categorie= dans l'adresse)", () => {
  it("accepte les identifiants d'origine et créés, refuse le reste", () => {
    for (const ok of ["visage", "massage", "soins-du-dos", "sauna-2"]) expect(parseCategoryParam(ok)).toBe(ok);
    for (const bad of ["", "a", "Visage", "x y", "<script>", "a".repeat(61), 3, null, undefined, ["visage"], { a: 1 }]) expect(parseCategoryParam(bad)).toBeUndefined();
  });
});

describe("catalogue public : lecture des catégories", () => {
  const ok = (data: unknown) => ({ data, error: null });
  const svcRow = (id: string, category: string) => ({ id, name: id, category, description: "", duration_label: "60 min", price_fcfa: 1000, image_url: null, sort_order: 1 });
  const client = (cats: { data: unknown; error: unknown } | "throw", services = [svcRow("pedicure", "onglerie")]): DataClient => ({
    rpc: async () => ok(null),
    from: (table: string) => {
      const data = table === "services" ? services : table === "time_slots" ? [{ slot: "09:00" }] : [{ min_notice_hours: 2, cancel_notice_hours: 2, max_days_ahead: 180, max_active_bookings_per_phone: 3 }];
      const result = table === "service_categories"
        ? (cats === "throw" ? Promise.reject(new Error("réseau")) : Promise.resolve(cats))
        : Promise.resolve(ok(data));
      const b = () => Object.assign(Promise.resolve(result), { order: () => Object.assign(Promise.resolve(result), {}) });
      return { select: () => b() } as never;
    },
  });

  it("catégories de la base lues et fusionnées avec celles du code", async () => {
    const cat = await createApi(client(ok([row("sauna", "Sauna")]), [svcRow("pedicure", "onglerie"), svcRow("sauna-vapeur", "sauna")])).fetchCatalogue();
    expect(cat.categories.map((c) => c.id)).toEqual([...ORIGINAL_IDS, "sauna"]);
    expect(cat.services.find((s) => s.id === "sauna-vapeur")?.category).toBe("sauna");
  });

  it("table absente (erreur) : le catalogue se charge quand même, avec les catégories du code", async () => {
    const cat = await createApi(client({ data: null, error: { code: "42P01", message: "relation does not exist" } })).fetchCatalogue();
    expect(cat.source).toBe("supabase");
    expect(cat.categories).toEqual(serviceCategories);
    expect(cat.services).toHaveLength(1);
  });

  it("requête des catégories qui échoue ou lève : le catalogue n'est pas bloqué", async () => {
    expect((await createApi(client("throw")).fetchCatalogue()).categories).toEqual(serviceCategories);
  });

  it("une prestation d'une catégorie inconnue de la liste reste visible (catégorie ajoutée)", async () => {
    const cat = await createApi(client(ok([]), [svcRow("x", "nouvelle-categorie")])).fetchCatalogue();
    expect(cat.categories.map((c) => c.id)).toContain("nouvelle-categorie");
  });

  it("mode local : les 6 catégories d'origine", async () => {
    expect((await createApi(null).fetchCatalogue()).categories).toEqual(serviceCategories);
  });
});

describe("administration : lecture des catégories", () => {
  it("rend la liste complète (origine + créées) depuis public.service_categories", async () => {
    h.state.selectReply = { data: [row("sauna", "Sauna")], error: null };
    const out = await listAdminServiceCategories();
    expect(h.state.tables).toEqual(["service_categories"]);
    expect(out.map((c) => c.id)).toEqual([...ORIGINAL_IDS, "sauna"]);
  });
  it("table absente (42P01, PGRST205, 404) : ServiceCategoriesNotInstalledError", async () => {
    for (const error of [{ code: "42P01" }, { code: "PGRST205" }, { status: 404, message: "relation \"public.service_categories\" does not exist" }]) {
      h.state.selectReply = { data: null, error };
      await expect(listAdminServiceCategories()).rejects.toBeInstanceOf(ServiceCategoriesNotInstalledError);
    }
  });
  it("autre erreur (réseau, droits) : pas confondue avec « non installé »", async () => {
    h.state.selectReply = { data: null, error: { message: "Failed to fetch" } };
    const e = await listAdminServiceCategories().catch((x) => x);
    expect(e).toBeInstanceOf(AdminError);
    expect(e).not.toBeInstanceOf(ServiceCategoriesNotInstalledError);
    expect(e.code).toBe("network");
  });
});

describe("administration : création d'une catégorie", () => {
  it("appelle admin_create_service_category avec le nom normalisé et rend { id, label }", async () => {
    h.state.rpcReply = { data: { ok: true, id: "soins-du-dos", label: "Soins du dos" }, error: null };
    await expect(createAdminServiceCategory("  Soins   du  dos ")).resolves.toEqual({ id: "soins-du-dos", label: "Soins du dos" });
    expect(h.state.rpcCalls).toEqual([{ fn: "admin_create_service_category", args: { p_name: "Soins du dos" } }]);
  });
  it("refus métier (doublon, nom invalide) : message de la base conservé", async () => {
    h.state.rpcReply = { data: { ok: false, code: "category_exists", error: "Cette catégorie existe déjà." }, error: null };
    await expect(createAdminServiceCategory("Visage")).rejects.toThrow("Cette catégorie existe déjà.");
  });
  it("jamais donnée pour créée : réponse sans ok, vide ou sans identifiant", async () => {
    for (const data of [null, {}, { ok: true }, { ok: true, id: "x" }, { ok: true, label: "X" }, { ok: "oui", id: "x", label: "X" }]) {
      h.state.rpcReply = { data, error: null };
      await expect(createAdminServiceCategory("Sauna")).rejects.toBeInstanceOf(AdminError);
    }
  });
  it("fonction absente (migration non appliquée) : ServiceCategoriesNotInstalledError", async () => {
    for (const error of [{ code: "PGRST202" }, { code: "42883" }]) {
      h.state.rpcReply = { data: null, error };
      await expect(createAdminServiceCategory("Sauna")).rejects.toBeInstanceOf(ServiceCategoriesNotInstalledError);
    }
  });
  it("non administrateur (42501) : accès refusé", async () => {
    h.state.rpcReply = { data: null, error: { code: "42501", message: "réservé aux administrateurs" } };
    const e = await createAdminServiceCategory("Sauna").catch((x) => x);
    expect(e).toBeInstanceOf(AdminError);
    expect(e.code).toBe("forbidden");
  });
});

describe("prestations inactives : jamais visibles sur le site public, même pour un administrateur connecté", () => {
  const ok = (data: unknown) => ({ data, error: null });
  const svcRow = (id: string, category: string, active?: boolean) => ({ id, name: id, category, description: "", duration_label: "60 min", price_fcfa: 1000, image_url: null, sort_order: 1, ...(active === undefined ? {} : { active }) });
  // Compte administrateur : la base renvoie TOUTES les prestations (politique « admin services »), actives ou non.
  const adminClient = (services: unknown[]): DataClient => ({
    rpc: async () => ok(null),
    from: (table: string) => {
      const data = table === "services" ? services : table === "time_slots" ? [{ slot: "09:00" }] : table === "service_categories" ? [row("sauna", "Sauna")] : [{ min_notice_hours: 2, cancel_notice_hours: 2, max_days_ahead: 180, max_active_bookings_per_phone: 3 }];
      const b = () => Object.assign(Promise.resolve(ok(data)), { order: () => Promise.resolve(ok(data)) });
      return { select: () => b() } as never;
    },
  });

  it("les prestations inactives sont retirées du catalogue public", async () => {
    const cat = await createApi(adminClient([svcRow("pedicure", "onglerie", true), svcRow("manucure", "onglerie", false)])).fetchCatalogue();
    expect(cat.services.map((s) => s.id)).toEqual(["pedicure"]);
  });

  it("une catégorie qui ne contient que des prestations inactives n'est pas montrée au public", async () => {
    const cat = await createApi(adminClient([svcRow("pedicure", "onglerie", true), svcRow("sauna-vapeur", "sauna", false)])).fetchCatalogue();
    expect(categoriesInUse(cat.categories, cat.services).map((c) => c.id)).toEqual(["onglerie"]);
  });

  it("une catégorie d'origine dont toutes les prestations sont inactives n'est pas montrée non plus", async () => {
    const cat = await createApi(adminClient([svcRow("pedicure", "onglerie", true), svcRow("rituel-spa", "spa", false)])).fetchCatalogue();
    expect(categoriesInUse(cat.categories, cat.services).map((c) => c.id)).not.toContain("spa");
  });

  it("une catégorie dont une prestation est active reste montrée, même avec d'autres prestations inactives", async () => {
    const cat = await createApi(adminClient([svcRow("a", "sauna", false), svcRow("b", "sauna", true)])).fetchCatalogue();
    expect(categoriesInUse(cat.categories, cat.services).map((c) => c.id)).toEqual(["sauna"]);
  });

  it("un visiteur anonyme (la base ne renvoie que les actives, sans colonne exploitable) : comportement inchangé", async () => {
    const cat = await createApi(adminClient([svcRow("pedicure", "onglerie"), svcRow("manucure", "onglerie", true)])).fetchCatalogue();
    expect(cat.services).toHaveLength(2);
  });
});
