import { createFileRoute, redirect } from "@tanstack/react-router";

// « Offres » s'appelle désormais « Promotions » (/promotions). L'ancienne adresse est conservée : les liens enregistrés ou partagés
// continuent de fonctionner et mènent à la nouvelle page.
export const Route = createFileRoute("/offres")({
  beforeLoad: () => { throw redirect({ to: "/promotions", replace: true }); },
});
