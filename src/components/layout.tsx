import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X, ShoppingBag, Phone, Facebook, MapPin } from "lucide-react";
import { useCart } from "@/lib/cart";
import { cartCount, waLink } from "@/lib/format";
import { settings } from "@/data/settings";

const nav = [
  { to: "/", label: "Accueil" },
  { to: "/soins", label: "Nos soins" },
  { to: "/boutique", label: "Boutique" },
  { to: "/a-propos", label: "À propos" },
  { to: "/contact", label: "Contact" },
] as const;

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link to="/" className="flex flex-col leading-none">
      <span className={`font-display text-2xl tracking-[0.12em] ${light ? "text-deep-foreground" : "text-deep"}`}>DALANDA</span>
      <span className={`font-display text-sm italic ${light ? "text-gold" : "text-primary"}`}>Beauty-Spa</span>
    </Link>
  );
}

export function Header() {
  const { lines } = useCart();
  const count = cartCount(lines);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 20);
    f(); window.addEventListener("scroll", f); return () => window.removeEventListener("scroll", f);
  }, []);
  return (
    <header className={`sticky top-0 z-40 hidden border-b border-white/10 bg-deep text-deep-foreground lg:block transition-all ${scrolled ? "py-2 shadow-soft" : "py-4"}`}>
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5">
        <Logo light />
        <nav className="hidden items-center gap-7 lg:flex">
          {nav.map((n) => (
            <Link key={n.to} to={n.to} activeOptions={{ exact: n.to === "/" }}
              className="border-b-2 border-transparent py-1 text-sm font-medium text-deep-foreground/85 transition hover:text-white data-[status=active]:border-gold data-[status=active]:text-white">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/panier" aria-label={`Panier, ${count} article(s)`} className="relative rounded-full p-2.5 text-deep-foreground hover:bg-white/10">
            <ShoppingBag className="h-5 w-5" />
            {count > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-gold px-1 text-[11px] font-bold text-deep">{count}</span>}
          </Link>
          <Link to="/reservation" className="btn btn-gold hidden sm:inline-flex">Réserver un soin</Link>
          <button className="rounded-full p-2.5 hover:bg-white/10 lg:hidden" aria-label="Menu" onClick={() => setOpen(!open)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="mx-auto flex max-w-7xl flex-col px-5 pb-4 pt-2 lg:hidden">
          {nav.map((n) => (
            <Link key={n.to} to={n.to} onClick={() => setOpen(false)} className="border-b border-white/10 py-3 font-display text-xl">{n.label}</Link>
          ))}
          <Link to="/reservation" onClick={() => setOpen(false)} className="btn btn-gold mt-4">Réserver un soin</Link>
        </nav>
      )}
    </header>
  );
}

/** Logo WhatsApp (glyphe monochrome) : seul un pictogramme de marque reconnaissable signale clairement le canal. */
function WhatsAppGlyph({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className} fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" /></svg>;
}

export function WhatsAppFab() {
  const href = waLink("Bonjour Dalanda Beauty, j'aimerais avoir des informations.");
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label="Écrire sur WhatsApp"
      className="fixed bottom-20 right-4 z-40 hidden h-14 w-14 place-items-center rounded-full bg-[#12874a] text-white shadow-soft ring-2 ring-white transition hover:scale-105 hover:bg-[#0e6f3d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#12874a] lg:bottom-6 lg:grid">
      <WhatsAppGlyph className="h-7 w-7" />
    </a>
  );
}

export function Footer() {
  return (
    <footer className="hidden bg-deep pb-24 pt-16 text-deep-foreground lg:block lg:pb-10">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 md:grid-cols-3">
        <div>
          <p className="font-display text-3xl tracking-[0.12em]">DALANDA</p>
          <p className="font-display italic text-gold">Beauty-Spa & Cosmétique</p>
          <p className="mt-4 max-w-xs text-sm opacity-75">Soins du visage, massages, coiffure et produits Dalanda Cosmétique.</p>
        </div>
        <div className="space-y-2 text-sm">
          <p className="eyebrow !text-gold">Nous trouver</p>
          <p className="flex gap-2 opacity-85"><MapPin className="h-4 w-4 shrink-0" />{settings.address}</p>
          {settings.phones.map((p) => <p key={p} className="flex gap-2 opacity-85"><Phone className="h-4 w-4" />{p}</p>)}
        </div>
        <div className="space-y-2 text-sm">
          <p className="eyebrow !text-gold">Suivez-nous</p>
          <a className="flex gap-2 opacity-85 hover:opacity-100" href={settings.facebookBeauty} target="_blank" rel="noreferrer"><Facebook className="h-4 w-4" />Dalanda Beauty</a>
          <a className="flex gap-2 opacity-85 hover:opacity-100" href={settings.facebookCosmetique} target="_blank" rel="noreferrer"><Facebook className="h-4 w-4" />Dalanda Cosmétique</a>
        </div>
      </div>
      <p className="mx-auto mt-12 max-w-7xl px-5 text-xs opacity-50">© {new Date().getFullYear()} Dalanda Beauty. Tarifs indicatifs, à confirmer auprès de l'établissement.</p>
    </footer>
  );
}

export function PageTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <section className="bg-secondary">
      <div className="mx-auto max-w-7xl px-5 py-14 md:py-20">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-3 text-4xl text-deep md:text-6xl">{title}</h1>
        {text && <p className="mt-4 max-w-2xl text-muted-foreground">{text}</p>}
      </div>
    </section>
  );
}
