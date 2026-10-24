import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { ChevronLeft, Clock } from "lucide-react";
import { services } from "@/data/services";
import { formatFCFA } from "@/lib/format";
import { Screen, Img } from "@/components/app";

export const Route = createFileRoute("/prestations/$serviceId")({
  loader: ({ params }) => {
    const service = services.find((s) => s.id === params.serviceId);
    if (!service) throw notFound();
    return service;
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.name ?? "Soin"} | Dalanda Beauty Spa` }, { name: "description", content: loaderData?.description ?? "" }] }),
  component: Detail,
});

function Detail() {
  const s = Route.useLoaderData();
  const router = useRouter();
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
        <Link to="/reservation" search={{ service: s.id }} className="btn btn-app mt-6 w-full">Prendre rendez-vous</Link>
        <Link to="/prestations" search={{ categorie: s.category }} className="btn btn-app-outline mt-3 w-full">Voir les autres soins</Link>
      </div>
    </Screen>
  );
}
