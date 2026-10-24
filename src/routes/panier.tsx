import { createFileRoute, Link } from "@tanstack/react-router";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useCart, maxQty } from "@/lib/cart";
import { cartCount, cartSubtotal, formatFCFA } from "@/lib/format";
import { getProduct } from "@/data/products";
import { PageTitle } from "@/components/layout";
import { Img } from "@/components/app";

export const Route = createFileRoute("/panier")({
  head: () => ({
    meta: [
      { title: "Mon panier | Dalanda Cosmétique" },
      { name: "description", content: "Votre panier Dalanda Cosmétique." },
      { property: "og:title", content: "Mon panier | Dalanda Cosmétique" },
      { property: "og:description", content: "Votre sélection de produits Dalanda Cosmétique." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Cart,
});

function Cart() {
  const { lines, setQty, remove, clear } = useCart();
  if (!lines.length)
    return (
      <>
        <PageTitle eyebrow="Panier" title="Votre panier est vide" />
        <div className="py-16 text-center"><Link to="/boutique" className="btn btn-primary">Continuer mes achats</Link></div>
      </>
    );
  return (
    <>
      <PageTitle eyebrow="Panier" title="Mon panier" text={`${cartCount(lines)} article(s). Stocks non synchronisés avec un système externe.`} />
      <section className="mx-auto grid max-w-6xl gap-8 px-5 py-10 pb-28 lg:grid-cols-[1fr_340px]">
        <ul className="divide-y rounded-2xl border bg-card">
          {lines.map((l) => (
            <li key={l.id} className="flex gap-4 p-4">
              <Img src={getProduct(l.id)?.images[0]} alt="" sizes="96px" className="h-20 w-20 rounded-lg object-cover" />
              <div className="flex flex-1 flex-col gap-2">
                <div className="flex justify-between gap-2">
                  <Link to="/boutique/$productId" params={{ productId: l.id }} className="font-display text-xl text-deep">{l.name}</Link>
                  <button aria-label="Supprimer" onClick={() => remove(l.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                </div>
                <p className="text-sm text-muted-foreground">{formatFCFA(l.price)} / unité</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center rounded-full border">
                    <button aria-label="Diminuer" className="p-2" onClick={() => setQty(l.id, l.qty - 1)} disabled={l.qty <= 1}><Minus className="h-4 w-4" /></button>
                    <span className="w-8 text-center text-sm font-semibold">{l.qty}</span>
                    <button aria-label="Augmenter" className="p-2" onClick={() => setQty(l.id, l.qty + 1)} disabled={l.qty >= maxQty(l.id)}><Plus className="h-4 w-4" /></button>
                  </div>
                  <span className="font-semibold">{formatFCFA(l.price * l.qty)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <aside className="h-fit rounded-2xl border bg-card p-6 shadow-soft">
          <div className="flex justify-between text-lg"><span>Total</span><strong className="text-primary">{formatFCFA(cartSubtotal(lines))}</strong></div>
          <p className="mt-1 text-xs text-muted-foreground">Hors frais de livraison (à confirmer).</p>
          <Link to="/commande" className="btn btn-primary mt-5 w-full">Passer commande</Link>
          <Link to="/boutique" className="btn btn-outline mt-2 w-full">Continuer mes achats</Link>
          <button onClick={() => confirm("Vider le panier ?") && clear()} className="mt-4 w-full text-sm text-muted-foreground hover:text-destructive">Vider le panier</button>
        </aside>
      </section>
    </>
  );
}
