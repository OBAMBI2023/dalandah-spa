import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { products as localProducts, type Product } from "@/data/products";
import type { CartLine } from "@/lib/format";
import { SHOP_KEY, reconcileLines, shopApi } from "@/lib/shop";

type Ctx = {
  lines: CartLine[];
  /** Noms des articles retirés du panier parce qu'ils ne sont plus en vente ou plus en stock. */
  removed: string[];
  dismissRemoved: () => void;
  add: (id: string, qty?: number) => boolean;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** Quantité maximale commandable (stock du catalogue). */
  maxQty: (id: string) => number;
};
const CartCtx = createContext<Ctx | null>(null);
const KEY = "dalanda-cart";

export function CartProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { const raw = localStorage.getItem(KEY); if (raw) setLines(JSON.parse(raw)); } catch { /* ignore */ }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) localStorage.setItem(KEY, JSON.stringify(lines)); }, [lines, ready]);

  // Le catalogue n'est demandé que si le panier contient quelque chose (les pages boutique le demandent elles-mêmes).
  const catalogue = useQuery({ queryKey: SHOP_KEY, queryFn: shopApi.fetchProducts, enabled: shopApi.remote && ready && lines.length > 0, staleTime: 30_000, retry: 1 });
  const live: Product[] | null = shopApi.remote ? (catalogue.data ?? null) : localProducts;

  // Prix, nom et plafond de quantité suivent le catalogue ; un article retiré de la vente sort du panier avec un message.
  useEffect(() => {
    if (!ready || !live || lines.length === 0) return;
    const r = reconcileLines(lines, live);
    if (!r.changed) return;
    setLines(r.lines);
    if (r.removed.length) setRemoved((prev) => [...new Set([...prev, ...r.removed])]);
  }, [ready, live, lines]);

  const find = (id: string) => (live ?? (shopApi.remote ? qc.getQueryData<Product[]>(SHOP_KEY) : null) ?? []).find((p) => p.id === id);
  const maxQty = (id: string) => find(id)?.stock ?? 99;

  const add = (id: string, qty = 1) => {
    const p = find(id);
    if (!p || !p.available || qty < 1) return false;
    const max = p.stock ?? 99;
    setLines((prev) => {
      const ex = prev.find((l) => l.id === id);
      if (ex) return prev.map((l) => (l.id === id ? { ...l, qty: Math.min(max, l.qty + qty) } : l));
      return [...prev, { id, name: p.name, price: p.price, qty: Math.min(max, qty) }];
    });
    return true;
  };
  const setQty = (id: string, qty: number) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, qty: Math.max(1, Math.min(maxQty(id), Math.floor(qty) || 1)) } : l)));
  const remove = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));
  const clear = () => setLines([]);
  const dismissRemoved = () => setRemoved([]);

  return <CartCtx.Provider value={{ lines, removed, dismissRemoved, add, setQty, remove, clear, maxQty }}>{children}</CartCtx.Provider>;
}

export function useCart() {
  const c = useContext(CartCtx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}
