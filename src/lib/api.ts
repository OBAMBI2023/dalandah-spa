import { serviceCategories, services as localServices, type Service, type ServiceCategory, type ServiceCategoryInfo } from "@/data/services";
import { sessionKey } from "@/lib/promotion-tracking";
import { buildCategories, CATEGORY_COLUMNS } from "@/lib/service-categories";
import { settings } from "@/data/settings";
import {
  abidjanToday, bookedSlots, cancelBooking as cancelLocal, createBooking as createLocal, getBookings,
  saveBooking, startsAtMs, updateBooking, type Booking,
} from "@/lib/bookings";
import { supabase } from "@/lib/supabase";

// Couche d'accès aux données de réservation.
//  - Avec Supabase : catalogue, créneaux, réservation, consultation et annulation passent par les tables et fonctions
//    de supabase/migrations (le serveur est la source de vérité : prix, durée, préavis, doublons, limites).
//  - Sans Supabase : mode local (données du code + carnet local), pour développer et démontrer.
// Les erreurs « métier » sont renvoyées sous forme { ok: false, code, error } ; ne jamais lever pour un refus normal.

export type ApiFailure = { ok: false; code: string; error: string };
export type Rules = { minNoticeHours: number; cancelNoticeHours: number; maxDaysAhead: number; maxActivePerPhone: number };
export type Catalogue = { services: Service[]; categories: ServiceCategoryInfo[]; timeSlots: string[]; rules: Rules; source: "supabase" | "local" };
export type SlotAvailability = { slot: string; available: boolean };
/** `promotionId` : promotion d'où vient le visiteur (?promo=), pour le suivi. Elle n'a AUCUN effet sur le prix ni sur la réservation elle-même. */
export type BookingInput = { service: Service; date: string; slot: string; name: string; phone: string; comment: string; promotionId?: string | undefined };

/** Délai maximal d'une tentative d'attribution (elle s'exécute en arrière-plan, après la confirmation). */
export const ATTRIBUTION_TIMEOUT_MS = 8000;

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("délai dépassé")), ms);
    Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export const defaultRules: Rules = { minNoticeHours: 2, cancelNoticeHours: 2, maxDaysAhead: 180, maxActivePerPhone: 3 };
export const localCatalogue: Catalogue = { services: localServices, categories: serviceCategories, timeSlots: settings.timeSlots, rules: defaultRules, source: "local" };

/** Sous-ensemble du client Supabase utilisé ici (permet de brancher un faux client dans les tests). */
export type DataClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => {
    select: (columns: string) => {
      order: (column: string) => { limit?: unknown } & PromiseLike<{ data: unknown; error: { message: string } | null }>;
    } & PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
};

const NETWORK: ApiFailure = { ok: false, code: "network", error: "Connexion impossible. Vérifiez votre réseau et réessayez." };
const SERVER: ApiFailure = { ok: false, code: "server_error", error: "Service momentanément indisponible. Réessayez dans un instant." };
const hhmm = (v: unknown) => String(v).slice(0, 5);
const hours = (h: number) => h * 3600_000;

type ServiceRow = { id: string; name: string; category: ServiceCategory; description: string; duration_label: string; price_fcfa: number; image_url: string | null; active?: boolean };

