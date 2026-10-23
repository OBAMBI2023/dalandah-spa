import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X, ShoppingBag, Home, Sparkles, Store, Phone, MessageCircle, Facebook, MapPin } from "lucide-react";
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

export function Logo() {
  return (
    <Link to="/" className="flex flex-col leading-none">
      <span className="font-display text-2xl tracking-[0.12em] text-deep">DALANDA</span>
      <span className="font-display text-sm italic text-primary">Beauty-Spa</span>
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
    <header className={`sticky top-0 z-40 border-b bg-background/90 backdrop-blur transition-all ${scrolled ? "py-2 shadow-soft" : "py-4"}`}>
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5">
        <Logo />
        <nav className="hidden items-center gap-7 lg:flex">
          {nav.map((n) => (
            <Link key={n.to} to={n.to} activeOptions={{ exact: n.to === "/" }}
              className="text-sm font-medium text-foreground/80 transition hover:text-primary data-[status=active]:text-primary">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/panier" aria-label={`Panier, ${count} article(s)`} className="relative rounded-full p-2.5 hover:bg-secondary">
            <ShoppingBag className="h-5 w-5" />
            {count > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">{count}</span>}
          </Link>
          <Link to="/reservation" className="btn btn-primary hidden sm:inline-flex">Réserver un soin</Link>
          <button className="rounded-full p-2.5 hover:bg-secondary lg:hidden" aria-label="Menu" onClick={() => setOpen(!open)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="mx-auto flex max-w-7xl flex-col px-5 pb-4 pt-2 lg:hidden">
          {nav.map((n) => (
            <Link key={n.to} to={n.to} onClick={() => setOpen(false)} className="border-b py-3 font-display text-xl">{n.label}</Link>
          ))}
          <Link to="/reservation" onClick={() => setOpen(false)} className="btn btn-primary mt-4">Réserver un soin</Link>
        </nav>
      )}
    </header>
  );
}

export function MobileBar() {
  const { lines } = useCart();
  const count = cartCount(lines);
  const items = [
    { to: "/", label: "Accueil", Icon: Home },
    { to: "/soins", label: "Soins", Icon: Sparkles },
    { to: "/boutique", label: "Boutique", Icon: Store },
    { to: "/panier", label: "Panier", Icon: ShoppingBag },
    { to: "/contact", label: "Contact", Icon: Phone },
  ] as const;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background/95 backdrop-blur lg:hidden">
      {items.map(({ to, label, Icon }) => (
        <Link key={to} to={to} activeOptions={{ exact: to === "/" }}
          className="relative flex flex-col items-center gap-1 py-2.5 text-[11px] text-muted-foreground data-[status=active]:text-primary">
          <Icon className="h-5 w-5" />{label}
          {to === "/panier" && count > 0 && <span className="absolute right-[28%] top-1.5 h-2 w-2 rounded-full bg-primary" />}
        </Link>
      ))}
    </nav>
  );
}

export function WhatsAppFab() {
  const href = waLink("Bonjour Dalanda Beauty, j'aimerais avoir des informations.");
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label="Écrire sur WhatsApp"
      className="fixed bottom-20 right-4 z-40 grid h-13 w-13 place-items-center rounded-full bg-sage p-3.5 text-sage-foreground shadow-soft transition hover:scale-105 lg:bottom-6">
      <MessageCircle className="h-6 w-6" />
    </a>
  );
}

export function Footer() {
  return (
    <footer className="bg-deep pb-24 pt-16 text-deep-foreground lg:pb-10">
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
