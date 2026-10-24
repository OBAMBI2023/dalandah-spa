import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { settings } from "@/data/settings";
import { PageHeader, Panel } from "@/components/admin";

export const Route = createFileRoute("/admin/parametres")({
  head: () => ({ meta: [{ title: "Paramètres | Administration Dalanda" }] }),
  component: Parametres,
});

const rows: [string, string][] = [
  ["Nom de l'établissement", settings.shopName],
  ["Adresse", settings.address],
  ["Téléphones", settings.phones.join(" · ")],
  ["WhatsApp", settings.whatsappNumber ? `+${settings.whatsappNumber}` : "Non configuré"],
  ["E-mail", settings.email || "Non renseigné"],
  ["Créneaux de réservation", settings.timeSlots.join(" · ")],
];

function Parametres() {
  return (
    <>
      <PageHeader title="Paramètres" text="Informations de l'établissement et contrôle d'accès." />
      <Panel title="Établissement">
        <dl className="divide-y">
          {rows.map(([k, v]) => (
            <div key={k} className="grid gap-1 px-5 py-3.5 sm:grid-cols-[14rem_1fr]"><dt className="text-sm text-muted-foreground">{k}</dt><dd className="text-sm text-deep">{v}</dd></div>
          ))}
        </dl>
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">Ces valeurs sont définies dans <code>src/data/settings.ts</code> et ne sont pas modifiables depuis cette interface.</p>
      </Panel>
      <Panel title="Accès administrateur">
        <div className="flex gap-3 px-5 py-5">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-gold-deep" />
          <div className="text-sm">
            <p className="font-medium text-deep">Non configuré</p>
            <p className="mt-1 text-muted-foreground">La gestion des administrateurs nécessite une authentification et une autorisation côté serveur, qui ne sont pas encore en place. Tant que ce n'est pas le cas, cette section reste informative.</p>
          </div>
        </div>
      </Panel>
    </>
  );
}
