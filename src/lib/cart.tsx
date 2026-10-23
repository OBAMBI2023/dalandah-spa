import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getProduct } from "@/data/products";
import type { CartLine } from "@/lib/format";

type Ctx = {
  lines: CartLine[];
  add: (id: string, qty?: number) => boolean;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
};
const CartCtx = createContext<Ctx | null>(null);
const KEY = "dalanda-cart";

export const maxQty = (id: string) => getProduct(id)?.stock ?? 99;

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { const raw = localStorage.getItem(KEY); if (raw) setLines(JSON.parse(raw)); } catch { /* ignore */ }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) localStorage.setItem(KEY, JSON.stringify(lines)); }, [lines, ready]);

  const add = (id: string, qty = 1) => {
    const p = getProduct(id);
    if (!p || !p.available || qty < 1) return false;
    setLines((prev) => {
      const ex = prev.find((l) => l.id === id);
      if (ex) return prev.map((l) => (l.id === id ? { ...l, qty: Math.min(maxQty(id), l.qty + qty) } : l));
      return [...prev, { id, name: p.name, price: p.price, qty: Math.min(maxQty(id), qty) }];
    });
    return true;
  };
  const setQty = (id: string, qty: number) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, qty: Math.max(1, Math.min(maxQty(id), Math.floor(qty) || 1)) } : l)));
  const remove = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));
  const clear = () => setLines([]);

  return <CartCtx.Provider value={{ lines, add, setQty, remove, clear }}>{children}</CartCtx.Provider>;
}

export function useCart() {
  const c = useContext(CartCtx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}
