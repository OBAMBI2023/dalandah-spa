import { beforeEach, describe, expect, it, vi } from "vitest";

// Faux client Supabase : on vérifie les requêtes envoyées (table, colonnes, filtres, données) et la gestion des réponses. Aucun appel réseau.
const h = vi.hoisted(() => {
  type Reply = { data: unknown; error: null | { message?: string; code?: string; status?: number } };
  type Call = { table: string; op: "select" | "insert" | "update"; cols: string; payload?: Record<string, unknown>; filters: [string, unknown][]; order?: [string, unknown]; limit?: number };
  const state = { calls: [] as Call[], reply: ((): Reply => { throw new Error("réponse non prévue"); }) as (c: Call) => Reply };
  const client = {
    from: (table: string) => {
      const call: Call = { table, op: "select", cols: "", filters: [] };
      const b: Record<string, unknown> = {
        select: (cols: string) => { call.cols = cols; return b; },
        order: (col: string, o?: unknown) => { call.order = [col, o]; return b; },
        limit: (n: number) => { call.limit = n; return b; },
        eq: (col: string, v: unknown) => { call.filters.push([col, v]); return b; },
        insert: (p: Record<string, unknown>) => { call.op = "insert"; call.payload = p; return b; },
        update: (p: Record<string, unknown>) => { call.op = "update"; call.payload = p; return b; },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
          state.calls.push(call);
          try { return Promise.resolve(state.reply(call)).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); }
        },
      };
      return b;
    },
  };
  return { state, client };
});

vi.mock("@/lib/supabase", () => ({ adminSupabase: h.client, supabase: null }));

import * as api from "@/lib/admin-services";
import {
  ServiceActionError, createAdminService, emptyServiceForm, findCreatedService, formToServiceInput, formatDuration, nextServiceId, serviceFormSchema,
  serviceToForm, setServiceActive, updateAdminService, upcomingBookingsByService, type ServiceInput,
} from "@/lib/admin-services";
import type { AdminService } from "@/lib/admin-api";

const input: ServiceInput = { name: "Soin éclat", category: "visage", description: "Texte", durationMin: 90, durationLabel: "90 min", price: 15000, active: true };
const ok = (data: unknown) => ({ data, error: null });
const sortReply = (n: number | null) => ok(n === null ? [] : [{ sort_order: n }]);

beforeEach(() => { h.state.calls = []; });

describe("durée affichée", () => {
  it("minutes jusqu'à moins de 2 h, puis heures pleines ou heures et minutes (convention du catalogue existant)", () => {
    expect(formatDuration(30)).toBe("30 min");
    expect(formatDuration(5)).toBe("5 min");
    expect(formatDuration(59)).toBe("59 min");
    expect(formatDuration(60)).toBe("60 min");
    expect(formatDuration(75)).toBe("75 min");
    expect(formatDuration(90)).toBe("90 min");
    expect(formatDuration(119)).toBe("119 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(125)).toBe("2 h 05");
    expect(formatDuration(150)).toBe("2 h 30");
    expect(formatDuration(720)).toBe("12 h");
  });
  it("le format retrouve les libellés du catalogue existant (durées de la base), sauf le libellé personnalisé « 2 h et + »", () => {
    const existing: [number, string][] = [[60, "60 min"], [75, "75 min"], [60, "60 min"], [30, "30 min"], [60, "60 min"], [45, "45 min"], [40, "40 min"], [45, "45 min"], [120, "2 h"]];
    for (const [min, label] of existing) expect(formatDuration(min)).toBe(label);
    expect(formatDuration(180)).toBe("3 h"); // « Nattes et tresses » (180 min) est affichée « 2 h et + » : libellé personnalisé, conservé par le formulaire
  });
  it("valeur absente ou invalide : libellé vide", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(-5)).toBe("");
    expect(formatDuration(Number.NaN)).toBe("");
  });
});

