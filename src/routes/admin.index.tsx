import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, CalendarDays, CheckCircle2, CircleDashed, Sparkles, Users } from "lucide-react";
import { services } from "@/data/services";
import { DataState, PageHeader, Panel } from "@/components/admin";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Vue d'ensemble | Administration Dalanda" }] }),
  component: Overview,
});

// Aucune source de données n'est connectée : les indicateurs restent vides plutôt qu'inventés.
const kpis = [
  { label: "Réservations du jour", Icon: CalendarClock, value: null as number | null },
  { label: "Rendez-vous à venir", Icon: CalendarDays, value: null },
  { label: "Clients", Icon: Users, value: null },
  // Seul chiffre réel : le catalogue défini dans le code (tarifs encore de démonstration).
  { label: "Prestations au catalogue", Icon: Sparkles, value: services.length },
];

const setup = [
  { label: "Base de données", detail: "Aucun projet connecté à l'application", done: false },
  { label: "Authentification administrateur", detail: "Non configurée", done: false },
  { label: "Rôles et autorisations (RLS)", detail: "Non configurés", done: false },
  { label: "Catalogue de prestations", detail: `${services.length} prestations définies dans le code, tarifs de démonstration`, done: true },
];

function Overview() {
  return (
    <>
      <PageHeader title="Vue d'ensemble" text="Synthèse de l'activité du spa." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(({ label, Icon, value }) => (
          <div key={label} className="rounded-2xl border bg-card p-4 shadow-soft">
            <Icon className="h-5 w-5 text-sage" strokeWidth={1.6} />
            <p className="mt-3 font-display text-3xl text-deep">{value ?? "—"}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
            {value === null && <p className="mt-1 text-[11px] text-muted-foreground/80">Aucune donnée connectée</p>}
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Activité récente"><DataState status="unavailable" /></Panel>
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
