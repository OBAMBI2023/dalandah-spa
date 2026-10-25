import { AdminError, classify } from "@/lib/admin-api";
import { adminSupabase } from "@/lib/supabase";

// Statistiques de suivi des promotions pour l'administration (migration 20261030000000_promotion_tracking.sql).
// Les chiffres viennent de admin_promotion_stats() (rôle admin vérifié par la base). Les réservations attribuées sont relues avec les droits
// administrateur existants (politiques RLS de bookings et de promotion_bookings) : rien n'est exposé aux visiteurs.

/** La fonction ou la table n'existent pas encore : la migration n'est pas appliquée à ce projet. */
export class TrackingNotInstalledError extends AdminError {
  constructor() {
    super("server", "Le suivi des promotions n'est pas encore installé dans la base : la migration 20261030000000_promotion_tracking.sql n'a pas été appliquée à ce projet.");
  }
}

export type PromotionStats = {
  promotionId: string;
  /** Visites uniques : une promotion visible à 50 % pendant 1 s, comptée une fois par session et par jour. */
  impressions: number;
  /** Clics uniques : une fois par session et par jour. */
  clicks: number;
  /** Parcours de réservation démarrés depuis la promotion (une fois par session et par jour). */
  bookingStarted: number;
  /** Réservations effectivement créées et rattachées à la promotion. */
  bookingsCreated: number;
  bookingsConfirmed: number;
  bookingsCancelled: number;
};

type Failure = { code?: string; message?: string; status?: number } | null;
const missing = (e: NonNullable<Failure>) =>
  e.code === "PGRST202" || e.code === "42883" || e.code === "42P01" || e.code === "PGRST205" || (e.status === 404 && /schema cache|does not exist|promotion/i.test(e.message ?? ""));

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/** Statistiques par identifiant de promotion. Lève TrackingNotInstalledError tant que la migration n'est pas appliquée. */
export async function getPromotionStats(): Promise<Record<string, PromotionStats>> {
  if (!adminSupabase) throw new AdminError("server", "Base de données non configurée.");
  let res: { data: unknown; error: Failure };
  try {
    res = (await adminSupabase.rpc("admin_promotion_stats")) as typeof res;
  } catch (e) {
    throw classify({ message: e instanceof Error ? e.message : "network" }, "Lecture des statistiques");
  }
  if (res.error) throw missing(res.error) ? new TrackingNotInstalledError() : classify(res.error, "Lecture des statistiques");
  const out: Record<string, PromotionStats> = {};
  for (const r of Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : []) {
    const id = String(r["promotion_id"] ?? "");
    if (!id) continue;
    out[id] = {
      promotionId: id, impressions: num(r["impressions"]), clicks: num(r["clicks"]), bookingStarted: num(r["booking_started"]),
      bookingsCreated: num(r["bookings_created"]), bookingsConfirmed: num(r["bookings_confirmed"]), bookingsCancelled: num(r["bookings_cancelled"]),
    };
  }
  return out;
}

/**
 * Taux de conversion = réservations créées attribuées ÷ clics uniques. Le dénominateur (clics) est toujours affiché à côté.
 * Rend null quand il n'y a aucun clic (aucune conversion calculable, jamais « 0 % » inventé).
 */
export function conversionRate(s: Pick<PromotionStats, "bookingsCreated" | "clicks"> | undefined): number | null {
  if (!s || s.clicks <= 0) return null;
  return Math.round((s.bookingsCreated / s.clicks) * 1000) / 10;
}

export const CONVERSION_DEFINITION = "Conversion = réservations créées attribuées ÷ clics uniques (une fois par session et par jour). Elle est vide tant qu'il n'y a aucun clic.";

export const TRACKING_LIMITS = [
  "Statistiques indicatives : elles peuvent être faussées. Quelqu'un qui change d'adresse IP peut gonfler les compteurs, et l'exclusion des administrateurs n'est pas absolue (un administrateur en navigation privée peut être compté).",
  "Une visite est une session de navigation (onglet), pas une personne : un même client sur un autre appareil ou navigateur compte à part.",
  "Une réservation n'est rattachée à une promotion que si la même session a cliqué sur cette promotion dans les 24 heures précédant la réservation, et si le rattachement est enregistré dans les 30 minutes suivant la création de la réservation. Un lien partagé sans clic sur la bannière n'est pas attribué ; la fenêtre de 24 heures court à partir du dernier clic reçu (au plus un par jour et par session).",
  "Les réservations antérieures au suivi ne sont pas attribuées. Les réservations « terminées » n'existent pas dans la base : seuls les statuts confirmée et annulée sont comptés.",
  "Les événements (impressions, clics, parcours démarrés) de plus de 400 jours sont supprimés : ces totaux portent sur 400 jours glissants. Les réservations attribuées sont conservées.",
];

export type AttributedBooking = {
  ref: string; name: string; phone: string; serviceName: string; date: string; slot: string;
  status: "confirmed" | "cancelled"; price: number; createdAt: string; attributedAt: string;
};

type AttributionRow = {
  created_at: string;
  bookings: { ref: string; name: string; phone: string; service_name: string; date: string; slot: string; status: "confirmed" | "cancelled"; price_fcfa: number; created_at: string } | null;
};

/** Réservations rattachées à une promotion (administrateurs seulement : la base filtre par RLS). */
export async function listPromotionBookings(promotionId: string): Promise<AttributedBooking[]> {
  if (!adminSupabase) throw new AdminError("server", "Base de données non configurée.");
  let res: { data: AttributionRow[] | null; error: Failure };
  try {
    res = (await adminSupabase
      .from("promotion_bookings")
      .select("created_at, bookings(ref,name,phone,service_name,date,slot,status,price_fcfa,created_at)")
      .eq("promotion_id", promotionId)
      .order("created_at", { ascending: false })) as unknown as typeof res;
  } catch (e) {
    throw classify({ message: e instanceof Error ? e.message : "network" }, "Lecture des réservations attribuées");
  }
  if (res.error) throw missing(res.error) ? new TrackingNotInstalledError() : classify(res.error, "Lecture des réservations attribuées");
  return (res.data ?? []).flatMap((r) => r.bookings ? [{
    ref: r.bookings.ref, name: r.bookings.name, phone: r.bookings.phone, serviceName: r.bookings.service_name,
    date: String(r.bookings.date).slice(0, 10), slot: String(r.bookings.slot).slice(0, 5), status: r.bookings.status,
    price: r.bookings.price_fcfa, createdAt: r.bookings.created_at, attributedAt: r.created_at,
  }] : []);
}
