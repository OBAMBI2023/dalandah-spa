import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Faux client Supabase : on vérifie les noms et paramètres des fonctions appelées (ceux de la migration 20261026000000),
// la gestion des réponses métier et l'ordre des opérations Storage / base. Aucun appel réseau.
const h = vi.hoisted(() => {
  type Reply = { data: unknown; error: null | { message?: string; code?: string; status?: number } };
  const state = {
    calls: [] as { fn: string; args: Record<string, unknown> | undefined }[],
    storage: [] as string[],
    replies: {} as Record<string, Reply | (() => Reply)>,
    uploadError: null as null | { message: string; statusCode?: string },
    servicesUsing: 0,
    blobSize: 1000,
  };
  const publicBase = "https://ylixnbhpgbyofhvnfzqw.supabase.co/storage/v1/object/public/catalog-images/";
  const client = {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      state.calls.push({ fn, args });
      const r = state.replies[fn];
      if (!r) throw new Error(`réponse non prévue pour ${fn}`);
      return typeof r === "function" ? r() : r;
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          state.storage.push(`upload ${path}`);
          return state.uploadError ? { data: null, error: state.uploadError } : { data: { path }, error: null };
        },
        remove: async (paths: string[]) => { state.storage.push(`remove ${paths.join(",")}`); return { data: [], error: null }; },
        getPublicUrl: (path: string) => ({ data: { publicUrl: publicBase + path } }),
      }),
    },
    from: () => ({ select: () => ({ eq: async () => ({ count: state.servicesUsing, error: null }) }) }),
  };
  return { state, client, publicBase };
});

vi.mock("@/lib/supabase", () => ({ adminSupabase: h.client, supabase: null }));
vi.mock("@/lib/images", () => ({ compressImage: async () => new Blob([new Uint8Array(h.state.blobSize)], { type: "image/webp" }) }));

import { AdminError } from "@/lib/admin-api";
import {
  CatalogueNotInstalledError, ProductActionError, createAdminProduct, emptyProductForm, formToInput, isAvailable, isLowStock, listAdminProducts,
  createProductAuto, findCreated, nextId, nextSku, skuBase, withSuffix, productToInput, productFormSchema, productStats, productToForm, setProductActive, setProductImage, slugify, updateAdminProduct, type AdminProduct, type ProductInput,
} from "@/lib/admin-products";
import { newProductImagePath, removeProductImage, uploadProductImage } from "@/lib/admin-images";

const row = (o: Record<string, unknown> = {}) => ({
  id: "savon-melisse-2en1", sku: "DAL-SAV-MEL", name: "Savon Mélisse 2 en 1", category: "Nettoyants", short_description: "Résumé", description: "Texte",
  features: ["Gamme Dalanda", "Format pot"], usage_tips: "Matin et soir", volume: "200 ml", image_url: null, sale_price: 6000, cost_price: null,
  stock_qty: 20, low_stock_threshold: 3, active: true, is_demo: true, created_at: "2030-01-01T00:00:00Z", updated_at: "2030-01-01T00:00:00Z", ...o,
});
const ok = (data: unknown = { ok: true }) => ({ data, error: null });
const input: ProductInput = {
  sku: "DAL-1", name: "Produit", category: "Nettoyants", shortDescription: "", description: "", features: [], usageTips: null, volume: null,
  price: 1000, costPrice: null, lowStockThreshold: 0, active: true,
};
const OLD = `${h.publicBase}products/p1/1-old.webp`;
const file = () => new File([new Uint8Array(2000)], "p.jpg", { type: "image/jpeg" });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.state.calls = []; h.state.storage = []; h.state.replies = {}; h.state.uploadError = null; h.state.servicesUsing = 0; h.state.blobSize = 1000;
});
afterEach(() => vi.restoreAllMocks());

