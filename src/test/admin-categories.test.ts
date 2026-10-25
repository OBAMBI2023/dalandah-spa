import { beforeEach, describe, expect, it, vi } from "vitest";

// Faux client Supabase : on vérifie les appels (table, fonction, paramètres) et la gestion des réponses. Aucun appel réseau.
const h = vi.hoisted(() => {
  type Reply = { data: unknown; error: null | { message?: string; code?: string; status?: number } };
  const state = {
    rpcCalls: [] as { fn: string; args: Record<string, unknown> | undefined }[],
    tableCalls: [] as { table: string; columns: string; order: string }[],
    rpcReply: null as Reply | (() => Reply) | null,
    tableReply: null as Reply | (() => Reply) | null,
  };
  const run = (r: Reply | (() => Reply) | null) => { if (!r) throw new Error("réponse non prévue"); return typeof r === "function" ? r() : r; };
  const client = {
    rpc: async (fn: string, args?: Record<string, unknown>) => { state.rpcCalls.push({ fn, args }); return run(state.rpcReply); },
    from: (table: string) => ({ select: (columns: string) => ({ order: async (order: string) => { state.tableCalls.push({ table, columns, order }); return run(state.tableReply); } }) }),
  };
  return { state, client };
});

vi.mock("@/lib/supabase", () => ({ adminSupabase: h.client, supabase: null }));

import { AdminError } from "@/lib/admin-api";
import {
  CategoriesNotInstalledError, categoryKey, createAdminCategory, listAdminCategories, mergeCategories, normalizeCategoryName, validateCategoryName,
} from "@/lib/admin-categories";
import { ProductActionError } from "@/lib/admin-products";

const ok = (data: unknown) => ({ data, error: null });

beforeEach(() => {
  h.state.rpcCalls = []; h.state.tableCalls = []; h.state.rpcReply = null; h.state.tableReply = null;
});

describe("nom de catégorie : normalisation et validation", () => {
  it("espaces de début et de fin retirés, espaces répétés (tabulations, retours) ramenés à un seul", () => {
    expect(normalizeCategoryName("  Huiles   et \t baumes \n")).toBe("Huiles et baumes");
    expect(normalizeCategoryName("Soins")).toBe("Soins");
    expect(normalizeCategoryName("   ")).toBe("");
  });
  it("clé de comparaison : insensible à la casse, aux espaces superflus et (côté formulaire) aux accents", () => {
    expect(categoryKey("  HYDRATATION ")).toBe(categoryKey("hydratation"));
    expect(categoryKey("Sérums  et soins")).toBe(categoryKey("serums et SOINS"));
    expect(categoryKey("Soins du corps")).not.toBe(categoryKey("Soins du visage"));
  });
  it("refuse un nom vide, d'espaces seuls, trop court ou trop long, ou avec un caractère de contrôle", () => {
    expect(validateCategoryName("", [])).toBe("Indiquez le nom de la catégorie.");
    expect(validateCategoryName("    ", [])).toBe("Indiquez le nom de la catégorie.");
    expect(validateCategoryName("a", [])).toMatch(/2 à 60 caractères/);
    expect(validateCategoryName("  a  ", [])).toMatch(/2 à 60 caractères/);
    expect(validateCategoryName("x".repeat(61), [])).toMatch(/2 à 60 caractères/);
    expect(validateCategoryName("Huile" + String.fromCharCode(7) + "rare", [])).toMatch(/caractère non autorisé/);
  });
  it("accepte 2 et 60 caractères, après suppression des espaces superflus", () => {
    expect(validateCategoryName("ab", [])).toBeNull();
    expect(validateCategoryName("x".repeat(60), [])).toBeNull();
    expect(validateCategoryName("   " + "x".repeat(60) + "   ", [])).toBeNull();
    expect(validateCategoryName("Parfums   d'ambiance", ["Hydratation"])).toBeNull();
  });
  it("refuse un doublon (casse, espaces, accents) en citant la catégorie existante", () => {
    const existing = ["Hydratation", "Sérums et soins ciblés"];
    expect(validateCategoryName("hydratation", existing)).toBe("Une catégorie « Hydratation » existe déjà.");
    expect(validateCategoryName("  HYDRATATION  ", existing)).toBe("Une catégorie « Hydratation » existe déjà.");
    expect(validateCategoryName("Serums  et soins CIBLES", existing)).toBe("Une catégorie « Sérums et soins ciblés » existe déjà.");
    expect(validateCategoryName("Soins du corps", existing)).toBeNull();
  });
});

