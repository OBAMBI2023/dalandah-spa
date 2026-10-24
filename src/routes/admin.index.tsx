import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, CalendarDays, CheckCircle2, CircleDashed, Sparkles, Users } from "lucide-react";
import { DataState, PageHeader, Panel } from "@/components/admin";
import { useAdminEmail } from "@/components/admin-gate";
import { BOOKINGS_LIMIT, bookingsToday, clientsFromBookings, upcomingBookings } from "@/lib/admin-api";
import { useAdminBookings, useAdminServices, viewState } from "@/lib/admin-queries";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Vue d'ensemble | Administration Dalanda" }] }),
  component: Overview,
});

type Kpi = { label: string; Icon: typeof Users; value: number | null; pending: boolean; failed: boolean };

function Overview() {
  const email = useAdminEmail();
  const bookings = useAdminBookings();
  const services = useAdminServices();
  const rows = bookings.data;

  const kpi = (label: string, Icon: Kpi["Icon"], q: { isPending: boolean; isError: boolean }, value: number | null): Kpi =>
    ({ label, Icon, value, pending: q.isPending, failed: q.isError });
  const kpis = [
    kpi("Réservations du jour", CalendarClock, bookings, rows ? bookingsToday(rows).length : null),
    kpi("Rendez-vous à venir", CalendarDays, bookings, rows ? upcomingBookings(rows).length : null),
    kpi("Clients", Users, bookings, rows ? clientsFromBookings(rows).length : null),
    kpi("Prestations au catalogue", Sparkles, services, services.data ? services.data.filter((s) => s.active).length : null),
  ];
  const recent = rows ? [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5) : [];
  const demo = services.data?.some((s) => s.isDemo) ?? false;

  const setup = [
    { label: "Base de données", done: !!rows, detail: rows ? "Connectée au projet Supabase, lecture réussie" : bookings.isError ? "Lecture impossible (voir l'activité récente)" : "Vérification en cours…" },
    { label: "Authentification administrateur", done: !!email, detail: email ? `Connecté : ${email}` : "Non connecté" },
    { label: "Rôle administrateur", done: !!email, detail: email ? "Rôle « admin » vérifié dans user_roles" : "Non vérifié" },
    { label: "Politiques d'accès (RLS)", done: false, detail: "Appliquées par la base ; non vérifiables depuis l'interface" },
    { label: "Catalogue de prestations", done: !!services.data?.length, detail: services.data ? `${services.data.length} prestations en base${demo ? ", tarifs de démonstration" : ""}` : services.isError ? "Lecture impossible" : "Chargement…" },
  ];

  const activity = viewState(bookings, recent.length);
  return (
    <>
      <PageHeader title="Vue d'ensemble" text="Synthèse de l'activité du spa." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(({ label, Icon, value, pending, failed }) => (
          <div key={label} className="rounded-2xl border bg-card p-4 shadow-soft">
            <Icon className="h-5 w-5 text-sage" strokeWidth={1.6} />
            <p className="mt-3 font-display text-3xl text-deep">{value ?? "—"}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
            {pending && <p className="mt-1 text-[11px] text-muted-foreground/80">Chargement…</p>}
            {failed && <p role="alert" className="mt-1 text-[11px] text-destructive">Chargement impossible</p>}
          </div>
        ))}
      </div>
      {rows && rows.length >= BOOKINGS_LIMIT && <p className="text-xs text-muted-foreground">Chiffres calculés sur les {BOOKINGS_LIMIT} réservations les plus récentes.</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Activité récente">
          <DataState {...activity} onRetry={() => void bookings.refetch()}>
            <ul className="divide-y">
              {recent.map((b) => (
                <li key={b.ref} className="px-5 py-3 text-sm">
                  <p className="font-medium text-deep">{b.name} · {b.serviceName}</p>
                  <p className="text-xs text-muted-foreground">{b.ref} · {b.date} à {b.slot} · {b.status === "confirmed" ? "Confirmée" : "Annulée"}</p>
                </li>
              ))}
            </ul>
          </DataState>
        </Panel>
        <Panel title="État de la configuration">
          <ul className="divide-y">
            {setup.map(({ label, detail, done }) => (
              <li key={label} className="flex items-start gap-3 px-5 py-3.5">
                {done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-sage" /> : <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />}
                <div>
                  <p className="text-sm font-medium text-deep">{label}</p>
                  <p className="text-xs text-muted-foreground">{detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
