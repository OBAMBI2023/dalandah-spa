import { createFileRoute, Link } from "@tanstack/react-router";
import { parsePromoParam } from "@/lib/promotion-tracking";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Minus, Plus, Check } from "lucide-react";
import { useCart } from "@/lib/cart";
import { formatFCFA } from "@/lib/format";
import { useShopProducts } from "@/lib/shop-products";
import { Img } from "@/components/app";

// Le produit vient du catalogue (Supabase) : pas de loader, comme la fiche d'une prestation. Le titre est posé une fois le produit connu.
export const Route = createFileRoute("/boutique/$productId")({
  // ?promo= : promotion d'origine (acceptée pour que le lien fonctionne ; l'achat n'est pas suivi dans cette version).
  validateSearch: (s: Record<string, unknown>): { promo?: string } => { const promo = parsePromoParam(s["promo"]); return promo ? { promo } : {}; },
  head: () => ({ meta: [{ title: "Produit | Dalanda Cosmétique" }] }),
  component: ProductPage,
});

function Notice({ title, text, retry }: { title: string; text?: string; retry?: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-5 py-24 text-center" role={retry ? "alert" : "status"}>
      <h1 className="text-4xl text-deep">{title}</h1>
      {text && <p className="mt-3 text-muted-foreground">{text}</p>}
      {retry && <button onClick={retry} className="btn btn-outline mt-6">Réessayer</button>}
      <Link to="/boutique" className="btn btn-primary mt-6">Retour à la boutique</Link>
    </div>
  );
}

function ProductPage() {
  const { productId } = Route.useParams();
  const { products, loaded, isError, refetch } = useShopProducts();
  const { add, maxQty } = useCart();
  const [img, setImg] = useState(0);
  const [qty, setQty] = useState(1);
  const p = products.find((x) => x.id === productId);

  useEffect(() => {
    if (p) document.title = `${p.name} | Dalanda Cosmétique`;
  }, [p]);

  // « Introuvable » seulement une fois la réponse du serveur reçue : un chargement ou une panne ne sont pas une absence.
  if (!p) {
    if (isError) return <Notice title="Chargement impossible" text="Impossible de charger ce produit pour le moment." retry={refetch} />;
    if (!loaded) return <div aria-busy="true" aria-label="Chargement du produit" className="mx-auto max-w-7xl px-5 py-24"><div className="aspect-square max-w-lg animate-pulse rounded-2xl bg-secondary" /></div>;
    return <Notice title="Produit introuvable" text="Ce produit n'existe pas ou n'est plus proposé." />;
  }

  const max = maxQty(p.id);

  return (
    <section className="mx-auto max-w-7xl px-5 py-10 pb-28">
      <Link to="/boutique" className="text-sm text-muted-foreground hover:text-primary">← Boutique</Link>
      <div className="mt-6 grid gap-10 md:grid-cols-2">
        <div>
          <Img priority sizes="(min-width: 1024px) 50vw, 100vw" src={p.images[img]} alt={p.name} className="aspect-square w-full rounded-2xl object-cover" />
          {p.images.length > 1 && (
            <div className="mt-3 flex gap-3">
              {p.images.map((src, i) => (
                <button key={i} onClick={() => setImg(i)} className={`h-20 w-20 overflow-hidden rounded-lg border-2 ${i === img ? "border-primary" : "border-transparent"}`}>
                  <Img src={src} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="eyebrow">{p.category}</p>
          <h1 className="mt-2 text-4xl text-deep md:text-5xl">{p.name}</h1>
          <p className="mt-4 text-2xl font-semibold text-primary">{formatFCFA(p.price)}</p>
          <p className={`mt-2 text-sm ${p.available ? "text-sage" : "text-destructive"}`}>
            {p.available ? `Disponible${p.stock ? ` · ${p.stock} en stock (indicatif)` : ""}` : "Momentanément indisponible"}
          </p>
          <p className="mt-6 text-muted-foreground">{p.description}</p>
          {p.features.length > 0 && (
            <ul className="mt-6 space-y-2">{p.features.map((f) => <li key={f} className="flex gap-2 text-sm"><Check className="h-4 w-4 text-sage" />{f}</li>)}</ul>
          )}
          {p.volume && <p className="mt-4 text-sm"><strong>Contenance :</strong> {p.volume}</p>}
          {p.usage && <p className="mt-4 text-sm"><strong>Conseils d'utilisation :</strong> {p.usage}</p>}
          {p.available && (
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <div className="flex items-center rounded-full border">
                <button aria-label="Diminuer" className="p-3" onClick={() => setQty(Math.max(1, qty - 1))}><Minus className="h-4 w-4" /></button>
                <span className="w-10 text-center font-semibold">{qty}</span>
                <button aria-label="Augmenter" className="p-3" onClick={() => setQty(Math.min(max, qty + 1))}><Plus className="h-4 w-4" /></button>
              </div>
              <button className="btn btn-primary" onClick={() => add(p.id, qty) && toast.success(`${qty} × ${p.name} ajouté au panier`)}>Ajouter au panier</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