describe("validation du formulaire (limites de la base)", () => {
  const valid = { ...emptyServiceForm, name: "Soin éclat", category: "visage" as never, durationMin: "60", price: "15 000" };
  const issues = (v: Partial<typeof valid>) => {
    const r = serviceFormSchema.safeParse({ ...valid, ...v });
    return r.success ? [] : r.error.issues.map((i) => i.path.join(".") + ": " + i.message);
  };
  const has = (v: Partial<typeof valid>, field: string) => expect(issues(v).some((m) => m.startsWith(field + ":"))).toBe(true);

  it("accepte une saisie valide (espaces de milliers tolérés), un prix de 0, 5 et 720 minutes, un libellé vide", () => {
    expect(issues({})).toEqual([]);
    expect(issues({ price: "0" })).toEqual([]);
    expect(issues({ durationMin: "5" })).toEqual([]);
    expect(issues({ durationMin: "720" })).toEqual([]);
    expect(issues({ durationLabel: "" })).toEqual([]);
  });
  it("nom obligatoire (2 à 120 caractères)", () => { has({ name: "" }, "name"); has({ name: "A" }, "name"); has({ name: "x".repeat(121) }, "name"); });
  it("catégorie obligatoire, au format d'un identifiant de catégorie (l'existence est vérifiée par la liste du formulaire et la base)", () => {
    has({ category: "" as never }, "category");
    for (const c of ["Visage", "a", "soins du dos", "sauna!", "x".repeat(61)]) has({ category: c as never }, "category");
    for (const c of ["visage", "corps", "massage", "coiffure", "onglerie", "spa", "sauna", "soins-du-dos", "epilation-2"]) expect(issues({ category: c as never })).toEqual([]);
  });
  it("durée obligatoire : entier de 5 à 720 minutes", () => {
    for (const d of ["", "0", "4", "721", "-30", "45,5", "abc", "1e3"]) has({ durationMin: d }, "durationMin");
  });
  it("prix obligatoire : entier non négatif, 100 000 000 au maximum", () => {
    for (const p of ["", "-1", "12,5", "abc", "100000001"]) has({ price: p }, "price");
  });
  it("description (1 000 caractères) et libellé affiché (40 caractères) limités", () => {
    has({ description: "x".repeat(1001) }, "description");
    has({ durationLabel: "x".repeat(41) }, "durationLabel");
  });
  it("conversion : libellé vide = libellé généré ; libellé saisi conservé ; prix nettoyé", () => {
    expect(formToServiceInput(serviceFormSchema.parse({ ...valid, durationMin: "90", durationLabel: "" }))).toMatchObject({ durationMin: 90, durationLabel: "90 min", price: 15000 });
    expect(formToServiceInput(serviceFormSchema.parse({ ...valid, durationMin: "180", durationLabel: " 2 h et + " }))).toMatchObject({ durationMin: 180, durationLabel: "2 h et +" });
  });
  it("modification : le formulaire reprend la prestation (libellé personnalisé compris), sans photo", () => {
    const s: AdminService = { id: "nattes", name: "Nattes", category: "coiffure", description: "d", durationLabel: "2 h et +", durationMin: 180, price: 15000, active: true, isDemo: true, imageUrl: "https://x/y.webp" };
    expect(serviceToForm(s)).toMatchObject({ durationMin: "180", durationLabel: "2 h et +", price: "15000", active: true, confirmTariff: false });
    expect(serviceToForm(s)).not.toHaveProperty("imageUrl");
  });
});

describe("identifiant d'une nouvelle prestation", () => {
  it("tiré du nom, unique (-2, -3…), 60 caractères au plus suffixe compris", () => {
    expect(nextServiceId("Soin du visage éclat", [])).toBe("soin-du-visage-eclat");
    expect(nextServiceId("Pédicure", ["pedicure"])).toBe("pedicure-2");
    expect(nextServiceId("Pédicure", ["pedicure", "pedicure-2", "PEDICURE-3"])).toBe("pedicure-4");
    expect(nextServiceId("!", [])).toBe("");
    const long = nextServiceId("x".repeat(90), ["x".repeat(60)]);
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long).toMatch(/^[a-z0-9-]{2,60}$/);
    expect(long.endsWith("-2")).toBe(true);
  });
});

