import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { parsePromoParam } from "@/lib/promotion-tracking";
import { ChevronLeft, Clock } from "lucide-react";
import { formatFCFA } from "@/lib/format";
import { useCatalogue } from "@/lib/catalogue";
import { AppBar, Screen, Img } from "@/components/app";

export const Route = createFileRoute("/prestations/$serviceId")({
  // ?promo= : promotion d'origine, conservée jusqu'à la réservation (suivi uniquement, aucun effet sur le prix).
  validateSearch: (s: Record<string, unknown>): { promo?: string } => { const promo = parsePromoParam(s["promo"]); return promo ? { promo } : {}; },
  head: () => ({ meta: [{ title: "Prestation | Dalanda Beauty Spa" }] }),
  component: Detail,
});

function Detail() {
  const { serviceId } = Route.useParams();
  const { promo } = Route.useSearch();
  const { services, loaded, isError } = useCatalogue();
  const router = useRouter();
  const s = services.find((x) => x.id === serviceId);

  if (!s) {
    // Le catalogue distant peut ne pas être encore chargé : on n'affiche « introuvable » qu'une fois la réponse reçue.
    return (
      <Screen>
        <AppBar title="Prestation" />
        <div className="px-6 pt-12 text-center">
          <p className="text-sm text-muted-foreground">
            {!loaded && !isError ? "Chargement…" : isError ? "Impossible de charger la prestation pour le moment." : "Cette prestation n'existe pas ou n'est plus proposée."}
          </p>
          <Link to="/prestations" search={{}} className="btn btn-app-outline mt-4">Voir toutes les prestations</Link>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="relative h-64">
        <Img priority sizes="(min-width: 448px) 448px, 100vw" src={s.image} alt={s.name} className="h-full w-full" />
        <button aria-label="Retour" onClick={() => router.history.back()} className="absolute left-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-background/80 backdrop-blur"><ChevronLeft className="h-6 w-6" /></button>
      </div>
      <div className="relative -mt-5 rounded-t-3xl bg-background px-5 pt-5">
        <h1 className="text-3xl text-deep">{s.name}</h1>
        <p className="mt-1 text-xl font-semibold text-deep">{formatFCFA(s.price)}</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Clock className="h-4 w-4" />{s.duration}</p>
        <p className="mt-4 text-sm text-muted-foreground">{s.description}</p>
        <p className="mt-3 text-[11px] text-muted-foreground">Tarif et durée indicatifs, à confirmer par l'établissement.</p>
        <Link to="/reservation" search={{ service: s.id, ...(promo ? { promo } : {}) }} className="btn btn-app mt-6 w-full">Prendre rendez-vous</Link>
        <Link to="/prestations" search={{ categorie: s.category }} className="btn btn-app-outline mt-3 w-full">Voir les autres soins</Link>
      </div>
    </Screen>
  );
}
