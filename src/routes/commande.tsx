import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { CheckCircle2, MessageCircle, Wallet } from "lucide-react";
import { useCart } from "@/lib/cart";
import { useShopProducts } from "@/lib/shop-products";
import { cartSubtotal, formatFCFA, isValidCIPhone, localOrderId, orderMessage, waLink } from "@/lib/format";
import { settings } from "@/data/settings";
import { PageTitle } from "@/components/layout";
import { Img } from "@/components/app";

export const Route = createFileRoute("/commande")({
  head: () => ({
    meta: [
      { title: "Valider ma commande | Dalanda Cosmétique" },
      { name: "description", content: "Préparez votre commande Dalanda Cosmétique et envoyez-la sur WhatsApp." },
      { property: "og:title", content: "Valider ma commande | Dalanda Cosmétique" },
      { property: "og:description", content: "Commande transmise par WhatsApp." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Checkout,
});

type FieldKey = "name" | "phone" | "address" | "area";

function Checkout() {
  const { lines } = useCart();
  const { products } = useShopProducts();
  const [f, setF] = useState({ name: "", phone: "", address: "", area: "", notes: "" });
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Verrou synchrone (le state arrive trop tard pour un double clic) et numéro de commande unique par panier : un nouvel essai ne crée pas de doublon.
  const lock = useRef(false);
  const orderId = useRef<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const errors: Record<FieldKey, string | false> = {
    name: f.name.trim().length < 2 && "Indiquez votre nom complet.",
    phone: !isValidCIPhone(f.phone) && "Indiquez un numéro valide, par exemple 07 00 71 71 00.",
    address: f.address.trim().length < 3 && "Indiquez l'adresse de livraison.",
    area: f.area.trim().length < 2 && "Indiquez la commune ou le quartier.",
  };
  const sub = cartSubtotal(lines);
  const fee = settings.deliveryFee;
  const processing = settings.paymentModes.join(" · ");

  if (!lines.length)
    return (<><PageTitle eyebrow="Commande" title="Votre panier est vide" /><div className="py-16 text-center"><Link to="/boutique" className="btn btn-primary">Continuer mes achats</Link></div></>);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (lock.current || ready) return;
    setTried(true);
    setFailure(null);
    if (Object.values(errors).some(Boolean)) return;
    if (!lines.length) return;
    lock.current = true;
    setSending(true);
    try {
      orderId.current ??= localOrderId();
      const link = waLink(orderMessage({ orderId: orderId.current, ...f, lines, deliveryFee: fee, payment: processing }));
      if (!link) throw new Error("whatsapp-not-configured");
      window.open(link, "_blank", "noopener");
      setReady(link);
    } catch {
      setFailure("Votre commande n'a pas pu être préparée. Vos informations et votre panier sont conservés : vous pouvez réessayer.");
      lock.current = false;
    } finally {
      setSending(false);
    }
  };

  const Field = ({ k, label, type = "text", autoComplete, inputMode }: { k: FieldKey; label: string; type?: string; autoComplete: string; inputMode?: "tel" | "text" }) => {
    const shown = (tried || touched[k]) && errors[k];
    return (
      <label className="block text-sm font-medium">{label}
        <input className="field mt-1" type={type} value={f[k]} onChange={set(k)} onBlur={() => setTouched((t) => ({ ...t, [k]: true }))}
          autoComplete={autoComplete} inputMode={inputMode} required aria-required="true" aria-invalid={shown ? true : undefined} aria-describedby={shown ? `err-${k}` : undefined} disabled={!!ready} />
        {shown && <span id={`err-${k}`} role="alert" className="mt-1 block text-sm text-destructive">{shown}</span>}
      </label>
    );
  };

  return (
    <>
      <PageTitle eyebrow="Commande" title="Commande" text="Votre commande sera traitée après réception et confirmation par notre boutique." />
      <form onSubmit={submit} noValidate className="mx-auto grid max-w-6xl gap-8 px-5 py-10 pb-28 lg:grid-cols-[1fr_400px] lg:items-start">
        <div className="space-y-8">
          <section className="space-y-4">
            <h2 className="text-2xl text-deep">Valider ma commande</h2>
            {Field({ k: "name", label: "Nom complet", autoComplete: "name" })}
            {Field({ k: "phone", label: "Téléphone", type: "tel", autoComplete: "tel", inputMode: "tel" })}
            {Field({ k: "address", label: "Adresse de livraison", autoComplete: "street-address" })}
            {Field({ k: "area", label: "Commune ou quartier", autoComplete: "off" })}
            <label className="block text-sm font-medium">Instructions de livraison (facultatif)
              <textarea className="field mt-1 min-h-20" value={f.notes} onChange={set("notes")} maxLength={300} disabled={!!ready} />
            </label>
            <p className="text-xs text-muted-foreground">Une seule adresse de livraison pour l'ensemble de votre commande.</p>
          </section>

          <section>
            <h2 className="text-2xl text-deep">Mode de traitement</h2>
            <ul className="mt-4 space-y-3 text-sm">
              <li className="flex gap-3 rounded-xl border bg-card p-4"><MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-gold-deep" aria-hidden /><span><strong className="block text-deep">{settings.paymentModes[0]}</strong>Un message prêt à envoyer s'ouvre dans WhatsApp avec le détail de votre commande.</span></li>
              <li className="flex gap-3 rounded-xl border bg-card p-4"><Wallet className="mt-0.5 h-5 w-5 shrink-0 text-gold-deep" aria-hidden /><span><strong className="block text-deep">{settings.paymentModes[1]}</strong>Aucun paiement en ligne : la boutique vous indique les modalités à la confirmation.</span></li>
            </ul>
          </section>
        </div>

        <aside className="h-fit rounded-2xl border bg-card p-6 shadow-soft lg:sticky lg:top-24">
          <h2 className="text-2xl text-deep">Récapitulatif</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {lines.map((l) => (
              <li key={l.id} className="flex gap-3">
                <Img src={products.find((p) => p.id === l.id)?.images[0]} alt="" sizes="56px" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                <div className="flex flex-1 justify-between gap-3">
                  <span className="font-medium">{l.name} × {l.qty}<br /><span className="font-normal text-muted-foreground">{formatFCFA(l.price)} / unité</span></span>
                  <span className="whitespace-nowrap font-semibold">{formatFCFA(l.price * l.qty)}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-1 border-t pt-4 text-sm">
            <div className="flex justify-between"><span>Sous-total</span><span>{formatFCFA(sub)}</span></div>
            <div className="flex justify-between"><span>Livraison</span><span>{fee === null ? "À confirmer" : formatFCFA(fee)}</span></div>
            <div className="flex justify-between gap-3 pt-2 text-lg"><span>Total</span><strong className="text-right text-primary">{fee === null ? `${formatFCFA(sub)} + livraison` : formatFCFA(sub + fee)}</strong></div>
          </div>

          {failure && <p role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{failure}</p>}
          {tried && Object.values(errors).some(Boolean) && <p role="alert" className="mt-4 text-sm text-destructive">Veuillez corriger les champs indiqués ci-dessus.</p>}

          {settings.whatsappNumber
            ? <button type="submit" disabled={sending || !!ready} className="btn btn-primary mt-5 w-full disabled:opacity-70">{sending ? "Envoi en cours…" : ready ? "Message de commande prêt" : "Envoyer ma commande"}</button>
            : <p className="mt-5 text-sm text-destructive">Le numéro WhatsApp n'est pas configuré. Contactez la boutique par téléphone.</p>}

          {ready && (
            <div role="status" className="mt-4 flex gap-2 rounded-lg bg-secondary p-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gold-deep" aria-hidden />
              <p>
                Votre message de commande est prêt dans WhatsApp. Appuyez sur « Envoyer » pour le transmettre à Dalanda Beauty : la commande n'est confirmée qu'après réception et confirmation par la boutique.
                <a href={ready} target="_blank" rel="noreferrer" className="mt-2 block font-semibold text-primary underline">Rouvrir WhatsApp</a>
              </p>
            </div>
          )}
        </aside>
      </form>
    </>
  );
}
