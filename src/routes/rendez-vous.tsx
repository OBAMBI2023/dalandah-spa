import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronRight, Clock, Phone } from "lucide-react";
import { formatFCFA } from "@/lib/format";
import { settings } from "@/data/settings";
import { endTime, isUpcoming, startsAtMs, useBookings, type Booking } from "@/lib/bookings";
import { api } from "@/lib/api";
import { useCatalogue } from "@/lib/catalogue";
import { AppBar, Screen } from "@/components/app";

export const Route = createFileRoute("/rendez-vous")({
  head: () => ({ meta: [{ title: "Mes rendez-vous | Dalanda Beauty Spa" }] }),
  component: Rdv,
});

const RECHECK_MS = 10 * 60_000; // la consultation est limitée côté serveur : on ne resynchronise pas plus souvent

function Card({ b, upcoming, cancelNoticeHours }: { b: Booking; upcoming: boolean; cancelNoticeHours: number }) {
  const { rules } = useCatalogue();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const d = new Date(`${b.date}T12:00:00`);
  const cancelled = b.status === "cancelled";
  const canCancel = upcoming && startsAtMs(b) >= Date.now() + cancelNoticeHours * 3600_000;

  const cancel = async () => {
    if (busy || !window.confirm("Annuler ce rendez-vous ?")) return;  // busy : pas de double envoi
    setBusy(true); setMsg("");
    const r = await api.cancelBooking(b, rules);
    setBusy(false);
    if (!r.ok) setMsg(r.error);
  };

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
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{b.slot} - {b.ends ?? endTime(b.slot, b.duration)}</p>
          <p className="mt-0.5 text-sm text-deep">{formatFCFA(b.price)}</p>
          <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cancelled ? "bg-destructive/10 text-destructive" : upcoming ? "bg-green-100 text-green-800" : "bg-secondary text-muted-foreground"}`}>
            {cancelled ? "Annulé" : upcoming ? "Enregistré" : "Terminé"}
          </span>
          <span className="ml-2 text-[11px] text-muted-foreground">{b.ref}</span>
        </div>
        <ChevronRight className="h-4 w-4 self-center text-muted-foreground" />
      </div>
      {canCancel && (
        <button onClick={cancel} disabled={busy} className="mt-3 text-xs text-destructive underline disabled:opacity-50">{busy ? "Annulation…" : "Annuler ce rendez-vous"}</button>
      )}
      {upcoming && !canCancel && !cancelled && (
        <p className="mt-3 text-xs text-muted-foreground">Annulation impossible moins de {cancelNoticeHours} h avant le rendez-vous : contactez le salon au {settings.phones[0]}.</p>
      )}
      {msg && <p role="alert" className="mt-2 text-xs text-destructive">{msg}</p>}
    </li>
  );
}

function Rdv() {
  const bookings = useBookings();
  const { rules } = useCatalogue();
  const [tab, setTab] = useState<"next" | "past">("next");
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  // Mode Supabase : resynchronise le statut des rendez-vous à venir (annulation par le salon, changement d'horaire).
  useEffect(() => {
    if (!api.remote || !now) return;
    const due = bookings.filter((b) => isUpcoming(b, now) && Date.now() - Date.parse(b.checkedAt ?? "1970-01-01") > RECHECK_MS);
    let stop = false;
    (async () => { for (const b of due) { if (stop) return; await api.refreshBooking(b); } })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, bookings.length]);

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
          {list.map((b) => <Card key={b.ref} b={b} upcoming={tab === "next"} cancelNoticeHours={rules.cancelNoticeHours} />)}
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
