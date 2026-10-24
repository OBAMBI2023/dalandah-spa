import { useSyncExternalStore } from "react";
import { settings } from "@/data/settings";

// Stockage local provisoire : même interface qu'aura le backend (Supabase).
// L'anti-doublon ne protège donc que cet appareil tant que le backend n'est pas branché.
export type Booking = {
  ref: string; serviceId: string; serviceName: string; duration: string; price: number;
  date: string; // YYYY-MM-DD
  slot: string; // HH:mm
  name: string; phone: string; comment: string;
  status: "confirmed" | "cancelled"; createdAt: string;
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

export function saveProfile(p: Profile) {
  try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch { return; }
  emit();
}

export const isUpcoming = (b: Booking, now = new Date()) =>
  b.status === "confirmed" && new Date(`${b.date}T${b.slot}:00`) >= now;

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
