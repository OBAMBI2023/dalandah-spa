import { createFileRoute, Link } from "@tanstack/react-router";
import { services, serviceCategories, type ServiceCategory } from "@/data/services";
import { ServiceCard } from "@/components/cards";
import { PageTitle } from "@/components/layout";

type Search = { categorie?: ServiceCategory };

export const Route = createFileRoute("/soins")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const c = s.categorie as ServiceCategory;
    return serviceCategories.some((x) => x.id === c) ? { categorie: c } : {};
  },
  head: () => ({
    meta: [
      { title: "Nos soins — Visage, massage, coiffure | Dalanda Beauty-Spa" },
      { name: "description", content: "Découvrez les soins du visage, massages, soins du corps, coiffure et rituels spa de Dalanda Beauty-Spa à Abidjan." },
      { property: "og:title", content: "Nos soins | Dalanda Beauty-Spa" },
      { property: "og:description", content: "Soins du visage, massages, coiffure et rituels spa à Abidjan." },
    ],
  }),
  component: Soins,
});

function Soins() {
  const { categorie } = Route.useSearch();
  const list = categorie ? services.filter((s) => s.category === categorie) : services;
  const chip = "rounded-full border px-4 py-2 text-sm transition";
  return (
    <>
      <PageTitle eyebrow="Dalanda Beauty-Spa" title="Nos soins" text="Tarifs et durées indicatifs, à confirmer lors de la réservation." />
      <section className="mx-auto max-w-7xl px-5 py-12">
        <div className="flex flex-wrap gap-2">
          <Link to="/soins" search={{}} className={`${chip} ${!categorie ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>Tous les soins</Link>
          {serviceCategories.map((c) => (
            <Link key={c.id} to="/soins" search={{ categorie: c.id }}
              className={`${chip} ${categorie === c.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>{c.label}</Link>
          ))}
        </div>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((s) => <ServiceCard key={s.id} s={s} />)}
        </div>
      </section>
    </>
  );
}
