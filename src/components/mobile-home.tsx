import { Link } from "@tanstack/react-router";
import { Bell, Calendar, Smile, User, Scissors, Flower2, Hand, Tag, ArrowRight, MapPin, Sparkles } from "lucide-react";
import { toast } from "sonner";
import hero from "@/assets/hero.jpg";
import { useCatalogue } from "@/lib/catalogue";
import { serviceCategories } from "@/data/services";
import { categoriesInUse } from "@/lib/service-categories";
import { trackPromotion, usePromotionImpression } from "@/lib/promotion-tracking";
import { PROMO_NOTICE, discountPercent, promotionTarget, usePromotions, type Promotion } from "@/lib/promotions";
import { settings } from "@/data/settings";
import { formatFCFA } from "@/lib/format";
import { LogoMark, Screen, Img } from "@/components/app";

const shortcuts = [
  { label: "Soins visage", Icon: Smile, search: { categorie: "visage" as const } },
  { label: "Soins corps", Icon: User, search: { categorie: "corps" as const } },
  { label: "Coiffure", Icon: Scissors, search: { categorie: "coiffure" as const } },
  { label: "Massages", Icon: Flower2, search: { categorie: "massage" as const } },
  { label: "Onglerie", Icon: Hand, search: { categorie: "onglerie" as const } },
];

/** Ligne d'une promotion sur l'accueil : impression (50 % visible pendant 1 s) et clic suivis, identifiant transmis dans le lien (?promo=). */
function PromoTile({ p }: { p: Promotion }) {
  const impressionRef = usePromotionImpression(p.id);
  const pct = discountPercent(p);
  const target = promotionTarget(p);
  const click = () => { void trackPromotion("click", p.id); };
  const body = (
    <>
      <Img src={p.imageUrl ?? undefined} alt="" sizes="96px" className="h-16 w-16 rounded-xl object-cover" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-deep">{p.title}</p>
        {p.kind === "price" && p.originalPrice !== null && p.promoPrice !== null && (
          <p className="text-xs text-muted-foreground"><s>{formatFCFA(p.originalPrice)}</s> <b className="text-gold-deep">{formatFCFA(p.promoPrice)}</b></p>
        )}
        {p.kind === "announcement" && p.description && <p className="line-clamp-1 text-xs text-muted-foreground">{p.description}</p>}
      </div>
      {pct !== null && <span className="rounded-full bg-gold/20 px-2 py-1 text-xs font-semibold text-gold-deep">-{pct}%</span>}
    </>
  );
  const cls = "flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-soft";
  return (
    <li ref={impressionRef}>
      {target?.kind === "service" ? <Link to="/prestations/$serviceId" params={{ serviceId: target.id }} search={{ promo: p.id }} onClick={click} className={cls}>{body}</Link>
        : target?.kind === "product" ? <Link to="/boutique/$productId" params={{ productId: target.id }} search={{ promo: p.id }} onClick={click} className={cls}>{body}</Link>
        : <Link to="/promotions" onClick={click} className={cls}>{body}</Link>}
    </li>
  );
}

