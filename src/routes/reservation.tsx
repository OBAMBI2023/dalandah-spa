import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { services } from "@/data/services";
import { settings } from "@/data/settings";
import { bookingMessage, formatFCFA, isValidPhone, waLink } from "@/lib/format";
import { PageTitle } from "@/components/layout";
import { MobileBooking } from "@/components/mobile-booking";

export const Route = createFileRoute("/reservation")({
  validateSearch: (s: Record<string, unknown>): { service?: string } =>
    typeof s.service === "string" ? { service: s.service } : {},
  head: () => ({
    meta: [
      { title: "Réserver un soin | Dalanda Beauty-Spa" },
      { name: "description", content: "Préparez votre demande de réservation chez Dalanda Beauty-Spa et envoyez-la sur WhatsApp." },
      { property: "og:title", content: "Réserver un soin | Dalanda Beauty-Spa" },
      { property: "og:description", content: "Demande de réservation par WhatsApp, soumise à confirmation." },
    ],
  }),
  component: BookingPage,
});

function BookingPage() {
  const { service } = Route.useSearch();
  return (
    <>
      <div className="lg:hidden"><MobileBooking initialService={service} /></div>
      <div className="hidden lg:block"><Booking /></div>
    </>
  );
}

function Booking() {
  const search = Route.useSearch();
  const [serviceId, setServiceId] = useState(search.service ?? "");
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [comment, setComment] = useState("");
  const [tried, setTried] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const service = services.find((s) => s.id === serviceId);

  const errors = useMemo(() => ({
    service: !service && "Choisissez une prestation.",
    date: (!date || date < today) && "Choisissez une date à venir.",
    slot: !slot && "Choisissez un créneau.",
    name: name.trim().length < 2 && "Indiquez votre nom.",
    phone: !isValidPhone(phone) && "Numéro de téléphone invalide.",
  }), [service, date, slot, name, phone, today]);
  const valid = Object.values(errors).every((e) => !e);

  const href = valid && service
    ? waLink(bookingMessage({ service: service.name, date: new Date(date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }), slot, name: name.trim(), phone: phone.trim(), comment: comment.trim() }))
    : null;

  const Err = ({ k }: { k: keyof typeof errors }) => tried && errors[k] ? <p className="mt-1 text-sm text-destructive">{errors[k]}</p> : null;

  return (
    <>
      <PageTitle eyebrow="Réservation" title="Réserver un soin" text="Votre demande sera soumise à confirmation par Dalanda Beauty." />
      <section className="mx-auto grid max-w-6xl gap-10 px-5 py-12 pb-28 lg:grid-cols-[1fr_380px]">
        <div className="space-y-8">
          <div>
            <h2 className="text-2xl text-deep">1. Prestation</h2>
            <select className="field mt-3" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Sélectionnez une prestation</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.duration} — {formatFCFA(s.price)}</option>)}
            </select>
            <Err k="service" />
          </div>
          <div>
            <h2 className="text-2xl text-deep">2. Date souhaitée</h2>
            <input type="date" min={today} className="field mt-3" value={date} onChange={(e) => setDate(e.target.value)} />
            <Err k="date" />
          </div>
          <div>
            <h2 className="text-2xl text-deep">3. Créneau indicatif</h2>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {settings.timeSlots.map((t) => (
                <button key={t} type="button" onClick={() => setSlot(t)}
                  className={`rounded-lg border py-3 text-sm ${slot === t ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>{t}</button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Les disponibilités réelles seront confirmées par l'établissement.</p>
            <Err k="slot" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">4. Votre nom<input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /><Err k="name" /></label>
            <label className="block text-sm font-medium">5. Téléphone<input className="field mt-1" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="07 00 00 00 00" /><Err k="phone" /></label>
          </div>
          <label className="block text-sm font-medium">6. Commentaire (facultatif)<textarea className="field mt-1 min-h-24" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} /></label>
        </div>

        <aside className="h-fit rounded-2xl border bg-card p-6 shadow-soft lg:sticky lg:top-28">
          <h2 className="text-2xl text-deep">7. Récapitulatif</h2>
          <dl className="mt-4 space-y-2 text-sm">
            {[["Prestation", service?.name], ["Date", date && new Date(date).toLocaleDateString("fr-FR")], ["Créneau", slot], ["Nom", name], ["Téléphone", phone]].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v || "—"}</dd></div>
            ))}
          </dl>
          <p className="mt-5 rounded-lg bg-secondary p-3 text-sm">Votre demande sera soumise à confirmation par Dalanda Beauty.</p>
          {settings.whatsappNumber ? (
            href ? (
              <a href={href} target="_blank" rel="noreferrer" className="btn btn-primary mt-5 w-full">8. Envoyer sur WhatsApp</a>
            ) : (
              <button onClick={() => setTried(true)} className="btn btn-primary mt-5 w-full">8. Envoyer sur WhatsApp</button>
            )
          ) : (
            <p className="mt-5 text-sm text-destructive">Le numéro WhatsApp n'est pas encore configuré. Contactez-nous par téléphone.</p>
          )}
        </aside>
      </section>
    </>
  );
}
