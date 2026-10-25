import { createFileRoute } from "@tanstack/react-router";
import { MobileBooking } from "@/components/mobile-booking";
import { parsePromoParam } from "@/lib/promotion-tracking";

export const Route = createFileRoute("/reservation")({
  // ?service= : prestation choisie · ?promo= : promotion d'origine (suivi uniquement, aucun effet sur le prix).
  validateSearch: (s: Record<string, unknown>): { service?: string; promo?: string } => {
    const promo = parsePromoParam(s["promo"]);
    return { ...(typeof s["service"] === "string" ? { service: s["service"] } : {}), ...(promo ? { promo } : {}) };
  },
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
  const { service, promo } = Route.useSearch();
  return <MobileBooking initialService={service} promotionId={promo} />;
}
