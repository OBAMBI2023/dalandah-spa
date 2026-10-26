import { Link, useRouter } from "@tanstack/react-router";
import { useCallback, useState, type ReactNode } from "react";
import { responsiveSources } from "@/lib/images";
import { ChevronLeft, Check, Flower2, Home, Sparkles, CalendarDays, ShoppingBag, Menu } from "lucide-react";

export function LogoMark({ light = false, size = "md" }: { light?: boolean; size?: "md" | "lg" }) {
  const c = light ? "text-gold" : "text-gold-deep";
  return (
    <div className="flex flex-col items-center leading-none">
      <Flower2 className={`${c} ${size === "lg" ? "h-12 w-12" : "h-7 w-7"}`} strokeWidth={1.4} />
      <span className={`mt-1 font-display tracking-[0.18em] ${light ? "text-deep-foreground" : "text-deep"} ${size === "lg" ? "text-5xl" : "text-2xl"}`}>DALANDA</span>
      <span className={`mt-0.5 text-[9px] tracking-[0.4em] ${light ? "text-gold" : "text-gold-deep"}`}>BEAUTY SPA</span>
    </div>
  );
}

export function AppBar({ title, back = true, right }: { title: string; back?: boolean; right?: ReactNode }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 grid grid-cols-[2.5rem_1fr_2.5rem] items-center bg-background/95 px-4 py-3 backdrop-blur">
      {back ? (
        <button aria-label="Retour" onClick={() => router.history.back()} className="grid h-10 w-10 place-items-center rounded-full hover:bg-secondary"><ChevronLeft className="h-6 w-6" /></button>
      ) : <span />}
      <h1 className="text-center font-display text-xl text-deep">{title}</h1>
      <div className="grid place-items-center">{right}</div>
    </header>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return <div className="mx-auto min-h-[100dvh] w-full max-w-md overflow-x-hidden bg-background pb-24 lg:min-h-[70vh] lg:pb-12 lg:shadow-soft">{children}</div>;
}

export function Stepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  const labels = ["Soin", "Date", "Heure", "Confirmation"];
  return (
    <ol className="flex items-start px-5 pt-2">
      {labels.map((l, i) => {
        const n = i + 1, done = n < step, cur = n === step;
        return (
          <li key={l} className="relative flex flex-1 flex-col items-center text-[11px]">
            {i > 0 && <span className={`absolute right-1/2 top-3.5 h-px w-full ${n <= step ? "bg-deep" : "bg-border"}`} />}
            <span className={`relative z-10 grid h-7 w-7 place-items-center rounded-full border text-xs font-semibold ${cur || done ? "border-deep bg-deep text-deep-foreground" : "bg-background text-muted-foreground"}`}>
              {done ? <Check className="h-3.5 w-3.5" /> : n}
            </span>
            <span className={`mt-1 ${cur ? "font-semibold text-deep" : "text-muted-foreground"}`}>{l}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function AppTabBar() {
  const items = [
    { to: "/", label: "Accueil", Icon: Home },
    { to: "/prestations", label: "Prestations", Icon: Sparkles },
    { to: "/rendez-vous", label: "Mes RDV", Icon: CalendarDays },
    { to: "/boutique", label: "Boutique", Icon: ShoppingBag },
    { to: "/plus", label: "Plus", Icon: Menu },
  ] as const;
  return (
    <nav aria-label="Navigation principale" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {items.map(({ to, label, Icon }) => (
        <Link key={to} to={to} activeOptions={{ exact: to === "/" }}
          className="relative flex flex-col items-center gap-1 py-2.5 text-[11px] text-muted-foreground data-[status=active]:font-semibold data-[status=active]:text-gold-deep data-[status=active]:after:absolute data-[status=active]:after:top-0 data-[status=active]:after:h-0.5 data-[status=active]:after:w-8 data-[status=active]:after:rounded-full data-[status=active]:after:bg-gold-deep">
          <Icon className="h-5 w-5" />{label}
        </Link>
      ))}
    </nav>
  );
}

type ImgProps = {
  src?: string | undefined; alt?: string; className?: string;
  /** Largeur d'affichage réelle (attribut sizes) : évite de télécharger une version plus grande que nécessaire. */
  sizes?: string;
  /** Image principale visible immédiatement : chargée tout de suite, jamais en différé. */
  priority?: boolean;
};

/** Image unique de l'appli : version réduite WebP si disponible, chargement différé, placeholder léger, repli si absente. */
export function Img({ src, alt = "", className = "", sizes = "100vw", priority = false }: ImgProps) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  const ref = useCallback((el: HTMLImageElement | null) => { if (el?.complete && el.naturalWidth > 0) setState("loaded"); }, []);
  const r = src ? responsiveSources(src) : null;
  if (!src || state === "failed") {
    return (
      <div role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}
        className={`grid place-items-center bg-gradient-to-br from-secondary to-gold/30 text-gold-deep ${className}`}>
        <Flower2 className="h-1/3 w-1/3 max-h-12 max-w-12" strokeWidth={1.2} />
      </div>
    );
  }
  return (
    <img ref={ref} src={r?.fallback ?? src} srcSet={r?.srcSet} sizes={r ? sizes : undefined} alt={alt}
      loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding={priority ? "sync" : "async"}
      onLoad={() => setState("loaded")} onError={() => setState("failed")}
      className={`object-cover bg-secondary ${className}`} />
  );
}

export const ServiceImage = Img;
