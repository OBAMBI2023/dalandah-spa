import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Clock } from "lucide-react";
import type { Product } from "@/data/products";
import type { Service } from "@/data/services";
import { useCart } from "@/lib/cart";
import { formatFCFA } from "@/lib/format";
import { Img } from "@/components/app";

export function ProductCard({ p }: { p: Product }) {
  const { add } = useCart();
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border bg-card transition hover:shadow-soft">
      <Link to="/boutique/$productId" params={{ productId: p.id }} className="relative aspect-square overflow-hidden bg-secondary">
        <Img sizes="(min-width: 1024px) 25vw, 50vw" src={p.images[0]} alt={p.name} className="h-full w-full object-cover transition duration-700 group-hover:scale-105" />
        {!p.available && <span className="absolute left-3 top-3 rounded-full bg-deep px-3 py-1 text-xs text-deep-foreground">Indisponible</span>}
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <p className="text-xs text-sage">{p.category}</p>
        <h3 className="mt-1 text-2xl text-deep">{p.name}</h3>
        <p className="mt-1 flex-1 text-sm text-muted-foreground">{p.shortDescription}</p>
        <p className="mt-3 font-semibold text-primary">{formatFCFA(p.price)}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link to="/boutique/$productId" params={{ productId: p.id }} className="btn btn-outline !px-3 text-sm">Voir le produit</Link>
          <button disabled={!p.available} onClick={() => add(p.id) && toast.success(`${p.name} ajouté au panier`)} className="btn btn-primary !px-3 text-sm">
            Ajouter au panier
          </button>
        </div>
      </div>
    </article>
  );
}

export function ServiceCard({ s }: { s: Service }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      <Img sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" src={s.image} alt={s.name} className="aspect-[4/3] w-full object-cover" />
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-2xl text-deep">{s.name}</h3>
        <p className="mt-1 flex-1 text-sm text-muted-foreground">{s.description}</p>
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground"><Clock className="h-4 w-4" />{s.duration}</span>
          <span className="font-semibold text-primary">{formatFCFA(s.price)}</span>
        </div>
        <Link to="/reservation" search={{ service: s.id }} className="btn btn-primary mt-4">Réserver</Link>
      </div>
    </article>
  );
}