describe("création", () => {
  const created = () => h.state.calls.filter((c) => c.op === "insert");
  it("envoie exactement les colonnes prévues, jamais « démonstration », ni photo, placée en dernier du catalogue", async () => {
    h.state.reply = (c) => (c.op === "insert" ? ok([{ id: "soin-eclat" }]) : sortReply(100));
    const r = await createAdminService(input, []);

    expect(r).toEqual({ id: "soin-eclat" });
    const read = h.state.calls[0]!;
    expect(read).toMatchObject({ table: "services", cols: "sort_order", limit: 1, order: ["sort_order", { ascending: false }] });
    expect(created()[0]!.payload).toEqual({
      id: "soin-eclat", name: "Soin éclat", category: "visage", description: "Texte", duration_min: 90, duration_label: "90 min", price_fcfa: 15000,
      active: true, is_demo: false, sort_order: 110,
    });
    expect(created()[0]!.payload).not.toHaveProperty("image_url");
  });
  it("catalogue vide : premier ordre = 10", async () => {
    h.state.reply = (c) => (c.op === "insert" ? ok([{ id: "soin-eclat" }]) : sortReply(null));
    await createAdminService(input, []);
    expect(created()[0]!.payload).toMatchObject({ sort_order: 10 });
  });
  it("identifiant déjà connu : variante -2 dès le premier essai", async () => {
    h.state.reply = (c) => (c.op === "insert" ? ok([{ id: "x" }]) : sortReply(10));
    const r = await createAdminService(input, ["soin-eclat"]);
    expect(r.id).toBe("soin-eclat-2");
  });
  it("identifiant pris entre-temps (23505) : la base refuse, on retente avec la variante suivante, une valeur refusée n'est jamais rejouée", async () => {
    let n = 0;
    h.state.reply = (c) => (c.op !== "insert" ? sortReply(10) : ++n < 3 ? { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"services_pkey\"" } } : ok([{ id: "x" }]));
    const seen: string[] = [];
    const r = await createAdminService(input, [], { onAttempt: (a) => seen.push(a.id) });
    expect(seen).toEqual(["soin-eclat", "soin-eclat-2", "soin-eclat-3"]);
    expect(r.id).toBe("soin-eclat-3");
  });
  it("conflits sans fin : abandon après 25 tentatives", async () => {
    h.state.reply = (c) => (c.op !== "insert" ? sortReply(10) : { data: null, error: { code: "23505", message: "dup" } });
    await expect(createAdminService(input, [])).rejects.toMatchObject({ reason: "id_taken", message: expect.stringMatching(/Impossible de générer un identifiant unique/) });
    expect(created()).toHaveLength(25);
  });
  it("réseau, droits, validation : aucune nouvelle tentative", async () => {
    for (const [error, expected] of [
      [{ message: "Failed to fetch" }, { code: "network" }],
      [{ code: "42501", message: "new row violates row-level security policy" }, { code: "forbidden" }],
      [{ code: "23514", message: "check" }, { reason: "invalid_input" }],
      [{ code: "XX000", message: "boom" }, { code: "server" }],
    ] as const) {
      h.state.calls = [];
      h.state.reply = (c) => (c.op !== "insert" ? sortReply(10) : { data: null, error });
      await expect(createAdminService(input, [])).rejects.toMatchObject(expected);
      expect(created()).toHaveLength(1);
    }
  });
  it("coupure réseau levée comme exception : erreur « network », l'essai est signalé", async () => {
    h.state.reply = (c) => { if (c.op === "insert") throw new TypeError("Failed to fetch"); return sortReply(10); };
    const seen: string[] = [];
    await expect(createAdminService(input, [], { onAttempt: (a) => seen.push(a.id) })).rejects.toMatchObject({ code: "network" });
    expect(seen).toEqual(["soin-eclat"]);
    expect(created()).toHaveLength(1);
  });
  it("écriture qui ne touche aucune ligne : jamais présentée comme une création", async () => {
    h.state.reply = (c) => (c.op === "insert" ? ok([]) : sortReply(10));
    await expect(createAdminService(input, [])).rejects.toBeInstanceOf(ServiceActionError);
  });
  it("nom inutilisable : refusé avant tout appel", async () => {
    await expect(createAdminService({ ...input, name: "!" }, [])).rejects.toMatchObject({ reason: "invalid_input" });
    expect(h.state.calls).toHaveLength(0);
  });
  it("findCreatedService : adopte seulement CETTE prestation (même identifiant et même nom)", () => {
    const rows = [{ id: "soin-eclat", name: "Soin éclat" }];
    expect(findCreatedService(rows, { id: "soin-eclat" }, " Soin éclat ")).toBe(rows[0]);
    expect(findCreatedService(rows, { id: "soin-eclat" }, "Autre nom")).toBeNull();
    expect(findCreatedService(rows, { id: "soin-eclat-2" }, "Soin éclat")).toBeNull();
  });
});

