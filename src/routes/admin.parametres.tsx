import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { settings } from "@/data/settings";
import { DataState, PageHeader, Panel } from "@/components/admin";
import { useAdminEmail } from "@/components/admin-gate";
import { useAdminSettings, viewState } from "@/lib/admin-queries";

export const Route = createFileRoute("/admin/parametres")({
  head: () => ({ meta: [{ title: "Paramètres | Administration Dalanda" }] }),
  component: Parametres,
});

// Informations d'établissement qui ne sont pas (encore) en base : elles restent dans src/data/settings.ts.
const identity: [string, string][] = [
  ["Nom de l'établissement", settings.shopName],
  ["Adresse", settings.address],
  ["Téléphones", settings.phones.join(" · ")],
  ["WhatsApp", settings.whatsappNumber ? `+${settings.whatsappNumber}` : "Non configuré"],
  ["E-mail", settings.email || "Non renseigné"],
];

function Parametres() {
  const email = useAdminEmail();
  const query = useAdminSettings();
  const s = query.data;
  const rules: [string, string][] = s
    ? [
        ["Fuseau horaire", s.timezone],
        ["Préavis minimum de réservation", `${s.minNoticeHours} h`],
        ["Préavis minimum d'annulation", `${s.cancelNoticeHours} h`],
        ["Réservation possible jusqu'à", `${s.maxDaysAhead} jours à l'avance`],
        ["Rendez-vous à venir par numéro", String(s.maxActivePerPhone)],
        ["Créneaux de réservation", s.slots.filter((x) => x.active).map((x) => x.slot).join(" · ") || "Aucun créneau actif"],
      ]
    : [];
  return (
    <>
      <PageHeader title="Paramètres" text="Informations de l'établissement et contrôle d'accès." />
      <Panel title="Règles de réservation">
        <DataState {...viewState(query, rules.length)} onRetry={() => void query.refetch()}>
          <dl className="divide-y">
            {rules.map(([k, v]) => (
              <div key={k} className="grid gap-1 px-5 py-3.5 sm:grid-cols-[14rem_1fr]"><dt className="text-sm text-muted-foreground">{k}</dt><dd className="text-sm text-deep">{v}</dd></div>
            ))}
          </dl>
          <p className="border-t px-5 py-3 text-xs text-muted-foreground">Valeurs lues depuis la base (tables <code>salon_settings</code> et <code>time_slots</code>). Elles ne sont pas modifiables depuis cette interface.</p>
        </DataState>
      </Panel>
      <Panel title="Établissement">
        <dl className="divide-y">
          {identity.map(([k, v]) => (
            <div key={k} className="grid gap-1 px-5 py-3.5 sm:grid-cols-[14rem_1fr]"><dt className="text-sm text-muted-foreground">{k}</dt><dd className="text-sm text-deep">{v}</dd></div>
          ))}
        </dl>
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">Ces valeurs sont définies dans <code>src/data/settings.ts</code> et ne sont pas modifiables depuis cette interface.</p>
      </Panel>
      <Panel title="Accès administrateur">
        <div className="flex gap-3 px-5 py-5">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sage" />
          <div className="text-sm">
            <p className="font-medium text-deep">Connecté : {email}</p>
            <p className="mt-1 text-muted-foreground">L'accès repose sur une connexion Supabase et sur le rôle « admin » de la table <code>user_roles</code>, contrôlé par la base (RLS). L'authentification à deux facteurs (MFA) n'est pas encore exigée, et la gestion des administrateurs se fait directement dans Supabase.</p>
          </div>
        </div>
      </Panel>
    </>
  );
}
