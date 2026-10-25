import { Link } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { Img } from "@/components/app";
import { formatFCFA } from "@/lib/format";
import { discountPercent, periodLabel, PROMO_NOTICE, promotionTarget, type Promotion } from "@/lib/promotions";

/**
 * Carte d'une promotion (site public et aperçu de l'administration). Les prix et le pourcentage affichés sont ceux SAISIS dans la
 * promotion ; la mention d'information est toujours présente dès qu'un prix ou une réduction est montré. Le bouton mène à la prestation
 * (ou à sa réservation), au produit, ou n'existe pas pour une simple annonce : il n'applique aucune remise.
 */
export function PromotionCard({ promotion: p, actions = true }: { promotion: Promotion; actions?: boolean }) {
  const pct = discountPercent(p);
  const period = periodLabel(p);
  const target = promotionTarget(p);
  const priced = p.kind !== "announcement";
  return (
    <article className="overflow-hidden rounded-2xl border bg-card shadow-soft" data-testid="promotion">
      <div className="relative h-40">
        <Img sizes="448px" src={p.imageUrl ?? undefined} alt="" className="h-full w-full object-cover" />
        {pct !== null && <span className="absolute right-3 top-3 rounded-full bg-gold-deep px-3 py-1 text-sm font-semibold text-white" aria-label={`Réduction annoncée : ${pct} pour cent`}>-{pct}%</span>}
      </div>
      <div className="p-4">
        <h2 className="text-xl text-deep">{p.title}</h2>
        {p.description && <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{p.description}</p>}
        {period && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5 text-gold-deep" aria-hidden />{period}</p>}
        {p.kind === "price" && p.originalPrice !== null && p.promoPrice !== null && (
          <p className="mt-2 text-sm">
            <span className="sr-only">Prix initial annoncé : </span><s className="text-muted-foreground">{formatFCFA(p.originalPrice)}</s>{" "}
            <span className="sr-only">Prix promotionnel annoncé : </span><b className="text-gold-deep">{formatFCFA(p.promoPrice)}</b>
          </p>
        )}
        {p.kind === "percent" && p.percentOff !== null && <p className="mt-2 text-sm font-semibold text-gold-deep">Réduction annoncée : -{p.percentOff}%</p>}
        {priced && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{PROMO_NOTICE}</p>}
        {actions && target?.kind === "service" && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link to="/prestations/$serviceId" params={{ serviceId: target.id }} className="btn btn-app-outline">Voir la prestation</Link>
            <Link to="/reservation" search={{ service: target.id }} className="btn btn-app">Réserver</Link>
          </div>
        )}
        {actions && target?.kind === "product" && (
          <Link to="/boutique/$productId" params={{ productId: target.id }} className="btn btn-app mt-3 w-full">Voir le produit</Link>
        )}
      </div>
    </article>
  );
}
