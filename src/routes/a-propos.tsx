import { createFileRoute, Link } from "@tanstack/react-router";
import massage from "@/assets/massage.jpg.asset.json";
import coiffure from "@/assets/coiffure.jpg.asset.json";
import { PageTitle } from "@/components/layout";
import { Img } from "@/components/app";

export const Route = createFileRoute("/a-propos")({
  head: () => ({
    meta: [
      { title: "À propos | Dalanda Beauty-Spa & Cosmétique" },
      { name: "description", content: "Découvrez l'univers Dalanda Beauty : beauté, détente et bien-être, avec Dalanda Beauty-Spa et Dalanda Cosmétique." },
      { property: "og:title", content: "À propos de Dalanda Beauty" },
      { property: "og:description", content: "Beauté, détente et bien-être à Abidjan." },
    ],
  }),
  component: About,
});

function About() {
  return (
    <>
      <PageTitle eyebrow="Notre univers" title="À propos de Dalanda Beauty" />
      <section className="mx-auto max-w-3xl px-5 py-16">
        <p className="font-display text-2xl leading-relaxed text-deep md:text-3xl">
          Dalanda Beauty vous invite à prendre soin de vous à travers une expérience dédiée à la beauté, à la détente et au bien-être. Avec Dalanda Beauty-Spa et Dalanda Cosmétique, découvrez un univers où les soins du corps, la beauté du visage et les routines cosmétiques occupent une place essentielle.
        </p>
      </section>
      <section className="mx-auto grid max-w-7xl gap-10 px-5 pb-16 md:grid-cols-2">
        <Img src={massage.url} alt="Espace massage Dalanda Beauty-Spa" className="rounded-2xl" />
        <div className="self-center space-y-6">
          <div><h2 className="text-3xl text-deep">L'univers du bien-être</h2><p className="mt-2 text-muted-foreground">Un espace calme, pour se détendre et s'accorder une vraie pause.</p></div>
          <div><h2 className="text-3xl text-deep">Nos soins</h2><p className="mt-2 text-muted-foreground">Soins du visage, massages relaxants, soins du corps, coiffure et tresses, rituels spa.</p></div>
        </div>
      </section>
      <section className="mx-auto grid max-w-7xl gap-10 px-5 pb-24 md:grid-cols-2">
        <div className="order-2 self-center space-y-6 md:order-1">
          <div><h2 className="text-3xl text-deep">Spa et Dalanda Cosmétique</h2><p className="mt-2 text-muted-foreground">Les produits Dalanda Cosmétique prolongent chez vous l'attention portée lors de vos soins.</p></div>
          <div><h2 className="text-3xl text-deep">Une routine adaptée</h2><p className="mt-2 text-muted-foreground">Chaque peau est différente : choisir une routine qui vous correspond est essentiel. Demandez conseil à notre équipe.</p></div>
          <Link to="/reservation" className="btn btn-primary">Réserver un soin</Link>
        </div>
        <Img src={coiffure.url} alt="Coiffure Dalanda Beauty-Spa" className="order-1 rounded-2xl md:order-2" />
      </section>
    </>
  );
}