export function createApi(client: DataClient | null) {
  const remote = client !== null;

  /** Appelle une fonction SQL ; null si le réseau ou le serveur échoue. */
  async function rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown } | ApiFailure> {
    try {
      const { data, error } = await client!.rpc(fn, args);
      return error ? SERVER : { data };
    } catch {
      return NETWORK;
    }
  }
  const failure = (d: unknown): ApiFailure => {
    const o = (d ?? {}) as { code?: string; error?: string };
    return { ok: false, code: o.code ?? "server_error", error: o.error ?? SERVER.error };
  };

  const api = {
    remote,

    /** Catalogue, grille de créneaux et règles du salon. Lève une erreur si le serveur est injoignable (react-query réessaie). */
    async fetchCatalogue(): Promise<Catalogue> {
      if (!client) return localCatalogue;
      const [s, t, r, c] = await Promise.all([
        client.from("services").select("id,name,category,description,duration_label,price_fcfa,image_url,sort_order,active").order("sort_order"),
        client.from("time_slots").select("slot").order("slot"),
        client.from("salon_settings").select("min_notice_hours,cancel_notice_hours,max_days_ahead,max_active_bookings_per_phone"),
        // Catégories : une erreur (table pas encore créée, réseau) ne bloque JAMAIS le catalogue ; les catégories du code servent alors de repli.
        Promise.resolve(client.from("service_categories").select(CATEGORY_COLUMNS).order("sort_order")).catch(() => ({ data: null, error: true })),
      ]);
      if (s.error || t.error || r.error) throw new Error("catalogue indisponible");
      const row = ((r.data as Record<string, number>[]) ?? [])[0];
      // Le site public ne montre QUE les prestations actives, quel que soit le compte connecté : un administrateur lit aussi les inactives
      // (politique « admin services »), qui ne doivent ni apparaître dans les listes ni faire apparaître une catégorie.
      const rows = ((s.data as ServiceRow[]) ?? []).filter((x) => x.active !== false);
      return {
        source: "supabase",
        categories: buildCategories((c as { error?: unknown; data?: unknown }).error ? null : (c as { data?: unknown }).data, rows.map((x) => x.category)),
        services: rows.map((x) => ({
          id: x.id, name: x.name, category: x.category, description: x.description,
          duration: x.duration_label, price: x.price_fcfa,
          // Photo téléversée par l'administrateur en priorité ; sinon la photo locale de même identifiant (image par défaut).
          image: x.image_url || (localServices.find((l) => l.id === x.id)?.image ?? ""),
        })),
        timeSlots: ((t.data as { slot: string }[]) ?? []).map((x) => hhmm(x.slot)),
        rules: row ? {
          minNoticeHours: row.min_notice_hours ?? defaultRules.minNoticeHours,
          cancelNoticeHours: row.cancel_notice_hours ?? defaultRules.cancelNoticeHours,
          maxDaysAhead: row.max_days_ahead ?? defaultRules.maxDaysAhead,
          maxActivePerPhone: row.max_active_bookings_per_phone ?? defaultRules.maxActivePerPhone,
        } : defaultRules,
      };
    },

    /** Créneaux du jour pour un soin : tient compte de sa durée, du préavis et des rendez-vous déjà pris. */
    async getAvailability(date: string, service: Service): Promise<SlotAvailability[]> {
      if (!client) {
        const taken = bookedSlots(getBookings(), date);
        const limit = Date.now() + hours(defaultRules.minNoticeHours);
        const last = Date.parse(`${abidjanToday()}T00:00:00Z`) + defaultRules.maxDaysAhead * 864e5;
        return settings.timeSlots.map((slot) => ({
          slot,
          available: !taken.includes(slot) && startsAtMs({ date, slot }) >= limit && Date.parse(`${date}T00:00:00Z`) <= last,
        }));
      }
      const res = await rpc("get_availability", { p_date: date, p_service_id: service.id });
      if ("ok" in res) throw new Error(res.error);
      return ((res.data as SlotAvailability[]) ?? []).map((x) => ({ slot: hhmm(x.slot), available: x.available === true }));
    },

    /** Réserve un créneau. Le serveur recalcule nom du soin, durée et prix : seul l'identifiant du soin est envoyé. */
    async createBooking(input: BookingInput): Promise<{ ok: true; booking: Booking } | ApiFailure> {
      const { service } = input;
      if (!client) {
        const r = createLocal({
          serviceId: service.id, serviceName: service.name, duration: service.duration, price: service.price,
          date: input.date, slot: input.slot, name: input.name.trim(), phone: input.phone.trim(), comment: input.comment.trim(),
        });
        return r.ok ? r : { ok: false, code: "slot_unavailable", error: r.error };
      }
      const res = await rpc("create_booking", {
        p_service_id: service.id, p_date: input.date, p_slot: input.slot,
        p_name: input.name.trim(), p_phone: input.phone.trim(), p_comment: input.comment.trim(),
      });
      if ("ok" in res) return res;
      const d = res.data as { ok?: boolean; ref?: string; ends?: string };
      if (!d?.ok || !d.ref) return failure(d);
      const booking: Booking = {
        ref: d.ref, serviceId: service.id, serviceName: service.name, duration: service.duration, price: service.price,
        date: input.date, slot: input.slot, name: input.name.trim(), phone: input.phone.trim(), comment: input.comment.trim(),
        status: "confirmed", createdAt: new Date().toISOString(), checkedAt: new Date().toISOString(),
        ...(d.ends ? { ends: hhmm(d.ends) } : {}),
      };
      saveBooking(booking);
      // Suivi : rattache la réservation (déjà créée) à la promotion d'origine. Appel séparé, lancé EN ARRIÈRE-PLAN et jamais attendu : la
      // confirmation s'affiche dès que la réservation existe, même si cet appel est lent ou ne se termine jamais. Il ne rappelle jamais create_booking.
      if (input.promotionId) void api.attributeToPromotion(d.ref, input.phone, input.promotionId).catch(() => false);
      // Le serveur est la source de vérité (prix, durée, nom du soin) : on aligne l'instantané local sur sa réponse.
      const synced = await api.refreshBooking(booking);
      return { ok: true, booking: synced.ok ? synced.booking : booking };
    },

    /**
     * Rattache une réservation existante à une promotion (attribute_booking_to_promotion). La base exige la référence ET le téléphone, un appel
     * moins de 30 minutes après la création, et un CLIC de cette session sur cette promotion dans les 24 heures précédant la réservation ; une seule
     * attribution par réservation. Ne modifie jamais la réservation. Au plus 2 tentatives (seulement après un échec de transport, jamais après un
     * refus de la base), chacune limitée à 8 s (ATTRIBUTION_TIMEOUT_MS). Ne lève jamais d'erreur ; ne rappelle jamais create_booking.
     */
    async attributeToPromotion(ref: string, phone: string, promotionId: string, session: string = sessionKey()): Promise<boolean> {
      if (!client) return false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await withTimeout(rpc("attribute_booking_to_promotion", { p_ref: ref, p_phone: phone.trim(), p_promotion_id: promotionId, p_session: session }), ATTRIBUTION_TIMEOUT_MS);
          if (!("ok" in res)) return (res.data as { ok?: boolean } | null)?.ok === true;
        } catch { /* ignoré (réseau, délai dépassé) : le suivi ne doit jamais gêner la réservation */ }
      }
      return false;
    },

    /** Annule un rendez-vous : le serveur exige la référence ET le téléphone, et refuse moins de N h avant. */
    async cancelBooking(b: Booking, rules: Rules = defaultRules): Promise<{ ok: true } | ApiFailure> {
      if (!client) {
        if (startsAtMs(b) < Date.now() + hours(rules.cancelNoticeHours)) {
          return { ok: false, code: "too_late", error: `Annulation impossible moins de ${rules.cancelNoticeHours} h avant le rendez-vous. Contactez le salon.` };
        }
        cancelLocal(b.ref);
        return { ok: true };
      }
      const res = await rpc("cancel_booking", { p_ref: b.ref, p_phone: b.phone });
      if ("ok" in res) return res;
      const d = res.data as { ok?: boolean; code?: string };
      if (d?.ok) { updateBooking(b.ref, { status: "cancelled", checkedAt: new Date().toISOString() }); return { ok: true }; }
      if (d?.code === "not_active") updateBooking(b.ref, { status: "cancelled", checkedAt: new Date().toISOString() });
      return failure(d);
    },

    /** Resynchronise le statut et l'horaire d'un rendez-vous avec le serveur (consultation par référence + téléphone). */
    async refreshBooking(b: Booking): Promise<{ ok: true; booking: Booking } | ApiFailure> {
      if (!client) return { ok: true, booking: b };
      const res = await rpc("get_booking", { p_ref: b.ref, p_phone: b.phone });
      if ("ok" in res) return res;
      const d = res.data as { ok?: boolean; booking?: { status: Booking["status"]; date: string; slot: string; ends: string; service_name: string; duration_label: string; price_fcfa: number } };
      if (!d?.ok || !d.booking) return failure(d);
      const patch: Partial<Booking> = {
        status: d.booking.status, date: String(d.booking.date).slice(0, 10), slot: hhmm(d.booking.slot),
        ends: hhmm(d.booking.ends), checkedAt: new Date().toISOString(),
        serviceName: d.booking.service_name, duration: d.booking.duration_label, price: d.booking.price_fcfa,
      };
      updateBooking(b.ref, patch);
      return { ok: true, booking: { ...b, ...patch } };
    },
  };
  return api;
}

export const api = createApi(supabase as unknown as DataClient | null);
