import { useQuery } from "@tanstack/react-query";
import { abidjanToday } from "@/lib/bookings";
import { supabase } from "@/lib/supabase";

// Promotions : annonces INFORMATIVES (migration 20261029000000_promotions.sql).
// Une promotion ne modifie jamais le prix d'une prestation ou d'un produit ni le montant d'une réservation ou d'un achat : les prix et
// pourcentages affichés sont ceux SAISIS dans la promotion, jamais recalculés depuis les tarifs en base.

export type PromotionKind = "price" | "percent" | "announcement";
/** Publication choisie par l'administrateur. */
export type PromotionPublication = "draft" | "published" | "disabled";
/** Statut AFFICHÉ, calculé à partir de la publication et des dates (jamais enregistré). */
export type PromotionStatus = "draft" | "scheduled" | "active" | "expired" | "disabled";

export type Promotion = {
  id: string; title: string; description: string; imageUrl: string | null; kind: PromotionKind;
  originalPrice: number | null; promoPrice: number | null; percentOff: number | null;
  startsOn: string | null; endsOn: string | null; publication: PromotionPublication;
  serviceId: string | null; productId: string | null; deletedAt: string | null; createdAt: string; updatedAt: string;
};

/** Ligne de public.promotions. */
export type PromotionRow = {
  id: string; title: string; description: string | null; image_url: string | null; kind: PromotionKind;
  original_price_fcfa: number | null; promo_price_fcfa: number | null; percent_off: number | null;
  starts_on: string | null; ends_on: string | null; status: PromotionPublication;
  service_id: string | null; product_id: string | null; deleted_at: string | null; created_at: string; updated_at: string;
};

export const PROMOTION_COLUMNS =
  "id,title,description,image_url,kind,original_price_fcfa,promo_price_fcfa,percent_off,starts_on,ends_on,status,service_id,product_id,deleted_at,created_at,updated_at";

/** Mention à afficher chaque fois qu’un prix ou une réduction est montré. */
export const PROMO_NOTICE = "Annonce promotionnelle : le prix indiqué n’est pas appliqué automatiquement à la réservation ni à l’achat. Le tarif est confirmé par l’établissement.";

export const KIND_LABELS: Record<PromotionKind, string> = { price: "Prix promotionnel", percent: "Pourcentage de réduction", announcement: "Simple annonce" };

export const STATUS_LABELS: Record<PromotionStatus, string> = { draft: "Brouillon", scheduled: "Programmée", active: "Active", expired: "Expirée", disabled: "Désactivée" };

export function fromRow(r: PromotionRow): Promotion {
  return {
    id: r.id, title: r.title, description: r.description ?? "", imageUrl: r.image_url, kind: r.kind,
    originalPrice: r.original_price_fcfa, promoPrice: r.promo_price_fcfa, percentOff: r.percent_off,
    startsOn: r.starts_on, endsOn: r.ends_on, publication: r.status,
    serviceId: r.service_id, productId: r.product_id, deletedAt: r.deleted_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/**
 * Statut affiché. Dates au format AAAA-MM-JJ (fin incluse) ; Abidjan est à UTC+0 toute l’année. Une promotion sans date de début est
 * « commencée », sans date de fin elle « ne finit pas ». Une promotion publiée hors de sa période n’est JAMAIS active.
 */
export function promotionStatus(p: Pick<Promotion, "publication" | "startsOn" | "endsOn">, today = abidjanToday()): PromotionStatus {
  if (p.publication === "draft") return "draft";
  if (p.publication === "disabled") return "disabled";
  if (p.startsOn && p.startsOn > today) return "scheduled";
  if (p.endsOn && p.endsOn < today) return "expired";
  return "active";
}

/** Visible par le public : active, non supprimée. (Un administrateur lit aussi les autres : le filtre se fait donc toujours ici.) */
export const isPublic = (p: Promotion, today = abidjanToday()) => p.deletedAt === null && promotionStatus(p, today) === "active";

/** Réduction annoncée en % : saisie (type pourcentage) ou calculée à partir des DEUX prix annoncés (type prix) ; null si non applicable. */
export function discountPercent(p: Pick<Promotion, "kind" | "originalPrice" | "promoPrice" | "percentOff">): number | null {
  if (p.kind === "percent") return p.percentOff;
  if (p.kind === "price" && p.originalPrice && p.promoPrice !== null && p.promoPrice < p.originalPrice) {
    const pct = Math.round((1 - p.promoPrice / p.originalPrice) * 100);
    return pct >= 1 ? pct : null;
  }
  return null;
}

/** Cible du bouton d’action : prestation, produit ou rien (simple annonce). */
export function promotionTarget(p: Pick<Promotion, "serviceId" | "productId">): { kind: "service" | "product"; id: string } | null {
  if (p.serviceId) return { kind: "service", id: p.serviceId };
  if (p.productId) return { kind: "product", id: p.productId };
  return null;
}

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export const formatPromoDate = (iso: string) => DATE_FORMAT.format(new Date(`${iso}T00:00:00Z`));

/** Période en toutes lettres, ou null si la promotion n’a aucune date. */
export function periodLabel(p: Pick<Promotion, "startsOn" | "endsOn">): string | null {
  if (p.startsOn && p.endsOn) return p.startsOn === p.endsOn ? `Le ${formatPromoDate(p.startsOn)}` : `Du ${formatPromoDate(p.startsOn)} au ${formatPromoDate(p.endsOn)}`;
  if (p.startsOn) return `À partir du ${formatPromoDate(p.startsOn)}`;
  if (p.endsOn) return `Jusqu’au ${formatPromoDate(p.endsOn)}`;
  return null;
}

// --- Lecture publique ---

type Failure = { code?: string; message?: string; status?: number } | null;

/** La table n’existe pas encore : la migration n’est pas appliquée à ce projet. */
export const isMissingTable = (e: NonNullable<Failure>) =>
  e.code === "42P01" || e.code === "PGRST205" || (e.status === 404 && /schema cache|does not exist|promotions/i.test(e.message ?? ""));

/**
 * Promotions visibles par le public, de la plus récente à la plus ancienne. Migration non appliquée : liste vide (aucune erreur).
 * Toute autre erreur est levée. Sans Supabase (mode local) : liste vide.
 */
export async function fetchPublicPromotions(today = abidjanToday()): Promise<Promotion[]> {
  if (!supabase) return [];
  const res = (await supabase.from("promotions").select(PROMOTION_COLUMNS).order("created_at", { ascending: false })) as { data: PromotionRow[] | null; error: Failure };
  if (res.error) {
    if (isMissingTable(res.error)) return [];
    throw new Error("Promotions indisponibles.");
  }
  return (res.data ?? []).map(fromRow).filter((p) => isPublic(p, today));
}

export const PROMOTIONS_KEY = ["promotions"] as const;

export function usePromotions() {
  return useQuery({ queryKey: PROMOTIONS_KEY, queryFn: () => fetchPublicPromotions(), staleTime: 60_000, retry: 1 });
}
