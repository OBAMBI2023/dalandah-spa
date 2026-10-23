import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { products, productCategories } from "@/data/products";
import { ProductCard } from "@/components/cards";
import { PageTitle } from "@/components/layout";

export const Route = createFileRoute("/boutique")({
  head: () => ({
    meta: [
      { title: "Boutique Dalanda Cosmétique | Dalanda Beauty" },
      { name: "description", content: "Savons, mousses nettoyantes, gels douche et huiles Dalanda Cosmétique. Commandez par WhatsApp." },
      { property: "og:title", content: "Boutique Dalanda Cosmétique" },
      { property: "og:description", content: "La sélection Dalanda Cosmétique, à commander par WhatsApp." },
    ],
  }),
  component: ShopLayout,
});

function ShopLayout() {
  const child = useMatch({ from: "/boutique/$productId", shouldThrow: false });
  return child ? <Outlet /> : <Shop />;
}

function Shop() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [sort, setSort] = useState("default");
  const [onlyAvail, setOnlyAvail] = useState(false);

  const list = useMemo(() => {
    let l = products.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()) && (!cat || p.category === cat) && (!onlyAvail || p.available));
    if (sort === "asc") l = [...l].sort((a, b) => a.price - b.price);
    if (sort === "desc") l = [...l].sort((a, b) => b.price - a.price);
    if (sort === "name") l = [...l].sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return l;
  }, [q, cat, sort, onlyAvail]);

  return (
    <>
      <PageTitle eyebrow="Dalanda Cosmétique" title="La boutique" text="Prix indicatifs. Stocks non synchronisés : la disponibilité est confirmée par la boutique." />
      <section className="mx-auto max-w-7xl px-5 py-10 pb-24">
        <div className="grid gap-3 md:grid-cols-[1fr_220px_200px_auto]">
          <label className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input className="field !pl-9" placeholder="Rechercher un produit" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
          </label>
          <select className="field" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Catégorie">
            <option value="">Toutes les catégories</option>
            {productCategories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="field" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Trier">
            <option value="default">Trier</option>
            <option value="asc">Prix croissant</option>
            <option value="desc">Prix décroissant</option>
            <option value="name">Nom</option>
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyAvail} onChange={(e) => setOnlyAvail(e.target.checked)} className="h-4 w-4 accent-primary" />Disponibles</label>
        </div>
        {list.length ? (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{list.map((p) => <ProductCard key={p.id} p={p} />)}</div>
        ) : (
          <p className="mt-16 text-center text-muted-foreground">Aucun produit ne correspond à votre recherche.</p>
        )}
      </section>
    </>
  );
}
