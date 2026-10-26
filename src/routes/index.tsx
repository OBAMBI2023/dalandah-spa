import { createFileRoute, Link } from "@tanstack/react-router";
import { Leaf, Heart, Sparkles, Flower2, Clock } from "lucide-react";
import hero from "@/assets/hero-spa.jpg";
import gammeCosmetique from "@/assets/gamme-cosmetique.jpg";
import { useCatalogue } from "@/lib/catalogue";
import { categoriesInUse } from "@/lib/service-categories";
import { useShopProducts } from "@/lib/shop-products";
import { ProductCard } from "@/components/cards";
import { MobileHome } from "@/components/mobile-home";
import { Img } from "@/components/app";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dalanda Beauty-Spa — Votre moment de détente à Abidjan" },
      { name: "description", content: "Soins du visage, massages relaxants, coiffure et cosmétiques Dalanda à Abidjan Riviera. Réservez par WhatsApp." },
      { property: "og:title", content: "Dalanda Beauty-Spa — Votre moment de détente" },
      { property: "og:description", content: "Soins, massages, coiffure et boutique Dalanda Cosmétique à Abidjan." },
    ],
  }),
  component: Index,
});

const values = [
  { Icon: Leaf, t: "Le bien-être", d: "Un espace pensé pour vous détendre." },
  { Icon: Heart, t: "La douceur", d: "Des gestes attentifs à chaque soin." },
  { Icon: Sparkles, t: "Le soin personnalisé", d: "Une prestation adaptée à vos envies." },
  { Icon: Flower2, t: "La beauté naturelle", d: "Révéler votre beauté, simplement." },
  { Icon: Clock, t: "Du temps pour soi", d: "Le plaisir de s'accorder une pause." },
];

function Index() {
  const { products } = useShopProducts();
  // Catégories d'origine et catégories créées depuis l'administration, à condition de compter au moins une prestation active.
  const { services, categories } = useCatalogue();
  const shownCategories = categoriesInUse(categories, services);
  return (
    <>
      <MobileHome />
      <div className="hidden lg:block">
      <section className="relative overflow-hidden bg-deep text-deep-foreground">
        <Img sizes="100vw" src={hero} alt="Trois amies en peignoir profitant d'un moment de détente au spa" className="absolute inset-0 h-full w-full object-cover object-[50%_32%]" />
        <div className="absolute inset-0 bg-gradient-to-r from-deep/92 via-deep/72 to-transparent" />
        <div className="relative mx-auto max-w-7xl px-5 py-24 md:py-36">
          <div className="max-w-2xl animate-fade-up">
            <p className="eyebrow !text-gold">Dalanda Beauty-Spa · Abidjan</p>
            <h1 className="mt-4 text-5xl leading-[1.05] md:text-7xl">Votre moment de détente absolue</h1>
            <p className="mt-6 font-display text-2xl italic text-gold">Prenez soin de votre corps, sublimez votre peau et révélez votre beauté naturelle.</p>
            <p className="mt-4 max-w-xl opacity-85">Bienvenue chez Dalanda Beauty-Spa, votre espace dédié aux soins du visage, aux massages relaxants et à la beauté des cheveux.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/soins" className="btn btn-gold">Découvrir nos soins</Link>
              <Link to="/boutique" className="btn btn-ghost-light">Explorer la boutique</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20">
        <p className="eyebrow">Nos prestations</p>
        <h2 className="mt-2 text-4xl text-deep md:text-5xl">Prenez du temps pour vous</h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {shownCategories.map((c) => (
            <article key={c.id} className="group overflow-hidden rounded-2xl border bg-card">
              <div className="aspect-[4/5] overflow-hidden"><Img src={c.image} alt={c.title} className="h-full w-full object-cover transition duration-700 group-hover:scale-105" /></div>
              <div className="p-5">
                <h3 className="text-2xl text-deep">{c.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
                <Link to="/soins" search={{ categorie: c.id }} className="mt-3 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline">Découvrir →</Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-secondary py-20">
        <div className="mx-auto max-w-7xl px-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Dalanda Cosmétique</p>
              <h2 className="mt-2 text-4xl text-deep md:text-5xl">Votre routine beauté, tout en douceur</h2>
              <p className="mt-3 max-w-xl text-muted-foreground">Découvrez la sélection Dalanda Cosmétique et prenez soin de votre peau au quotidien.</p>
            </div>
            <Link to="/boutique" className="btn btn-outline">Voir toute la boutique</Link>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {products.filter((p) => p.available).slice(0, 4).map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20">
        <div className="max-w-2xl">
          <p className="eyebrow">L'expérience Dalanda</p>
          <h2 className="mt-2 text-4xl text-deep md:text-5xl">La beauté commence par le soin de soi</h2>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {values.map(({ Icon, t, d }) => (
            <div key={t} className="border-t-2 border-gold pt-5">
              <Icon className="h-6 w-6 text-sage" />
              <h3 className="mt-3 text-xl text-deep">{t}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl items-center gap-10 px-5 pb-20 md:grid-cols-2">
        <Img sizes="(min-width: 768px) 50vw, 100vw" src={gammeCosmetique} alt="Affiche Dalanda Cosmétique : produits 100 % bio, gommage corps, mousse nettoyante, eau de parfum, savons et savon liquide" className="rounded-2xl shadow-soft" />
        <div>
          <p className="eyebrow">Dalanda Cosmétique</p>
          <h2 className="mt-2 text-4xl text-deep md:text-5xl">Une routine pensée pour votre peau</h2>
          <p className="mt-4 text-muted-foreground">Votre peau mérite une routine qui prend soin d'elle tout en douceur. Découvrez les produits Dalanda Cosmétique et choisissez les soins adaptés à vos besoins.</p>
          <Link to="/boutique" className="btn btn-primary mt-6">Découvrir nos cosmétiques</Link>
        </div>
      </section>

      <section className="border-t bg-card py-20 text-center text-deep">
        <div className="mx-auto max-w-2xl px-5">
          <h2 className="text-4xl md:text-5xl">Accordez-vous un moment pour vous</h2>
          <p className="mt-4 text-muted-foreground">Un soin, un massage ou une nouvelle routine beauté : faites de votre bien-être une priorité.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/reservation" className="btn btn-gold">Réserver un soin</Link>
            <Link to="/boutique" className="btn btn-outline">Découvrir la boutique</Link>
          </div>
        </div>
      </section>
      </div>
    </>
  );
}
