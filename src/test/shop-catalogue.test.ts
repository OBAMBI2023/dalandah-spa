import { describe, expect, it } from "vitest";
import { products as localProducts } from "@/data/products";
import type { DataClient } from "@/lib/api";
import { SHOP_COLUMNS, createShopApi, reconcileLines, toShopProduct, type ShopRow } from "@/lib/shop";

const row = (o: Partial<ShopRow> = {}): ShopRow => ({
  id: "nouveau-produit", name: "Nouveau produit", category: "Hydratation", short_description: "Résumé", description: "Texte", features: ["A", "B"],
  usage_tips: null, volume: null, image_url: null, sale_price: 7000, stock_qty: 5, ...o,
});

function fake(result: { data: unknown; error: { message: string } | null }) {
  const calls: { table: string; columns: string; order: string }[] = [];
  const client = {
    from: (table: string) => ({ select: (columns: string) => ({ order: (order: string) => { calls.push({ table, columns, order }); return Promise.resolve(result); } }) }),
    rpc: () => { throw new Error("aucune fonction ne doit être appelée"); },
  };
  return { client: client as unknown as DataClient, calls };
}

describe("requête publique de la boutique", () => {
  it("lit public.products avec exactement les 11 colonnes ouvertes à anon, triées par nom", async () => {
    const { client, calls } = fake({ data: [], error: null });
    await createShopApi(client).fetchProducts();

    expect(calls).toEqual([{ table: "products", columns: SHOP_COLUMNS, order: "name" }]);
    expect(SHOP_COLUMNS.split(",").sort()).toEqual([
      "category", "description", "features", "id", "image_url", "name", "sale_price", "short_description", "stock_qty", "usage_tips", "volume",
    ]);
  });

  it("ne demande jamais le coût, la référence, le seuil, le statut, les dates, ni « * » (colonnes refusées à anon)", () => {
    for (const c of ["cost_price", "sku", "low_stock_threshold", "active", "is_demo", "created_at", "updated_at", "*"]) {
      expect(SHOP_COLUMNS.split(",")).not.toContain(c);
    }
    expect(SHOP_COLUMNS).not.toMatch(/cost|margin|threshold|\*/);
  });

  it("ne contient aucun filtre sur « active » : la RLS ne renvoie que les produits actifs", async () => {
    const { client } = fake({ data: [], error: null });
    // Le faux client n'expose ni eq() ni filter() : un filtre ferait échouer l'appel.
    await expect(createShopApi(client).fetchProducts()).resolves.toEqual([]);
  });

  it("erreur du serveur : l'erreur est levée, sans repli sur les produits du code", async () => {
    const { client } = fake({ data: null, error: { message: "permission denied for table products" } });
    await expect(createShopApi(client).fetchProducts()).rejects.toThrow("catalogue indisponible");
  });

  it("réponse vide : liste vide (et non les produits du code)", async () => {
    const { client } = fake({ data: null, error: null });
    await expect(createShopApi(client).fetchProducts()).resolves.toEqual([]);
  });

  it("sans Supabase (mode local) : produits du code", async () => {
    const api = createShopApi(null);
    expect(api.remote).toBe(false);
    expect(await api.fetchProducts()).toBe(localProducts);
  });
});

describe("conversion d'une ligne de la base en produit de boutique", () => {
  it("prix en FCFA, stock, textes et caractéristiques repris de la base", () => {
    expect(toShopProduct(row({ usage_tips: "Matin", volume: "200 ml" }))).toMatchObject({
      id: "nouveau-produit", name: "Nouveau produit", category: "Hydratation", price: 7000, stock: 5, available: true,
      shortDescription: "Résumé", description: "Texte", features: ["A", "B"], usage: "Matin", volume: "200 ml",
    });
  });

  it("disponible = en stock : un stock nul rend le produit indisponible", () => {
    expect(toShopProduct(row({ stock_qty: 0 }))).toMatchObject({ available: false, stock: 0 });
    expect(toShopProduct(row({ stock_qty: 1 })).available).toBe(true);
  });

  it("champs facultatifs absents : pas de « usage » ni de « volume », caractéristiques vides si null", () => {
    const p = toShopProduct(row({ features: null }));
    expect(p.features).toEqual([]);
    expect(p).not.toHaveProperty("usage");
    expect(p).not.toHaveProperty("volume");
  });

  it("photo téléversée prioritaire ; sinon images du code de même identifiant ; sinon aucune", () => {
    const url = "https://x.supabase.co/storage/v1/object/public/catalog-images/products/gel-douche/1.webp";
    expect(toShopProduct(row({ id: "gel-douche", image_url: url })).images).toEqual([url]);
    expect(toShopProduct(row({ id: "gel-douche" })).images).toEqual(localProducts.find((p) => p.id === "gel-douche")!.images);
    expect(toShopProduct(row({ id: "produit-sans-image" })).images).toEqual([]);
  });

  it("catégorie libre acceptée, aucune donnée interne exposée dans l'objet", () => {
    const p = toShopProduct(row({ category: "Catégorie inédite" }));
    expect(p.category).toBe("Catégorie inédite");
    expect(Object.keys(p)).not.toEqual(expect.arrayContaining(["costPrice", "cost_price", "sku", "active", "lowStockThreshold"]));
  });
});

describe("panier réconcilié avec le catalogue", () => {
  const line = (o: Partial<{ id: string; name: string; price: number; qty: number }> = {}) => ({ id: "gel-douche", name: "Gel douche", price: 5500, qty: 2, ...o });
  const gel = (o: Partial<ShopRow> = {}) => toShopProduct(row({ id: "gel-douche", name: "Gel douche", sale_price: 5500, stock_qty: 12, ...o }));

  it("rien ne change : pas de modification signalée", () => {
    expect(reconcileLines([line()], [gel()])).toMatchObject({ changed: false, removed: [], lines: [line()] });
  });
  it("nouveau prix et nouveau nom du catalogue appliqués", () => {
    const r = reconcileLines([line()], [gel({ sale_price: 6000, name: "Gel douche sensible" })]);
    expect(r.changed).toBe(true);
    expect(r.lines[0]).toMatchObject({ price: 6000, name: "Gel douche sensible", qty: 2 });
  });
  it("quantité plafonnée au stock", () => {
    expect(reconcileLines([line({ qty: 9 })], [gel({ stock_qty: 4 })]).lines[0]!.qty).toBe(4);
  });
  it("produit absent du catalogue (désactivé ou supprimé) : retiré et signalé par son nom", () => {
    const r = reconcileLines([line(), line({ id: "autre", name: "Autre produit" })], [gel()]);
    expect(r.removed).toEqual(["Autre produit"]);
    expect(r.lines.map((l) => l.id)).toEqual(["gel-douche"]);
    expect(r.changed).toBe(true);
  });
  it("produit en rupture de stock : retiré et signalé", () => {
    const r = reconcileLines([line()], [gel({ stock_qty: 0 })]);
    expect(r.lines).toEqual([]);
    expect(r.removed).toEqual(["Gel douche"]);
  });
  it("panier vide : rien à faire", () => {
    expect(reconcileLines([], [gel()])).toEqual({ lines: [], removed: [], changed: false });
  });
});
