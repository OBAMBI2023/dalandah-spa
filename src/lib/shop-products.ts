import { useQuery } from "@tanstack/react-query";
import { products as localProducts, type Product } from "@/data/products";
import { SHOP_KEY, shopApi } from "@/lib/shop";

/**
 * Produits de la boutique (catalogue Supabase, ou données du code en mode local).
 * `loaded` : la réponse du serveur est arrivée. Tant qu'elle ne l'est pas, ou si elle échoue, la liste est VIDE
 * (jamais les données du code à la place : voir src/lib/shop.ts).
 */
export function useShopProducts(): { products: Product[]; loaded: boolean; isError: boolean; refetch: () => void } {
  const q = useQuery({ queryKey: SHOP_KEY, queryFn: shopApi.fetchProducts, enabled: shopApi.remote, staleTime: 30_000, retry: 1 });
  if (!shopApi.remote) return { products: localProducts, loaded: true, isError: false, refetch: () => {} };
  return { products: q.data ?? [], loaded: q.isSuccess, isError: q.isError, refetch: () => void q.refetch() };
}
