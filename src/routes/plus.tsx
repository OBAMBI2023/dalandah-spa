import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Home, Sparkles, CalendarPlus, CalendarDays, User, Store, Phone, X, Heart } from "lucide-react";
import { LogoMark } from "@/components/app";

export const Route = createFileRoute("/plus")({
  head: () => ({ meta: [{ title: "Menu | Dalanda Beauty Spa" }] }),
  component: Plus,
});

const links = [
  { to: "/", label: "Accueil", Icon: Home },
  { to: "/prestations", label: "Prestations", Icon: Sparkles },
  { to: "/reservation", label: "Réservation", Icon: CalendarPlus },
  { to: "/rendez-vous", label: "Mes rendez-vous", Icon: CalendarDays },
  { to: "/profil", label: "Mon profil", Icon: User },
  { to: "/boutique", label: "Boutique", Icon: Store },
  { to: "/contact", label: "Aide & contact", Icon: Phone },
] as const;

function Plus() {
  const router = useRouter();
  return (
    <div className="mx-auto min-h-[100dvh] max-w-md bg-deep px-6 pb-24 pt-4 text-deep-foreground lg:min-h-[70vh] lg:pb-12">
      <div className="flex justify-end">
        <button aria-label="Fermer" onClick={() => router.history.back()} className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/10"><X className="h-6 w-6" /></button>
      </div>
      <div className="mt-2 flex justify-center"><LogoMark light /></div>
      <nav className="mt-10 space-y-1">
        {links.map(({ to, label, Icon }) => (
          <Link key={to} to={to} className="flex items-center gap-4 rounded-xl px-2 py-3.5 text-base hover:bg-white/10"><Icon className="h-6 w-6" strokeWidth={1.4} />{label}</Link>
        ))}
      </nav>
      <p className="mt-12 flex items-center gap-2 font-display text-2xl italic text-gold">La beauté du naturel <Heart className="h-5 w-5" /></p>
    </div>
  );
}
