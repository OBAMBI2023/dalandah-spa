import { products as localProducts, type Product } from "@/data/products";
import type { DataClient } from "@/lib/api";
import { supabase } from "@/lib/supabase";

// Catalogue public de la boutique.
//  - Avec Supabase : lu dans public.products avec la clé publique. La RLS ne renvoie que les produits ACTIFS ; la colonne
//    `active` n'est pas lisible par `anon` : ne pas la filtrer ici, ne pas faire `select *`, ne jamais demander cost_price.
//  - Sans Supabase (variables absentes) : produits du code, pour développer et démontrer.
// En cas d'erreur du serveur, AUCUN repli sur les données du code : elles pourraient proposer à la vente un produit
// désactivé ou à un ancien prix.

/** Requête de la boutique publique : exactement les colonnes ouvertes à anon (voir la migration 20261026000000). */
export const SHOP_COLUMNS = "id,name,category,short_description,description,features,usage_tips,volume,image_url,sale_price,stock_qty";
export const SHOP_KEY = ["shop", "products"] as const;

export type ShopRow = {
  id: string; name: string; category: string; short_description: string; description: string; features: string[] | null;
  usage_tips: string | null; volume: string | null; image_url: string | null; sale_price: number; stock_qty: number;
};

/** Début de la description, pour la carte d'un produit sans résumé. */
const excerpt = (text: string, max = 110) => {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = /\s/.test(t.charAt(max)) ? t.slice(0, max) : t.slice(0, max).replace(/\s+\S*$/, "");
  return `${cut.trimEnd()}…`;
};

/** Produit de la base -> produit de la boutique. Disponible = en stock (les produits inactifs ne sont jamais renvoyés). */
export function toShopProduct(r: ShopRow): Product {
  // Photo téléversée en priorité ; sinon les images du code portant le même identifiant (image par défaut).
  const local = localProducts.find((l) => l.id === r.id);
  const product: Product = {
    id: r.id, name: r.name, category: r.category, price: r.sale_price,
    images: r.image_url ? [r.image_url] : (local?.images ?? []),
    shortDescription: r.short_description || excerpt(r.description), description: r.description, features: r.features ?? [],
    available: r.stock_qty > 0, stock: r.stock_qty, seo: `${r.name} Dalanda Cosmétique`,
  };
  if (r.usage_tips) product.usage = r.usage_tips;
  if (r.volume) product.volume = r.volume;
  return product;
}

export function createShopApi(client: DataClient | null) {
  return {
    remote: client !== null,
    /** Produits en vente. Lève une erreur si le serveur est injoignable (react-query réessaie). */
    async fetchProducts(): Promise<Product[]> {
      if (!client) return localProducts;
      const { data, error } = await client.from("products").select(SHOP_COLUMNS).order("name");
      if (error) throw new Error("catalogue indisponible");
      return ((data as ShopRow[] | null) ?? []).map(toShopProduct);
    },
  };
}

export const shopApi = createShopApi(supabase as unknown as DataClient | null);

/** Quantité du panier ajustée au catalogue : prix et nom à jour, plafond au stock, produits indisponibles retirés. */
export function reconcileLines<L extends { id: string; name: string; price: number; qty: number }>(stored: L[], products: Product[]) {
  const lines: L[] = [];
  const removed: string[] = [];
  for (const l of stored) {
    const p = products.find((x) => x.id === l.id);
    if (!p || !p.available || (p.stock ?? 99) < 1) { removed.push(l.name); continue; }
    lines.push({ ...l, name: p.name, price: p.price, qty: Math.max(1, Math.min(l.qty, p.stock ?? 99)) });
  }
  const changed = removed.length > 0 || lines.some((l, i) => {
    const o = stored.find((s) => s.id === l.id)!;
    return o.name !== l.name || o.price !== l.price || o.qty !== l.qty || stored[i]?.id !== l.id;
  });
  return { lines, removed, changed };
}
