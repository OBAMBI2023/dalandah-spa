import { settings } from "@/data/settings";

export const formatFCFA = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n).replace(/\u202f|\u00a0/g, " ")} FCFA`;

export const waLink = (message: string) =>
  settings.whatsappNumber ? `https://wa.me/${settings.whatsappNumber}?text=${encodeURIComponent(message)}` : null;

export const localOrderId = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `DB-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
};

export const isValidPhone = (s: string) => s.replace(/[\s.+-]/g, "").match(/^\d{8,15}$/) !== null;

export type CartLine = { id: string; name: string; price: number; qty: number };

export const cartSubtotal = (lines: CartLine[]) => lines.reduce((s, l) => s + l.price * l.qty, 0);
export const cartCount = (lines: CartLine[]) => lines.reduce((s, l) => s + l.qty, 0);

export function orderMessage(o: {
  orderId: string; name: string; phone: string; address: string; area: string; notes: string;
  lines: CartLine[]; deliveryFee: number | null; payment: string;
}) {
  const sub = cartSubtotal(o.lines);
  const rows = o.lines.map((l) => `• ${l.name} × ${l.qty} — ${formatFCFA(l.price)} = ${formatFCFA(l.price * l.qty)}`);
  return [
    `Bonjour ${settings.shopName}, voici ma demande de commande.`,
    `N° de commande (local) : ${o.orderId}`,
    ``, `Nom : ${o.name}`, `Téléphone : ${o.phone}`, `Adresse : ${o.address}, ${o.area}`,
    o.notes ? `Instructions : ${o.notes}` : null,
    ``, `Articles :`, ...rows, ``,
    `Sous-total : ${formatFCFA(sub)}`,
    `Livraison : ${o.deliveryFee === null ? "à confirmer" : formatFCFA(o.deliveryFee)}`,
    `Total : ${o.deliveryFee === null ? `${formatFCFA(sub)} + livraison (à confirmer)` : formatFCFA(sub + o.deliveryFee)}`,
    `Mode : ${o.payment}`,
  ].filter((x) => x !== null).join("\n");
}

export function bookingMessage(b: { service: string; date: string; slot: string; name: string; phone: string; comment: string }) {
  return [
    `Bonjour ${settings.shopName}, je souhaite réserver un soin.`,
    `Prestation : ${b.service}`, `Date souhaitée : ${b.date}`, `Créneau : ${b.slot}`,
    `Nom : ${b.name}`, `Téléphone : ${b.phone}`, b.comment ? `Commentaire : ${b.comment}` : null,
  ].filter(Boolean).join("\n");
}
