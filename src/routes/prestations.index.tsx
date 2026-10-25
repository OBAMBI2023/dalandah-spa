import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Clock, Search, X } from "lucide-react";
import { useCatalogue } from "@/lib/catalogue";
import { categoriesInUse, parseCategoryParam } from "@/lib/service-categories";
import { formatFCFA } from "@/lib/format";
import { LogoMark, Screen, Img } from "@/components/app";

export const Route = createFileRoute("/prestations/")({
  // Le format seul est vérifié ici : les catégories viennent du catalogue (base de données), l'existence est vérifiée dans la page.
  validateSearch: (s: Record<string, unknown>): { categorie?: string } => {
    const c = parseCategoryParam(s["categorie"]);
    return c ? { categorie: c } : {};
  },
  head: () => ({ meta: [{ title: "Nos prestations | Dalanda Beauty Spa" }, { name: "description", content: "Soins du visage, du corps, coiffure, massages et onglerie." }] }),
  component: Prestations,
});

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function Prestations() {
  const { categorie: asked } = Route.useSearch();
  const { services, categories } = useCatalogue();
  const navigate = useNavigate({ from: "/prestations/" });
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (searching) input.current?.focus(); }, [searching]);

  // Une catégorie n'est proposée que si elle compte au moins une prestation ; une catégorie inconnue dans l'adresse revient à « Tous ».
  const cats = categoriesInUse(categories, services);
  const categorie = asked && cats.some((c) => c.id === asked) ? asked : undefined;
  const q = norm(query.trim());
  const list = services.filter((s) => (!categorie || s.category === categorie) && (!q || norm(`${s.name} ${s.description}`).includes(q)));
  const chip = (on: boolean) => `shrink-0 rounded-full border px-4 py-2 text-xs font-medium transition ${on ? "border-gold bg-gold text-deep shadow-sm" : "border-border bg-card text-muted-foreground"}`;

  return (
    <Screen>
      <header className="sticky top-0 z-30 bg-background/95 px-4 pb-1 pt-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="scale-75 origin-left"><LogoMark /></div>
          <button aria-label={searching ? "Fermer la recherche" : "Rechercher une prestation"} aria-expanded={searching}
            onClick={() => { setSearching(!searching); if (searching) setQuery(""); }}
            className="grid h-10 w-10 place-items-center rounded-full border bg-card shadow-sm">
            {searching ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </button>
        </div>
        <h1 className="mt-1 text-3xl text-deep">Nos prestations</h1>
        {searching && (
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input ref={input} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un soin…" aria-label="Rechercher une prestation" className="field pl-9" />
          </div>
        )}
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none]" role="tablist" aria-label="Catégories">
          <button role="tab" aria-selected={!categorie} className={chip(!categorie)} onClick={() => navigate({ search: {} })}>Tous</button>
          {cats.map((c) => (
            <button key={c.id} role="tab" aria-selected={categorie === c.id} className={chip(categorie === c.id)} onClick={() => navigate({ search: { categorie: c.id } })}>{c.label}</button>
          ))}
        </div>
      </header>

      <ul className="space-y-3 px-4 pt-1">
        {list.map((s) => (
          <li key={s.id}>
            <Link to="/prestations/$serviceId" params={{ serviceId: s.id }} className="flex items-center gap-3 rounded-3xl border border-border/70 bg-card p-3 shadow-soft transition active:scale-[0.99]">
              <Img src={s.image} sizes="96px" className="aspect-square h-24 w-24 shrink-0 rounded-2xl" />
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-lg leading-tight text-deep">{s.name}</h2>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{s.description}</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5 text-gold-deep" />{s.duration}</p>
                <p className="text-sm font-semibold text-gold-deep">{formatFCFA(s.price)}</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-gold-deep" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      {list.length === 0 && (
        <div className="px-6 pt-12 text-center">
          <p className="text-sm text-muted-foreground">Aucune prestation ne correspond à votre recherche.</p>
          <button className="btn btn-app-outline mt-4" onClick={() => { setQuery(""); navigate({ search: {} }); }}>Réinitialiser</button>
        </div>
      )}
      <p className="px-6 pt-5 text-center text-[11px] text-muted-foreground">Tarifs et durées indicatifs, à confirmer par l'établissement.</p>
    </Screen>
  );
}