describe("lecture : admin_list_products", () => {
  it("appelle la fonction sans paramètre et convertit les lignes (coût inconnu = null, inactifs inclus)", async () => {
    h.state.replies["admin_list_products"] = ok([row(), row({ id: "cache", active: false, cost_price: 3500, features: null })]);
    const list = await listAdminProducts();

    expect(h.state.calls).toEqual([{ fn: "admin_list_products", args: undefined }]);
    expect(list[0]).toMatchObject({ id: "savon-melisse-2en1", price: 6000, costPrice: null, stock: 20, active: true, imageUrl: null });
    expect(list[1]).toMatchObject({ id: "cache", active: false, costPrice: 3500, features: [] });
  });

  it("refus d'autorisation : erreur « forbidden », jamais une liste vide", async () => {
    h.state.replies["admin_list_products"] = { data: null, error: { code: "42501", message: "réservé aux administrateurs" } };
    await expect(listAdminProducts()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("migration non appliquée (fonction introuvable) : erreur explicite", async () => {
    h.state.replies["admin_list_products"] = { data: null, error: { code: "PGRST202", message: "Could not find the function public.admin_list_products without parameters in the schema cache" } };
    const e = await listAdminProducts().catch((x) => x);
    expect(e).toBeInstanceOf(CatalogueNotInstalledError);
    expect(e.message).toMatch(/20261026000000_products_catalog\.sql.*pas été appliquée/);
  });

  it("réseau coupé : erreur « network »", async () => {
    h.state.replies["admin_list_products"] = () => { throw new TypeError("Failed to fetch"); };
    await expect(listAdminProducts()).rejects.toMatchObject({ code: "network" });
  });
});

describe("création : admin_create_product", () => {
  it("envoie exactement les 15 paramètres de la signature SQL, sans photo", async () => {
    h.state.replies["admin_create_product"] = ok({ ok: true, id: "produit" });
    await createAdminProduct({ ...input, id: "produit", initialQty: 12, costPrice: 400, features: ["A"], usageTips: "U", volume: "V" });

    const args = h.state.calls[0]!.args!;
    expect(Object.keys(args).sort()).toEqual([
      "p_active", "p_category", "p_cost_price", "p_description", "p_features", "p_id", "p_image_url", "p_initial_qty", "p_name",
      "p_sale_price", "p_short", "p_sku", "p_threshold", "p_usage", "p_volume",
    ]);
    expect(args).toMatchObject({ p_id: "produit", p_initial_qty: 12, p_sale_price: 1000, p_cost_price: 400, p_image_url: null, p_features: ["A"] });
  });

  it("erreur métier {ok:false} : le message de la base est conservé, ce n'est pas un succès", async () => {
    h.state.replies["admin_create_product"] = ok({ ok: false, code: "sku_taken", error: "Cette référence existe déjà." });
    const e = await createAdminProduct({ ...input, id: "p", initialQty: 0 }).catch((x) => x);
    expect(e).toBeInstanceOf(ProductActionError);
    expect(e).toMatchObject({ reason: "sku_taken", message: "Cette référence existe déjà." });
  });

  it("réponse sans « ok » : refusée comme une erreur", async () => {
    h.state.replies["admin_create_product"] = ok(null);
    await expect(createAdminProduct({ ...input, id: "p", initialQty: 0 })).rejects.toBeInstanceOf(AdminError);
  });
});

describe("modification : admin_update_product", () => {
  it("envoie exactement les 13 paramètres de la signature SQL : ni photo, ni stock", async () => {
    h.state.replies["admin_update_product"] = ok({ ok: true, id: "p1" });
    await updateAdminProduct("p1", { ...input, costPrice: null });

    const args = h.state.calls[0]!.args!;
    expect(Object.keys(args).sort()).toEqual([
      "p_active", "p_category", "p_cost_price", "p_description", "p_features", "p_id", "p_name", "p_sale_price", "p_short", "p_sku",
      "p_threshold", "p_usage", "p_volume",
    ]);
    expect(args).not.toHaveProperty("p_image_url");
    expect(args).not.toHaveProperty("p_initial_qty");
    expect(args["p_cost_price"]).toBeNull();
  });

  it("produit introuvable : erreur métier affichable", async () => {
    h.state.replies["admin_update_product"] = ok({ ok: false, code: "not_found", error: "Produit introuvable." });
    await expect(updateAdminProduct("zz", input)).rejects.toMatchObject({ reason: "not_found", message: "Produit introuvable." });
  });
});

describe("désactivation : jamais de suppression", () => {
  it("relit la fiche à jour puis appelle admin_update_product avec active inversé et tous les autres champs inchangés", async () => {
    h.state.replies["admin_list_products"] = ok([row({ cost_price: 2500 })]);
    h.state.replies["admin_update_product"] = ok({ ok: true, id: "savon-melisse-2en1" });
    await setProductActive("savon-melisse-2en1", false);

    expect(h.state.calls.map((c) => c.fn)).toEqual(["admin_list_products", "admin_update_product"]);
    expect(h.state.calls[1]!.args).toMatchObject({
      p_id: "savon-melisse-2en1", p_active: false, p_sku: "DAL-SAV-MEL", p_name: "Savon Mélisse 2 en 1", p_sale_price: 6000, p_cost_price: 2500,
      p_features: ["Gamme Dalanda", "Format pot"], p_usage: "Matin et soir", p_volume: "200 ml", p_threshold: 3, p_short: "Résumé", p_description: "Texte",
    });
    expect(h.state.calls.some((c) => /delete|remove|drop/i.test(c.fn))).toBe(false);
  });

  it("réactivation : active passe à true", async () => {
    h.state.replies["admin_list_products"] = ok([row({ active: false })]);
    h.state.replies["admin_update_product"] = ok({ ok: true });
    await setProductActive("savon-melisse-2en1", true);
    expect(h.state.calls[1]!.args).toMatchObject({ p_active: true });
  });

  it("produit absent de la liste : aucune écriture", async () => {
    h.state.replies["admin_list_products"] = ok([]);
    await expect(setProductActive("fantome", false)).rejects.toMatchObject({ reason: "not_found" });
    expect(h.state.calls.map((c) => c.fn)).toEqual(["admin_list_products"]);
  });
});

describe("photo : admin_set_product_image et Storage", () => {
  it("setProductImage envoie p_id et p_image_url, seuls paramètres de la fonction", async () => {
    h.state.replies["admin_set_product_image"] = ok({ ok: true });
    await setProductImage("p1", "https://x/y.webp");
    expect(h.state.calls[0]).toEqual({ fn: "admin_set_product_image", args: { p_id: "p1", p_image_url: "https://x/y.webp" } });
  });

  it("chemins uniques dans products/<id>/", () => {
    expect(newProductImagePath("p1", 5, "abc")).toBe("products/p1/5-abc.webp");
    expect(newProductImagePath("p1", 5, "abc")).not.toBe(newProductImagePath("p1", 6, "abc"));
  });

  it("remplacement réussi : envoi, référence en base, puis suppression de l'ancien fichier inutilisé", async () => {
    h.state.replies["admin_set_product_image"] = ok({ ok: true });
    h.state.replies["admin_list_products"] = ok([row({ id: "p1", image_url: "nouvelle" }), row({ id: "autre", image_url: null })]);
    const url = await uploadProductImage("p1", file(), OLD);

    expect(url).toMatch(/catalog-images\/products\/p1\/.+\.webp$/);
    expect(h.state.calls[0]).toMatchObject({ fn: "admin_set_product_image", args: { p_id: "p1", p_image_url: url } });
    expect(h.state.storage[0]).toMatch(/^upload products\/p1\//);
    expect(h.state.storage[1]).toBe("remove products/p1/1-old.webp");
  });

  it("l'ancien fichier est conservé s'il est encore utilisé par un autre produit INACTIF", async () => {
    h.state.replies["admin_set_product_image"] = ok({ ok: true });
    h.state.replies["admin_list_products"] = ok([row({ id: "p1" }), row({ id: "cache", active: false, image_url: OLD })]);
    await uploadProductImage("p1", file(), OLD);
    expect(h.state.storage.some((s) => s.startsWith("remove"))).toBe(false);
  });

  it("l'ancien fichier est conservé s'il est utilisé par une prestation", async () => {
    h.state.replies["admin_set_product_image"] = ok({ ok: true });
    h.state.replies["admin_list_products"] = ok([row({ id: "p1" })]);
    h.state.servicesUsing = 1;
    await uploadProductImage("p1", file(), OLD);
    expect(h.state.storage.some((s) => s.startsWith("remove"))).toBe(false);
  });

  it("au moindre doute (relecture des produits impossible), rien n'est supprimé", async () => {
    h.state.replies["admin_set_product_image"] = ok({ ok: true });
    h.state.replies["admin_list_products"] = { data: null, error: { message: "boom" } };
    await uploadProductImage("p1", file(), OLD);
    expect(h.state.storage.some((s) => s.startsWith("remove"))).toBe(false);
  });

  it("échec de l'enregistrement en base : le nouvel objet est retiré, l'ancienne photo n'est pas touchée", async () => {
    h.state.replies["admin_set_product_image"] = ok({ ok: false, code: "not_found", error: "Produit introuvable." });
    await expect(uploadProductImage("p1", file(), OLD)).rejects.toMatchObject({ message: "Produit introuvable." });

    expect(h.state.storage).toHaveLength(2);
    expect(h.state.storage[0]).toMatch(/^upload products\/p1\/(.+)\.webp$/);
    expect(h.state.storage[1]).toBe(h.state.storage[0]!.replace("upload ", "remove "));
    expect(h.state.storage).not.toContain("remove products/p1/1-old.webp");
  });

  it("échec du téléversement : aucune référence en base", async () => {
    h.state.uploadError = { message: "Bucket not found", statusCode: "404" };
    await expect(uploadProductImage("p1", file(), OLD)).rejects.toBeInstanceOf(AdminError);
    expect(h.state.calls).toHaveLength(0);
  });

  it("format refusé : rien n'est envoyé", async () => {
    await expect(uploadProductImage("p1", new File([new Uint8Array(10)], "d.pdf", { type: "application/pdf" }), null)).rejects.toThrow(/JPEG, PNG ou WebP/);
    expect(h.state.storage).toHaveLength(0);
    expect(h.state.calls).toHaveLength(0);
  });

  it("suppression : référence effacée (null) avant toute suppression de fichier", async () => {
    h.state.replies["admin_set_product_image"] = ok({ ok: true });
    h.state.replies["admin_list_products"] = ok([row({ id: "p1", image_url: null })]);
    await removeProductImage("p1", OLD);
    expect(h.state.calls[0]).toEqual({ fn: "admin_set_product_image", args: { p_id: "p1", p_image_url: null } });
    expect(h.state.storage).toEqual(["remove products/p1/1-old.webp"]);
  });
});

describe("disponibilité et statistiques", () => {
  const p = (active: boolean, stock: number, thr = 0) => ({ active, stock, lowStockThreshold: thr }) as AdminProduct;
  it("disponible = actif ET stock > 0 ; un stock nul ou un produit inactif ne l'est pas", () => {
    expect(isAvailable(p(true, 5))).toBe(true);
    expect(isAvailable(p(true, 0))).toBe(false);
    expect(isAvailable(p(false, 5))).toBe(false);
  });
  it("stock bas : seuil > 0 et stock ≤ seuil", () => {
    expect(isLowStock(p(true, 3, 3))).toBe(true);
    expect(isLowStock(p(true, 4, 3))).toBe(false);
    expect(isLowStock(p(true, 0, 0))).toBe(false);
  });
  it("statistiques calculées sur les produits chargés", () => {
    expect(productStats([p(true, 5), p(true, 0), p(false, 9)] as AdminProduct[])).toEqual({ total: 3, active: 2, unavailable: 2 });
    expect(productStats([])).toEqual({ total: 0, active: 0, unavailable: 0 });
  });
});

describe("formulaire : identifiant et validation", () => {
  const valid = { ...emptyProductForm, name: "Savon Mélisse", category: "Nettoyants", price: "6 000", initialQty: "10" };
  const issues = (v: Partial<typeof valid>) => {
    const r = productFormSchema.safeParse({ ...valid, ...v });
    return r.success ? [] : r.error.issues.map((i) => i.path.join(".") + ": " + i.message);
  };

  it("slug : accents retirés, tirets, 60 caractères au plus, forme ^[a-z0-9-]{2,60}$", () => {
    expect(slugify("Savon Mélisse 2 en 1")).toBe("savon-melisse-2-en-1");
    expect(slugify("  Huile  Caviar !! ")).toBe("huile-caviar");
    expect(slugify("é".repeat(100)).length).toBeLessThanOrEqual(60);
    expect(slugify("!!")).toBe("");
  });
  it("accepte une saisie valide (espaces de milliers tolérés) ; le formulaire n'a plus ni référence ni résumé ni caractéristiques", () => {
    expect(issues({})).toEqual([]);
    expect(formToInput(productFormSchema.parse(valid))).toMatchObject({ price: 6000, costPrice: null, active: true, sku: "", features: [], usageTips: null, volume: null });
    expect(Object.keys(productFormSchema.shape).sort()).toEqual(["active", "category", "costPrice", "description", "initialQty", "lowStockThreshold", "name", "price"]);
  });
  it("champs obligatoires et limites de la base : nom, catégorie, prix, stock initial", () => {
    expect(issues({ name: "A" })).toEqual(expect.arrayContaining([expect.stringMatching(/^name/)]));
    expect(issues({ category: "" })).toEqual(expect.arrayContaining([expect.stringMatching(/^category/)]));
    expect(issues({ price: "" })).toEqual(expect.arrayContaining([expect.stringMatching(/^price/)]));
    expect(issues({ price: "-5" })).toEqual(expect.arrayContaining([expect.stringMatching(/^price/)]));
    expect(issues({ price: "12,5" })).toEqual(expect.arrayContaining([expect.stringMatching(/^price/)]));
    expect(issues({ price: "abc" })).toEqual(expect.arrayContaining([expect.stringMatching(/^price/)]));
    expect(issues({ price: "100000001" })).toEqual(expect.arrayContaining([expect.stringMatching(/^price.*maximum/)]));
    expect(issues({ initialQty: "" })).toEqual(expect.arrayContaining([expect.stringMatching(/^initialQty/)]));
    expect(issues({ initialQty: "-1" })).toEqual(expect.arrayContaining([expect.stringMatching(/^initialQty/)]));
    expect(issues({ initialQty: "2,5" })).toEqual(expect.arrayContaining([expect.stringMatching(/^initialQty/)]));
    expect(issues({ initialQty: "1000001" })).toEqual(expect.arrayContaining([expect.stringMatching(/^initialQty/)]));
    expect(issues({ costPrice: "abc" })).toEqual(expect.arrayContaining([expect.stringMatching(/^costPrice/)]));
    expect(issues({ lowStockThreshold: "-2" })).toEqual(expect.arrayContaining([expect.stringMatching(/^lowStockThreshold/)]));
    expect(issues({ description: "x".repeat(2001) })).toEqual(expect.arrayContaining([expect.stringMatching(/^description/)]));
  });
  it("stock initial 0 accepté ; coût vide = coût inconnu (null) ; seuil vide = 0", () => {
    expect(issues({ initialQty: "0" })).toEqual([]);
    expect(formToInput(productFormSchema.parse({ ...valid, costPrice: "" })).costPrice).toBeNull();
    expect(formToInput(productFormSchema.parse({ ...valid, costPrice: "0" })).costPrice).toBe(0);
    expect(issues({ lowStockThreshold: "" })).toEqual([]);
    expect(formToInput(productFormSchema.parse({ ...valid, lowStockThreshold: "" })).lowStockThreshold).toBe(0);
    expect(formToInput(productFormSchema.parse({ ...valid, lowStockThreshold: "3" })).lowStockThreshold).toBe(3);
  });

  const existing: AdminProduct = { id: "p", sku: "DAL-OLD-1", name: "N", category: "C", shortDescription: "Résumé conservé", description: "d", features: ["a", "b"], usageTips: "Matin",
    volume: "50 ml", imageUrl: "https://x/y.webp", price: 100, costPrice: null, stock: 7, lowStockThreshold: 2, active: false, isDemo: false, createdAt: "", updatedAt: "" };

  it("modification : le formulaire reprend la fiche, sans stock ni photo", () => {
    const form = productToForm(existing);
    expect(form).toMatchObject({ costPrice: "", price: "100", active: false, description: "d" });
    expect(form).not.toHaveProperty("imageUrl");
    expect(formToInput(form, productToInput(existing))).not.toHaveProperty("imageUrl");
  });
  it("modification : référence, résumé, caractéristiques, contenance et conseils (retirés du formulaire) sont renvoyés tels quels, jamais effacés", async () => {
    h.state.replies["admin_update_product"] = ok({ ok: true, id: "p" });
    const input = formToInput(productToForm({ ...existing, name: "Nouveau nom" }), productToInput(existing));
    await updateAdminProduct("p", input);
    expect(h.state.calls[0]!.args).toMatchObject({
      p_sku: "DAL-OLD-1", p_short: "Résumé conservé", p_features: ["a", "b"], p_usage: "Matin", p_volume: "50 ml", p_threshold: 2, p_active: false,
    });
  });
});

describe("référence produit générée", () => {
  it("règle : préfixe DAL-, majuscules, sans accents ni caractères spéciaux, espaces en tirets", () => {
    expect(skuBase("Gel douche")).toBe("DAL-GEL-DOUCHE");
    expect(skuBase("Huile Caviar")).toBe("DAL-HUILE-CAVIAR");
    expect(skuBase("Savon cristal")).toBe("DAL-SAVON-CRISTAL");
    expect(skuBase("Savon Mélisse 2 en 1")).toBe("DAL-SAVON-MELISSE-2-EN-1");
    expect(skuBase("  Crème   à l'huile d'argan !! ")).toBe("DAL-CREME-A-L-HUILE-D-ARGAN");
    expect(skuBase("Été & Soleil")).toBe("DAL-ETE-SOLEIL");
  });
  it("nom vide ou sans lettre ni chiffre : aucune référence (« Générée après saisie du nom »)", () => {
    expect(skuBase("")).toBe("");
    expect(skuBase("   ")).toBe("");
    expect(skuBase("!!! ???")).toBe("");
    expect(nextSku("", ["DAL-A"])).toBe("");
  });
  it("toujours conforme à la contrainte de la base, même pour un très long nom (la base est raccourcie, jamais le suffixe)", () => {
    const re = /^[A-Z0-9][A-Z0-9._-]{1,39}$/;
    const long = "Huile de soin nourrissante pour le corps et le visage aux extraits naturels";
    expect(re.test(skuBase(long).slice(0, 40))).toBe(true);
    expect(nextSku(long, []).length).toBeLessThanOrEqual(40);
    const taken = [nextSku(long, [])];
    const second = nextSku(long, taken);
    expect(second).not.toBe(taken[0]);
    expect(second.length).toBeLessThanOrEqual(40);
    expect(second.endsWith("-2")).toBe(true);
    expect(re.test(second)).toBe(true);
    expect(withSuffix("DAL-" + "A".repeat(60), 12, 40)).toBe("DAL-" + "A".repeat(33) + "-12");
    expect(withSuffix("DAL-ABC-", 1, 40)).toBe("DAL-ABC");
  });
  it("doublon : -2, puis -3 (comparaison sans tenir compte de la casse) ; une référence existante n'est jamais reprise", () => {
    expect(nextSku("Savon cristal", [])).toBe("DAL-SAVON-CRISTAL");
    expect(nextSku("Savon cristal", ["DAL-SAVON-CRISTAL"])).toBe("DAL-SAVON-CRISTAL-2");
    expect(nextSku("Savon cristal", ["dal-savon-cristal", "DAL-SAVON-CRISTAL-2"])).toBe("DAL-SAVON-CRISTAL-3");
    expect(nextSku("Savon cristal", ["DAL-SAV-CRI"])).toBe("DAL-SAVON-CRISTAL"); // une référence existante différente ne gêne pas
  });
  it("adresse du produit : même principe pour deux noms identiques", () => {
    expect(nextId("Gel douche", [])).toBe("gel-douche");
    expect(nextId("Gel douche", ["gel-douche"])).toBe("gel-douche-2");
    expect(nextId("Gel douche", ["gel-douche", "gel-douche-2"])).toBe("gel-douche-3");
    expect(nextId("!", [])).toBe("");
  });
});

describe("création avec référence générée : createProductAuto", () => {
  const base = { ...input, name: "Gel douche", initialQty: 5 };
  const none = { ids: [] as string[], skus: [] as string[] };
  const created = () => h.state.calls.filter((c) => c.fn === "admin_create_product");

  it("nom simple : envoie l'adresse et la référence générées, sans photo, et rend l'une et l'autre", async () => {
    h.state.replies["admin_create_product"] = ok({ ok: true });
    const r = await createProductAuto(base, none);
    expect(r).toEqual({ id: "gel-douche", sku: "DAL-GEL-DOUCHE" });
    expect(created()).toHaveLength(1);
    expect(created()[0]!.args).toMatchObject({ p_id: "gel-douche", p_sku: "DAL-GEL-DOUCHE", p_name: "Gel douche", p_initial_qty: 5, p_image_url: null });
  });
  it("nom avec accents", async () => {
    h.state.replies["admin_create_product"] = ok({ ok: true });
    const r = await createProductAuto({ ...base, name: "Savon Mélisse 2 en 1" }, none);
    expect(r).toEqual({ id: "savon-melisse-2-en-1", sku: "DAL-SAVON-MELISSE-2-EN-1" });
  });
  it("deux produits au même nom : la 2ᵉ création reçoit -2 d'après la liste déjà chargée", async () => {
    h.state.replies["admin_create_product"] = ok({ ok: true });
    const r = await createProductAuto(base, { ids: ["gel-douche"], skus: ["DAL-GEL-DOUCHE"] });
    expect(r).toEqual({ id: "gel-douche-2", sku: "DAL-GEL-DOUCHE-2" });
  });
  it("doublon créé en même temps par un autre administrateur : la base refuse (sku_taken), on retente avec -2 sans rien écrire en double", async () => {
    let n = 0;
    h.state.replies["admin_create_product"] = () => (++n === 1 ? ok({ ok: false, code: "sku_taken", error: "Cette référence existe déjà." }) : ok({ ok: true }));
    const r = await createProductAuto(base, none);
    expect(created().map((c) => c.args!["p_sku"])).toEqual(["DAL-GEL-DOUCHE", "DAL-GEL-DOUCHE-2"]);
    expect(created().map((c) => c.args!["p_id"])).toEqual(["gel-douche", "gel-douche"]);
    expect(r.sku).toBe("DAL-GEL-DOUCHE-2");
  });
  it("adresse déjà prise en parallèle (id_taken) : -2 sur l'adresse seulement, la référence reste libre", async () => {
    let n = 0;
    h.state.replies["admin_create_product"] = () => (++n === 1 ? ok({ ok: false, code: "id_taken", error: "Un produit porte déjà cet identifiant." }) : ok({ ok: true }));
    const r = await createProductAuto(base, none);
    expect(r).toEqual({ id: "gel-douche-2", sku: "DAL-GEL-DOUCHE" });
  });
  it("plusieurs conflits successifs : -2, -3, -4 puis succès", async () => {
    let n = 0;
    h.state.replies["admin_create_product"] = () => (++n < 4 ? ok({ ok: false, code: "sku_taken", error: "Cette référence existe déjà." }) : ok({ ok: true }));
    const r = await createProductAuto(base, none);
    expect(created().map((c) => c.args!["p_sku"])).toEqual(["DAL-GEL-DOUCHE", "DAL-GEL-DOUCHE-2", "DAL-GEL-DOUCHE-3", "DAL-GEL-DOUCHE-4"]);
    expect(r.sku).toBe("DAL-GEL-DOUCHE-4");
  });
  it("conflits sans fin : abandon après 25 tentatives avec un message clair", async () => {
    h.state.replies["admin_create_product"] = ok({ ok: false, code: "sku_taken", error: "Cette référence existe déjà." });
    await expect(createProductAuto(base, none)).rejects.toMatchObject({ reason: "sku_taken", message: expect.stringMatching(/Impossible de générer une référence unique/) });
    expect(created()).toHaveLength(25);
  });
  it("échec réseau : aucune nouvelle tentative, erreur « network »", async () => {
    h.state.replies["admin_create_product"] = () => { throw new TypeError("Failed to fetch"); };
    await expect(createProductAuto(base, none)).rejects.toMatchObject({ code: "network" });
    expect(created()).toHaveLength(1);
  });
  it("refus d'autorisation : aucune nouvelle tentative", async () => {
    h.state.replies["admin_create_product"] = { data: null, error: { code: "42501", message: "réservé aux administrateurs" } };
    await expect(createProductAuto(base, none)).rejects.toMatchObject({ code: "forbidden" });
    expect(created()).toHaveLength(1);
  });
  it("erreur de validation de la base (prix invalide) : renvoyée telle quelle, sans nouvelle tentative", async () => {
    h.state.replies["admin_create_product"] = ok({ ok: false, code: "invalid_input", error: "Prix de vente invalide." });
    await expect(createProductAuto(base, none)).rejects.toMatchObject({ reason: "invalid_input", message: "Prix de vente invalide." });
    expect(created()).toHaveLength(1);
  });
  it("chaque essai est signalé avant son envoi, et seule la valeur en conflit change d'un essai à l'autre (jamais une valeur déjà refusée)", async () => {
    const seen: { id: string; sku: string }[] = [];
    const replies = [
      ok({ ok: false, code: "sku_taken", error: "Cette référence existe déjà." }),
      ok({ ok: false, code: "id_taken", error: "Un produit porte déjà cet identifiant." }),
      ok({ ok: false, code: "sku_taken", error: "Cette référence existe déjà." }),
      ok({ ok: true }),
    ];
    h.state.replies["admin_create_product"] = () => replies.shift()!;
    const r = await createProductAuto(base, none, { onAttempt: (a) => seen.push(a) });
    expect(seen).toEqual([
      { id: "gel-douche", sku: "DAL-GEL-DOUCHE" },
      { id: "gel-douche", sku: "DAL-GEL-DOUCHE-2" },   // sku_taken : la référence change, l'adresse n'était pas en cause
      { id: "gel-douche-2", sku: "DAL-GEL-DOUCHE-2" }, // id_taken : l'adresse change
      { id: "gel-douche-2", sku: "DAL-GEL-DOUCHE-3" }, // sku_taken : la référence change encore
    ]);
    expect(new Set(seen.map((a) => a.id + "|" + a.sku)).size).toBe(seen.length); // aucun essai rejoué à l'identique
    expect(r).toEqual({ id: "gel-douche-2", sku: "DAL-GEL-DOUCHE-3" });
  });
  it("réseau coupé : l'essai en cours est signalé (réponse peut-être perdue) mais jamais rejoué", async () => {
    const seen: { id: string; sku: string }[] = [];
    h.state.replies["admin_create_product"] = () => { throw new TypeError("Failed to fetch"); };
    await expect(createProductAuto(base, none, { onAttempt: (a) => seen.push(a) })).rejects.toMatchObject({ code: "network" });
    expect(seen).toEqual([{ id: "gel-douche", sku: "DAL-GEL-DOUCHE" }]);
    expect(created()).toHaveLength(1);
  });
  it("longueurs respectées à chaque essai, suffixe compris (adresse ≤ 60, référence ≤ 40)", async () => {
    const longName = "Huile de soin nourrissante pour le corps et le visage aux extraits naturels et bio";
    const seen: { id: string; sku: string }[] = [];
    let n = 0;
    h.state.replies["admin_create_product"] = () => (++n < 12 ? ok({ ok: false, code: n % 2 ? "sku_taken" : "id_taken", error: "x" }) : ok({ ok: true }));
    await createProductAuto({ ...base, name: longName }, none, { onAttempt: (a) => seen.push(a) });
    expect(seen.length).toBe(12);
    for (const a of seen) {
      expect(a.sku.length).toBeLessThanOrEqual(40);
      expect(a.id.length).toBeLessThanOrEqual(60);
      expect(a.sku).toMatch(/^[A-Z0-9][A-Z0-9._-]{1,39}$/);
      expect(a.id).toMatch(/^[a-z0-9-]{2,60}$/);
    }
  });
  it("erreur de la base autre que l'unicité (id_taken/sku_taken) : jamais de nouvelle tentative", async () => {
    for (const reply of [
      ok({ ok: false, code: "invalid_input", error: "Prix de vente invalide." }),
      ok({ ok: false, code: "not_found", error: "x" }),
      ok({ ok: false, code: "autre", error: "x" }),
      { data: null, error: { code: "42501", message: "réservé aux administrateurs" } },
      { data: null, error: { code: "PGRST202", message: "Could not find the function" } },
      { data: null, error: { code: "XX000", message: "boom" } },
    ]) {
      h.state.calls = [];
      h.state.replies["admin_create_product"] = reply;
      await expect(createProductAuto(base, none)).rejects.toBeInstanceOf(AdminError);
      expect(created()).toHaveLength(1);
    }
  });
  it("findCreated : adopte seulement CE produit (même adresse, même référence, même nom)", () => {
    const list = [{ id: "gel-douche", sku: "DAL-GEL-DOUCHE", name: "Gel douche" }];
    expect(findCreated(list, { id: "gel-douche", sku: "DAL-GEL-DOUCHE" }, " Gel douche ")).toBe(list[0]);
    expect(findCreated(list, { id: "gel-douche", sku: "DAL-GEL-DOUCHE-2" }, "Gel douche")).toBeNull();
    expect(findCreated(list, { id: "gel-douche-2", sku: "DAL-GEL-DOUCHE" }, "Gel douche")).toBeNull();
    expect(findCreated(list, { id: "gel-douche", sku: "DAL-GEL-DOUCHE" }, "Autre nom")).toBeNull();
    expect(findCreated([], { id: "gel-douche", sku: "DAL-GEL-DOUCHE" }, "Gel douche")).toBeNull();
  });
  it("nom inutilisable : refusé avant tout appel", async () => {
    await expect(createProductAuto({ ...base, name: "!!" }, none)).rejects.toMatchObject({ reason: "invalid_input" });
    expect(h.state.calls).toHaveLength(0);
  });
});
