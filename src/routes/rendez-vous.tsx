import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronRight, Clock, Phone } from "lucide-react";
import { formatFCFA } from "@/lib/format";
import { settings } from "@/data/settings";
import { cancelBooking, endTime, isUpcoming, useBookings, type Booking } from "@/lib/bookings";
import { AppBar, Screen } from "@/components/app";

export const Route = createFileRoute("/rendez-vous")({
  head: () => ({ meta: [{ title: "Mes rendez-vous | Dalanda Beauty Spa" }] }),
  component: Rdv,
});

function Card({ b, upcoming }: { b: Booking; upcoming: boolean }) {
  const d = new Date(`${b.date}T12:00:00`);
  const cancelled = b.status === "cancelled";
  return (
    <li className="rounded-2xl border bg-card p-4 shadow-soft">
      <div className="flex gap-4">
        <div className="w-12 shrink-0 text-center leading-tight">
          <p className="text-xs capitalize text-muted-foreground">{d.toLocaleDateString("fr-FR", { weekday: "short" })}</p>
          <p className="font-display text-3xl text-deep">{d.getDate()}</p>
          <p className="text-xs capitalize text-muted-foreground">{d.toLocaleDateString("fr-FR", { month: "short" })}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-deep">{b.serviceName}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{b.slot} - {endTime(b.slot, b.duration)}</p>
          <p className="mt-0.5 text-sm text-deep">{formatFCFA(b.price)}</p>
          <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cancelled ? "bg-destructive/10 text-destructive" : upcoming ? "bg-green-100 text-green-800" : "bg-secondary text-muted-foreground"}`}>
            {cancelled ? "Annulé" : upcoming ? "Enregistré" : "Terminé"}
          </span>
          <span className="ml-2 text-[11px] text-muted-foreground">{b.ref}</span>
        </div>
        <ChevronRight className="h-4 w-4 self-center text-muted-foreground" />
      </div>
      {upcoming && (
        <button onClick={() => { if (window.confirm("Annuler ce rendez-vous ?")) cancelBooking(b.ref); }} className="mt-3 text-xs text-destructive underline">Annuler ce rendez-vous</button>
      )}
    </li>
  );
}

function Rdv() {
  const bookings = useBookings();
  const [tab, setTab] = useState<"next" | "past">("next");
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const upcoming = now ? bookings.filter((b) => isUpcoming(b, now)) : [];
  const past = now ? bookings.filter((b) => !isUpcoming(b, now)) : [];
  const list = tab === "next" ? upcoming : past;
  const tabCls = (on: boolean) => `rounded-full py-2 text-sm ${on ? "bg-deep text-deep-foreground" : "text-muted-foreground"}`;
  return (
    <Screen>
      <AppBar title="Mes rendez-vous" back={false} />
      <div className="px-4">
        <div className="grid grid-cols-2 gap-1 rounded-full bg-secondary p-1" role="tablist">
          <button role="tab" aria-selected={tab === "next"} className={tabCls(tab === "next")} onClick={() => setTab("next")}>À venir</button>
          <button role="tab" aria-selected={tab === "past"} className={tabCls(tab === "past")} onClick={() => setTab("past")}>Passés</button>
        </div>
        <ul className="mt-4 space-y-3">
          {list.map((b) => <Card key={b.ref} b={b} upcoming={tab === "next"} />)}
        </ul>
        {now && list.length === 0 && (
          <div className="mt-10 text-center">
            <p className="text-sm text-muted-foreground">{tab === "next" ? "Aucun rendez-vous à venir." : "Aucun rendez-vous passé."}</p>
            {tab === "next" && <Link to="/reservation" className="btn btn-app mt-4">Réserver un soin</Link>}
          </div>
        )}
        <div className="mt-8 flex gap-3 rounded-2xl bg-secondary p-4 text-xs">
          <Phone className="h-4 w-4 shrink-0 text-gold-deep" />
          <p><b className="text-deep">Besoin de modifier ou d'annuler ?</b><br />Contactez-nous au {settings.phones[0]}</p>
        </div>
      </div>
    </Screen>
  );
}