export function MobileHome() {
  const { services, categories } = useCatalogue();
  // Promotions actives (informatives) ; la section est masquée tant qu'il n'y en a aucune (ou si la lecture échoue).
  const promos = (usePromotions().data ?? []).slice(0, 3);
  // Raccourcis d'origine inchangés ; les catégories créées depuis l'administration s'y ajoutent dès qu'elles ont une prestation active.
  const added = categoriesInUse(categories, services).filter((c) => !serviceCategories.some((o) => o.id === c.id));
  const picked = services.filter((s) => ["soin-visage-eclat", "massage-relaxant"].includes(s.id));
  const featured = picked.length === 2 ? picked : services.slice(0, 2);
  return (
    <div className="lg:hidden">
      <Screen>
        <div className="flex items-center justify-between px-5 py-3">
          <span className="w-10" />
          <LogoMark />
          <button aria-label="Notifications" className="grid h-10 w-10 place-items-center rounded-full hover:bg-secondary"
            onClick={() => toast("Aucun rappel pour le moment", { description: "Les rappels de rendez-vous seront activés une fois les notifications configurées." })}>
            <Bell className="h-6 w-6" />
          </button>
        </div>

        <section className="relative h-72 overflow-hidden">
          <Img priority sizes="100vw" src={hero} alt="Trois amies en peignoir profitant d'un moment de détente au spa" className="absolute inset-0 h-full w-full object-cover object-[50%_30%]" />
          <div className="absolute inset-0 bg-gradient-to-t from-deep/90 via-deep/40 to-transparent" />
          <div className="relative flex h-full flex-col justify-end px-5 pb-8 text-deep-foreground">
            <p className="font-display text-3xl">Bonjour,</p>
            <p className="mt-1 max-w-[16rem] font-display text-xl leading-snug">Prenez soin de vous, vous le méritez.</p>
            <Link to="/reservation" className="btn btn-app mt-4 w-fit"><Calendar className="h-4 w-4" />Réserver un soin</Link>
          </div>
        </section>

        <section className="relative -mt-4 rounded-t-3xl bg-background px-4 pt-5">
          <div className="grid grid-cols-3 gap-3">
            {shortcuts.map(({ label, Icon, search }) => (
              <Link key={label} to="/prestations" search={search} className="flex flex-col items-center gap-2 rounded-2xl border bg-card px-2 py-4 text-center text-xs shadow-soft">
                <Icon className="h-8 w-8 text-gold-deep" strokeWidth={1.3} />{label}
              </Link>
            ))}
            {added.map((c) => (
              <Link key={c.id} to="/prestations" search={{ categorie: c.id }} className="flex flex-col items-center gap-2 rounded-2xl border bg-card px-2 py-4 text-center text-xs shadow-soft">
                <Sparkles className="h-8 w-8 text-gold-deep" strokeWidth={1.3} /><span className="line-clamp-2">{c.label}</span>
              </Link>
            ))}
            <Link to="/promotions" className="flex flex-col items-center gap-2 rounded-2xl border bg-card px-2 py-4 text-center text-xs shadow-soft">
              <Tag className="h-8 w-8 text-gold-deep" strokeWidth={1.3} />Nos promotions
            </Link>
          </div>

          <div className="mt-6 flex items-baseline justify-between">
            <h2 className="text-xl text-deep">Nos prestations phares</h2>
            <Link to="/prestations" className="flex items-center gap-1 text-xs text-muted-foreground">Voir tout <ArrowRight className="h-3 w-3" /></Link>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {featured.map((s) => (
              <Link key={s.id} to="/prestations/$serviceId" params={{ serviceId: s.id }} className="relative aspect-[4/3] overflow-hidden rounded-2xl">
                <Img src={s.image} alt={s.name} className="h-full w-full" />
                <div className="absolute inset-0 bg-gradient-to-t from-deep/85 to-transparent" />
                <div className="absolute bottom-2 left-3 right-2 text-deep-foreground">
                  <p className="text-sm font-semibold leading-tight">{s.name}</p>
                  <p className="text-[10px] opacity-85">À partir de {formatFCFA(s.price)}</p>
                </div>
              </Link>
            ))}
          </div>

          <h2 className="mt-8 text-xl text-deep">Notre institut</h2>
          <p className="mt-2 text-sm text-muted-foreground">Dalanda Beauty Spa est votre espace dédié aux soins du visage, aux massages relaxants et à la beauté des cheveux.</p>
          <p className="mt-2 flex gap-2 text-sm text-muted-foreground"><MapPin className="h-4 w-4 shrink-0 text-gold-deep" />{settings.address}</p>

          {promos.length > 0 && (
            <section aria-labelledby="home-promos">
              <div className="mt-8 flex items-baseline justify-between">
                <h2 id="home-promos" className="text-xl text-deep">Promotions en cours</h2>
                <Link to="/promotions" className="flex items-center gap-1 text-xs text-muted-foreground">Voir tout <ArrowRight className="h-3 w-3" /></Link>
              </div>
              <ul className="mt-3 space-y-3">
                {promos.map((p) => <PromoTile key={p.id} p={p} />)}
              </ul>
              {promos.some((p) => p.kind !== "announcement") && <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{PROMO_NOTICE}</p>}
            </section>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl bg-deep p-4 text-deep-foreground">
            <p className="font-display text-lg leading-tight">Réservez en quelques secondes</p>
            <Link to="/reservation" className="btn btn-app shrink-0">Réserver</Link>
          </div>
        </section>
      </Screen>
    </div>
  );
}
