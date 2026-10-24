import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import facial from "@/assets/facial.jpg.asset.json";
import { LogoMark, Img } from "@/components/app";

export const Route = createFileRoute("/bienvenue")({
  head: () => ({ meta: [{ title: "Bienvenue | Dalanda Beauty Spa" }] }),
  component: Splash,
});

function Splash() {
  return (
    <div className="relative mx-auto flex min-h-[100dvh] max-w-md flex-col justify-between overflow-hidden bg-deep px-6 py-10 text-center text-deep-foreground lg:min-h-[70vh]">
      <Img priority sizes="448px" src={facial.url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
      <div className="absolute inset-0 bg-gradient-to-b from-deep/60 via-transparent to-deep/90" />
      <div className="relative flex justify-center"><LogoMark light size="lg" /></div>
      <div className="relative">
        <h1 className="font-display text-3xl">Votre beauté, notre priorité</h1>
        <p className="mx-auto mt-3 max-w-xs text-sm opacity-90">Des soins sur mesure pour révéler votre éclat naturel.</p>
        <Link to="/" className="btn btn-app mt-8 w-full">Commencer <ArrowRight className="h-4 w-4" /></Link>
      </div>
    </div>
  );
}
