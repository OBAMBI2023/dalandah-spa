import { useSyncExternalStore } from "react";
import { settings } from "@/data/settings";

// Liste locale des réservations de cet appareil.
// - Sans Supabase configuré (mode local) : c'est la seule source, l'anti-doublon ne protège que cet appareil.
// - Avec Supabase (mode distant) : c'est un simple carnet de références {ref, téléphone, instantané} pour retrouver
//   ses rendez-vous d'invité ; la vérité (statut, créneau) est côté serveur, voir src/lib/api.ts.
export type Booking = {
  ref: string; serviceId: string; serviceName: string; duration: string; price: number;
  date: string; // YYYY-MM-DD, heure d'Abidjan
  slot: string; // HH:mm, heure d'Abidjan
  name: string; phone: string; comment: string;
  status: "confirmed" | "cancelled"; createdAt: string;
  ends?: string;      // HH:mm, fin réelle calculée par le serveur (durée opérationnelle)
  checkedAt?: string; // dernière synchronisation du statut avec le serveur (ISO)
};

export type Profile = { name: string; phone: string; email: string };

const KEY = "dalanda.bookings.v1";
const PKEY = "dalanda.profile.v1";
const listeners = new Set<() => void>();
const EMPTY: Booking[] = [];
const EMPTY_PROFILE: Profile = { name: "", phone: "", email: "" };
let cache: { raw: string | null; bookings: Booking[]; profile: Profile; praw: string | null } | null = null;

function read() {
  if (typeof window === "undefined") return { bookings: EMPTY, profile: EMPTY_PROFILE };
  let raw: string | null = null, praw: string | null = null;
  try { raw = localStorage.getItem(KEY); praw = localStorage.getItem(PKEY); } catch { /* stockage indisponible */ }
  if (cache && cache.raw === raw && cache.praw === praw) return cache;
  let bookings = EMPTY, profile = EMPTY_PROFILE;
  try { if (raw) bookings = JSON.parse(raw); } catch { /* données corrompues */ }
  try { if (praw) profile = { ...EMPTY_PROFILE, ...JSON.parse(praw) }; } catch { /* idem */ }
  cache = { raw, praw, bookings, profile };
  return cache;
}

function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => { listeners.delete(l); window.removeEventListener("storage", l); };
}

export const getBookings = () => read().bookings;
export const useBookings = () => useSyncExternalStore(subscribe, () => read().bookings, () => EMPTY);
export const useProfile = () => useSyncExternalStore(subscribe, () => read().profile, () => EMPTY_PROFILE);

export const bookedSlots = (bookings: Booking[], date: string) =>
  bookings.filter((b) => b.date === date && b.status === "confirmed").map((b) => b.slot);

export const newRef = () => `DLD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

export function createBooking(b: Omit<Booking, "ref" | "status" | "createdAt">): { ok: true; booking: Booking } | { ok: false; error: string } {
  if (!settings.timeSlots.includes(b.slot)) return { ok: false, error: "Créneau invalide." };
  const current = read().bookings;
  if (bookedSlots(current, b.date).includes(b.slot)) return { ok: false, error: "Ce créneau vient d'être réservé. Choisissez-en un autre." };
  const booking: Booking = { ...b, ref: newRef(), status: "confirmed", createdAt: new Date().toISOString() };
  try { localStorage.setItem(KEY, JSON.stringify([booking, ...current])); } catch { return { ok: false, error: "Enregistrement impossible sur cet appareil." }; }
  emit();
  return { ok: true, booking };
}

export function cancelBooking(ref: string) {
  const next = read().bookings.map((b) => (b.ref === ref ? { ...b, status: "cancelled" as const } : b));
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { return; }
  emit();
}

/** Ajoute (ou remplace) une réservation dans le carnet local : réservation confirmée par le serveur. */
export function saveBooking(booking: Booking) {
  const others = read().bookings.filter((b) => b.ref !== booking.ref);
  try { localStorage.setItem(KEY, JSON.stringify([booking, ...others])); } catch { return false; }
  emit();
  return true;
}

/** Met à jour des champs d'une réservation du carnet local (statut, dernière synchronisation…). */
export function updateBooking(ref: string, patch: Partial<Booking>) {
  const next = read().bookings.map((b) => (b.ref === ref ? { ...b, ...patch } : b));
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { return; }
  emit();
}

export function saveProfile(p: Profile) {
  try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch { return; }
  emit();
}

/** Date du jour à Abidjan (YYYY-MM-DD). Abidjan est en UTC+0 toute l'année : pas de conversion de fuseau à faire. */
export const abidjanToday = (now = new Date()) => now.toISOString().slice(0, 10);

// Les dates et heures des réservations sont en heure d'Abidjan (UTC+0) : on les compare donc en UTC,
// quel que soit le fuseau de l'appareil.
export const startsAtMs = (b: Pick<Booking, "date" | "slot">) => Date.parse(`${b.date}T${b.slot}:00Z`);
export const isUpcoming = (b: Booking, now = new Date()) =>
  b.status === "confirmed" && startsAtMs(b) >= now.getTime();

export const endTime = (slot: string, duration: string) => {
  const m = duration.match(/(\d+)\s*h/); const mn = duration.match(/(\d+)\s*min/);
  const total = Number(m?.[1] ?? 0) * 60 + Number(mn?.[1] ?? 0);
  const [h = 0, mi = 0] = slot.split(":").map(Number);
  const t = h * 60 + mi + total;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export const longDate = (iso: string) => {
  const s = new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