describe("nom de catégorie : Unicode, espaces insécables et accents", () => {
  const C = (...codes: number[]) => String.fromCharCode(...codes);
  it("espaces insécables et cadratins ramenés à une espace ; caractères invisibles et de sens d'écriture retirés", () => {
    expect(normalizeCategoryName("Soins" + C(0xa0) + "du" + C(0x2003) + "corps" + C(0xa0))).toBe("Soins du corps");
    expect(normalizeCategoryName("Hydra" + C(0x200b) + "ta" + C(0xad) + "tion")).toBe("Hydratation");
    expect(normalizeCategoryName("Par" + C(0x202e) + "fums")).toBe("Parfums");
    expect(normalizeCategoryName(C(0xa0, 0x200b, 0xa0))).toBe("");
  });
  it("forme décomposée (NFD) ramenée à la forme composée (NFC), comme le fait la base", () => {
    expect(normalizeCategoryName("Se" + C(0x301) + "rums")).toBe("S" + C(0xe9) + "rums");
    expect(normalizeCategoryName("Se" + C(0x301) + "rums")).toBe(normalizeCategoryName("S" + C(0xe9) + "rums"));
  });
  it("clé de comparaison : mêmes noms malgré NFD, accents, lettres pleine chasse, espaces insécables et casse", () => {
    const key = categoryKey("Hydratation");
    for (const variant of ["hydratation", "HYDRATATION", "Hydratati" + C(0xf3) + "n", C(0xff28) + "ydratation", "Hydra" + C(0x200b) + "tation", " Hydratation" + C(0xa0)]) {
      expect(categoryKey(variant)).toBe(key);
    }
    expect(categoryKey("Se" + C(0x301) + "rums et soins cible" + C(0x301) + "s")).toBe(categoryKey("serums et soins cibles"));
  });
  it("limites connues, identiques à celles de la base : « œ »/« oe » et « ß »/« ss » ne sont pas rapprochés", () => {
    expect(categoryKey("Cœur")).not.toBe(categoryKey("Coeur"));
    expect(categoryKey("Stra" + C(0xdf) + "e")).not.toBe(categoryKey("Strasse"));
  });
  it("un nom fait uniquement d'espaces insécables ou de caractères invisibles est considéré comme vide", () => {
    expect(validateCategoryName(C(0xa0, 0xa0, 0xa0), [])).toBe("Indiquez le nom de la catégorie.");
    expect(validateCategoryName(C(0x200b, 0x200b), [])).toBe("Indiquez le nom de la catégorie.");
  });
  it("doublon détecté malgré une forme décomposée ou un espace insécable", () => {
    const existing = ["S" + C(0xe9) + "rums et soins cibl" + C(0xe9) + "s", "Soins du corps"];
    expect(validateCategoryName("Se" + C(0x301) + "rums et soins cible" + C(0x301) + "s", existing)).toMatch(/existe déjà/);
    expect(validateCategoryName("Soins" + C(0xa0) + "du" + C(0xa0) + "corps", existing)).toMatch(/existe déjà/);
  });
});

describe("liste des catégories proposées", () => {
  it("catégories du code d'abord (ordre habituel), puis les autres par ordre alphabétique, sans doublon exact", () => {
    expect(mergeCategories(["Nettoyants", "Hydratation"], ["Parfums", "Nettoyants"], ["Accessoires", "Hydratation"])).toEqual(["Nettoyants", "Hydratation", "Accessoires", "Parfums"]);
    expect(mergeCategories([], [])).toEqual([]);
  });
  it("la même catégorie à une casse différente reste distincte (les produits existants gardent leur texte d'origine)", () => {
    expect(mergeCategories(["Hydratation", "hydratation"])).toEqual(["Hydratation", "hydratation"]);
  });
});

