import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useCart } from "@/lib/cart";
import { cartSubtotal, formatFCFA, isValidPhone, localOrderId, orderMessage, waLink } from "@/lib/format";
import { settings } from "@/data/settings";
import { PageTitle } from "@/components/layout";

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

function Checkout() {
  const { lines } = useCart();
  const [f, setF] = useState({ name: "", phone: "", address: "", area: "", notes: "", payment: settings.paymentModes[0] });
  const [tried, setTried] = useState(false);
  const [ready, setReady] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const errors: Record<string, string | false> = {
    name: f.name.trim().length < 2 && "Indiquez votre nom complet.",
    phone: !isValidPhone(f.phone) && "Numéro de téléphone invalide.",
    address: f.address.trim().length < 3 && "Indiquez l'adresse de livraison.",
    area: f.area.trim().length < 2 && "Indiquez la commune ou le quartier.",
  };
  const sub = cartSubtotal(lines);
  const fee = settings.deliveryFee;

  if (!lines.length && !ready)
    return (<><PageTitle eyebrow="Commande" title="Votre panier est vide" /><div className="py-16 text-center"><Link to="/boutique" className="btn btn-primary">Continuer mes achats</Link></div></>);

  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setTried(true);
    if (Object.values(errors).some(Boolean)) return;
    const link = waLink(orderMessage({ orderId: localOrderId(), ...f, lines, deliveryFee: fee }));
    if (!link) return;
    window.open(link, "_blank", "noopener");
    setReady(link);
  };

  const Field = ({ k, label, type = "text" }: { k: "name" | "phone" | "address" | "area"; label: string; type?: string }) => (
    <label className="block text-sm font-medium">{label}
      <input className="field mt-1" type={type} value={f[k]} onChange={set(k)} />
      {tried && errors[k] && <span className="mt-1 block text-sm text-destructive">{errors[k]}</span>}
    </label>
  );

  return (
    <>
      <PageTitle eyebrow="Commande" title="Valider ma commande" text="La commande ne peut être traitée qu'après réception et confirmation par la boutique." />
      <form onSubmit={submit} className="mx-auto grid max-w-6xl gap-8 px-5 py-10 pb-28 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {Field({ k: "name", label: "Nom complet" })}
          {Field({ k: "phone", label: "Téléphone", type: "tel" })}
          {Field({ k: "address", label: "Adresse de livraison" })}
          {Field({ k: "area", label: "Commune ou quartier" })}
          <label className="block text-sm font-medium">Instructions de livraison (facultatif)<textarea className="field mt-1 min-h-20" value={f.notes} onChange={set("notes")} maxLength={300} /></label>
          <label className="block text-sm font-medium">Mode de traitement
            <select className="field mt-1" value={f.payment} onChange={set("payment")}>{settings.paymentModes.map((m) => <option key={m}>{m}</option>)}</select>
          </label>
        </div>
        <aside className="h-fit rounded-2xl border bg-card p-6 shadow-soft">
          <h2 className="text-2xl text-deep">Récapitulatif</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-3"><span>{l.name} × {l.qty}<br /><span className="text-muted-foreground">{formatFCFA(l.price)} / u.</span></span><span>{formatFCFA(l.price * l.qty)}</span></li>
            ))}
          </ul>
          <div className="mt-4 space-y-1 border-t pt-4 text-sm">
            <div className="flex justify-between"><span>Sous-total</span><span>{formatFCFA(sub)}</span></div>
            <div className="flex justify-between"><span>Livraison</span><span>{fee === null ? "À confirmer" : formatFCFA(fee)}</span></div>
            <div className="flex justify-between pt-2 text-lg"><span>Total</span><strong className="text-primary">{fee === null ? `${formatFCFA(sub)} + livraison` : formatFCFA(sub + fee)}</strong></div>
          </div>
          {settings.whatsappNumber
            ? <button type="submit" className="btn btn-primary mt-5 w-full">Envoyer ma commande</button>
            : <p className="mt-5 text-sm text-destructive">Le numéro WhatsApp n'est pas configuré. Contactez la boutique par téléphone.</p>}
          {ready && (
            <div className="mt-4 rounded-lg bg-secondary p-3 text-sm">
              Votre message de commande est prêt. Envoyez-le sur WhatsApp pour transmettre votre demande à Dalanda Beauty.
              <a href={ready} target="_blank" rel="noreferrer" className="mt-2 block font-semibold text-primary underline">Rouvrir WhatsApp</a>
            </div>
          )}
        </aside>
      </form>
    </>
  );
}
