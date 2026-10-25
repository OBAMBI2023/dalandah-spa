import { Link } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import type { ReactNode } from "react";
import { Img } from "@/components/app";
import { formatFCFA } from "@/lib/format";
import { trackPromotion, usePromotionImpression } from "@/lib/promotion-tracking";
import { discountPercent, periodLabel, PROMO_NOTICE, promotionTarget, type Promotion } from "@/lib/promotions";

/**
 * Carte d'une promotion (site public et aperçu de l'administration). Les prix et le pourcentage affichés sont ceux SAISIS dans la
 * promotion ; la mention d'information est toujours présente dès qu'un prix ou une réduction est montré. Le bouton mène à la prestation
 * (ou à sa réservation), au produit, ou n'existe pas pour une simple annonce : il n'applique aucune remise.
 * `actions` = false : aperçu (administration) — ni boutons, ni suivi.
 * Suivi anonyme (voir lib/promotion-tracking.ts) : une impression quand la carte est visible à 50 % pendant 1 s, un clic sur l'image, le titre ou
 * un bouton ; l'identifiant de la promotion suit la navigation (?promo=) jusqu'à la réservation.
 */
export function PromotionCard({ promotion: p, actions = true }: { promotion: Promotion; actions?: boolean }) {
  const pct = discountPercent(p);
  const period = periodLabel(p);
  const target = promotionTarget(p);
  const priced = p.kind !== "announcement";
  const impressionRef = usePromotionImpression(actions ? p.id : "");
  const click = () => { void trackPromotion("click", p.id); };

  const head = (
    <>
      <div className="relative h-40">
        <Img sizes="448px" src={p.imageUrl ?? undefined} alt="" className="h-full w-full object-cover" />
        {pct !== null && <span className="absolute right-3 top-3 rounded-full bg-gold-deep px-3 py-1 text-sm font-semibold text-white" aria-label={`Réduction annoncée : ${pct} pour cent`}>-{pct}%</span>}
      </div>
      <h2 className="px-4 pt-4 text-xl text-deep">{p.title}</h2>
    </>
  );
  // L'image et le titre mènent à la cible quand il y en a une (bannière cliquable) ; sinon ils restent un simple visuel.
  const banner: ReactNode = !actions || !target ? head
    : target.kind === "service" ? <Link to="/prestations/$serviceId" params={{ serviceId: target.id }} search={{ promo: p.id }} onClick={click} className="block">{head}</Link>
    : <Link to="/boutique/$productId" params={{ productId: target.id }} search={{ promo: p.id }} onClick={click} className="block">{head}</Link>;

  return (
    <article ref={actions ? impressionRef : undefined} className="overflow-hidden rounded-2xl border bg-card shadow-soft" data-testid="promotion">
      {banner}
      <div className="px-4 pb-4">
        {p.description && <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{p.description}</p>}
        {period && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5 text-gold-deep" aria-hidden />{period}</p>}
        {p.kind === "price" && p.originalPrice !== null && p.promoPrice !== null && (
          <p className="mt-2 text-sm">
            <span className="sr-only">Prix initial annoncé : </span><s className="text-muted-foreground">{formatFCFA(p.originalPrice)}</s>{" "}
            <span className="sr-only">Prix promotionnel annoncé : </span><b className="text-gold-deep">{formatFCFA(p.promoPrice)}</b>
          </p>
        )}
        {p.kind === "percent" && p.percentOff !== null && (
          <p className="mt-2 text-sm">
            <span className="font-semibold text-gold-deep">Réduction annoncée : -{p.percentOff}%</span>
            {p.originalPrice !== null && <span className="ml-2 text-muted-foreground">Prix de référence annoncé : <s>{formatFCFA(p.originalPrice)}</s></span>}
          </p>
        )}
        {priced && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{PROMO_NOTICE}</p>}
        {actions && target?.kind === "service" && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link to="/prestations/$serviceId" params={{ serviceId: target.id }} search={{ promo: p.id }} onClick={click} className="btn btn-app-outline">Voir la prestation</Link>
            <Link to="/reservation" search={{ service: target.id, promo: p.id }} onClick={click} className="btn btn-app">Réserver</Link>
          </div>
        )}
        {actions && target?.kind === "product" && (
          <Link to="/boutique/$productId" params={{ productId: target.id }} search={{ promo: p.id }} onClick={click} className="btn btn-app mt-3 w-full">Voir le produit</Link>
        )}
      </div>
    </article>
  );
}
