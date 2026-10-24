import { createFileRoute } from "@tanstack/react-router";
import { MobileBooking } from "@/components/mobile-booking";

export const Route = createFileRoute("/reservation")({
  validateSearch: (s: Record<string, unknown>): { service?: string } =>
    typeof s.service === "string" ? { service: s.service } : {},
  head: () => ({
    meta: [
      { title: "Réserver un soin | Dalanda Beauty-Spa" },
      { name: "description", content: "Réservez votre soin chez Dalanda Beauty-Spa : choisissez la prestation, la date et l'heure." },
      { property: "og:title", content: "Réserver un soin | Dalanda Beauty-Spa" },
      { property: "og:description", content: "Réservation en ligne d'un soin chez Dalanda Beauty-Spa." },
    ],
  }),
  component: BookingPage,
});

// Un seul parcours de réservation (mobile et bureau) : il enregistre la réservation sur le serveur, sans passer par WhatsApp.
function BookingPage() {
  const { service } = Route.useSearch();
  return <MobileBooking initialService={service} />;
}