describe("lecture : product_categories", () => {
  it("lit uniquement les noms, triés, dans la table protégée par la RLS", async () => {
    h.state.tableReply = ok([{ name: "Hydratation" }, { name: "Parfums" }]);
    expect(await listAdminCategories()).toEqual(["Hydratation", "Parfums"]);
    expect(h.state.tableCalls).toEqual([{ table: "product_categories", columns: "name", order: "name" }]);
  });
  it("table absente (migration non appliquée) : erreur explicite, jamais une liste vide", async () => {
    for (const error of [
      { code: "PGRST205", message: "Could not find the table 'public.product_categories' in the schema cache" },
      { code: "42P01", message: 'relation "public.product_categories" does not exist' },
      { status: 404, message: "relation product_categories does not exist" },
    ]) {
      h.state.tableReply = { data: null, error };
      const e = await listAdminCategories().catch((x) => x);
      expect(e).toBeInstanceOf(CategoriesNotInstalledError);
      expect(e.message).toMatch(/20261027000000_product_categories\.sql.*pas été appliquée/);
    }
  });
  it("refus d'autorisation et réseau coupé : erreurs classées", async () => {
    h.state.tableReply = { data: null, error: { code: "42501", message: "permission denied" } };
    await expect(listAdminCategories()).rejects.toMatchObject({ code: "forbidden" });
    h.state.tableReply = () => { throw new TypeError("Failed to fetch"); };
    await expect(listAdminCategories()).rejects.toMatchObject({ code: "network" });
  });
});

describe("création : admin_create_category", () => {
  it("appelle la fonction avec p_name et rend le nom tel qu'enregistré", async () => {
    h.state.rpcReply = ok({ ok: true, id: 9, name: "Parfums d'ambiance" });
    expect(await createAdminCategory("Parfums d'ambiance")).toBe("Parfums d'ambiance");
    expect(h.state.rpcCalls).toEqual([{ fn: "admin_create_category", args: { p_name: "Parfums d'ambiance" } }]);
  });
  it("doublon refusé par la base : message exact conservé, ce n'est pas un succès", async () => {
    h.state.rpcReply = ok({ ok: false, code: "category_exists", error: "Cette catégorie existe déjà." });
    const e = await createAdminCategory("Hydratation").catch((x) => x);
    expect(e).toBeInstanceOf(ProductActionError);
    expect(e).toMatchObject({ reason: "category_exists", message: "Cette catégorie existe déjà." });
  });
  it("nom invalide refusé par la base : message conservé", async () => {
    h.state.rpcReply = ok({ ok: false, code: "invalid_input", error: "Le nom de la catégorie doit contenir de 2 à 60 caractères." });
    await expect(createAdminCategory("a")).rejects.toMatchObject({ reason: "invalid_input", message: expect.stringMatching(/2 à 60/) });
  });
  it("droits insuffisants (42501) : erreur « forbidden »", async () => {
    h.state.rpcReply = { data: null, error: { code: "42501", message: "réservé aux administrateurs" } };
    await expect(createAdminCategory("Parfums")).rejects.toMatchObject({ code: "forbidden" });
  });
  it("réseau coupé : erreur « network »", async () => {
    h.state.rpcReply = () => { throw new TypeError("Failed to fetch"); };
    await expect(createAdminCategory("Parfums")).rejects.toMatchObject({ code: "network" });
  });
  it("fonction absente (migration non appliquée) : erreur explicite sur les catégories", async () => {
    h.state.rpcReply = { data: null, error: { code: "PGRST202", message: "Could not find the function public.admin_create_category(p_name) in the schema cache" } };
    await expect(createAdminCategory("Parfums")).rejects.toBeInstanceOf(CategoriesNotInstalledError);
  });
  it("réponse sans « ok » ou sans nom : jamais prise pour un succès", async () => {
    h.state.rpcReply = ok(null);
    await expect(createAdminCategory("Parfums")).rejects.toBeInstanceOf(AdminError);
    h.state.rpcReply = ok({ ok: true });
    await expect(createAdminCategory("Parfums")).rejects.toBeInstanceOf(AdminError);
    h.state.rpcReply = ok({ ok: true, name: "" });
    await expect(createAdminCategory("Parfums")).rejects.toBeInstanceOf(AdminError);
  });
});