describe("modification et activation", () => {
  const updates = () => h.state.calls.filter((c) => c.op === "update");
  it("met à jour les champs de la fiche pour l'identifiant donné, sans toucher à la photo, à l'ordre, à l'identifiant ni à « démonstration »", async () => {
    h.state.reply = () => ok([{ id: "massage-dos" }]);
    await updateAdminService("massage-dos", { ...input, price: 12000, durationMin: 45, durationLabel: "45 min" });
    expect(updates()[0]).toMatchObject({ table: "services", filters: [["id", "massage-dos"]] });
    expect(updates()[0]!.payload).toEqual({ name: "Soin éclat", category: "visage", description: "Texte", duration_min: 45, duration_label: "45 min", price_fcfa: 12000, active: true });
  });
  it("confirmation du tarif : retire seulement le marquage « démonstration »", async () => {
    h.state.reply = () => ok([{ id: "massage-dos" }]);
    await updateAdminService("massage-dos", input, { confirmTariff: true });
    expect(updates()[0]!.payload).toMatchObject({ is_demo: false });
    h.state.calls = [];
    await updateAdminService("massage-dos", input, { confirmTariff: false });
    expect(updates()[0]!.payload).not.toHaveProperty("is_demo");
  });
  it("aucune ligne modifiée (droits refusés ou prestation disparue) : erreur, jamais un succès", async () => {
    h.state.reply = () => ok([]);
    await expect(updateAdminService("x", input)).rejects.toMatchObject({ reason: "not_found" });
    await expect(setServiceActive("x", false)).rejects.toMatchObject({ reason: "not_found" });
  });
  it("droits, réseau et validation : erreurs classées", async () => {
    h.state.reply = () => ({ data: null, error: { code: "42501", message: "rls" } });
    await expect(updateAdminService("x", input)).rejects.toMatchObject({ code: "forbidden" });
    h.state.reply = () => ({ data: null, error: { code: "23514", message: "check" } });
    await expect(updateAdminService("x", input)).rejects.toMatchObject({ reason: "invalid_input" });
    h.state.reply = () => { throw new TypeError("Failed to fetch"); };
    await expect(setServiceActive("x", true)).rejects.toMatchObject({ code: "network" });
  });
  it("désactivation et réactivation : seule la colonne « active » est écrite", async () => {
    h.state.reply = () => ok([{ id: "pedicure" }]);
    await setServiceActive("pedicure", false);
    await setServiceActive("pedicure", true);
    expect(updates().map((u) => u.payload)).toEqual([{ active: false }, { active: true }]);
    expect(updates().every((u) => JSON.stringify(u.filters) === JSON.stringify([["id", "pedicure"]]))).toBe(true);
  });
  it("aucune fonction de suppression n'existe (désactivation uniquement)", () => {
    expect(Object.keys(api).filter((k) => /delete|remove|destroy/i.test(k))).toEqual([]);
  });
});

describe("réservations à venir par prestation", () => {
  it("compte seulement les réservations confirmées futures, par identifiant de prestation", async () => {
    h.state.reply = () => ok([
      { service_id: "pedicure", date: "2099-01-01", slot: "10:00:00" },
      { service_id: "pedicure", date: "2099-02-01", slot: "09:00:00" },
      { service_id: "nattes", date: "2099-01-01", slot: "14:00:00" },
      { service_id: "pedicure", date: "2000-01-01", slot: "10:00:00" }, // passée : ignorée
    ]);
    expect(await upcomingBookingsByService()).toEqual({ pedicure: 2, nattes: 1 });
    expect(h.state.calls[0]).toMatchObject({ table: "bookings", cols: "service_id,date,slot", filters: [["status", "confirmed"]] });
  });
  it("aucune réservation : objet vide ; erreur de lecture : erreur classée", async () => {
    h.state.reply = () => ok([]);
    expect(await upcomingBookingsByService()).toEqual({});
    h.state.reply = () => ({ data: null, error: { code: "42501", message: "denied" } });
    await expect(upcomingBookingsByService()).rejects.toMatchObject({ code: "forbidden" });
  });
});
