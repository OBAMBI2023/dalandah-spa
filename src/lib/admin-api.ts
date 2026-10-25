import { adminSupabase } from "@/lib/supabase";
import { abidjanToday, startsAtMs } from "@/lib/bookings";

// Accès administrateur aux données. Les autorisations sont appliquées par la base (RLS + rôle `admin` dans `user_roles`) :
// un compte sans ce rôle ne reçoit aucune ligne, quoi que fasse l'interface. Ce module ne contourne jamais la RLS.

export type AdminBooking = {
  ref: string; name: string; phone: string; phoneKey: string; serviceName: string; date: string; slot: string;
  status: "confirmed" | "cancelled"; price: number; createdAt: string;
};
export type AdminService = {
  id: string; name: string; category: string; description: string; durationLabel: string; durationMin: number;
  price: number; active: boolean; isDemo: boolean; imageUrl: string | null;
};
export type AdminSettings = {
  timezone: string; minNoticeHours: number; cancelNoticeHours: number; maxDaysAhead: number; maxActivePerPhone: number;
  slots: { slot: string; active: boolean }[];
};
export type AdminClient = { key: string; name: string; phone: string; bookings: number; lastDate: string };

/** forbidden : non autorisé (RLS, droits) · network : serveur injoignable · server : toute autre erreur. */
export class AdminError extends Error {
  constructor(readonly code: "forbidden" | "network" | "server", message: string) { super(message); }
}

/** false : variables VITE_SUPABASE_* absentes, l'application est en mode local (pas de connexion à la base). */
export const adminConfigured = adminSupabase !== null;

export const BOOKINGS_LIMIT = 1000;

type Failure = { code?: string; message?: string; status?: number } | null;

/** Distingue refus d'autorisation, panne réseau et autre erreur : une erreur n'est jamais présentée comme « aucune donnée ». */
export function classify(error: NonNullable<Failure>, what: string): AdminError {
  const text = `${error.message ?? ""}`;
  if (error.code === "42501" || error.status === 401 || error.status === 403) return new AdminError("forbidden", "Accès refusé.");
  if (error.status === 0 || /failed to fetch|network|load failed/i.test(text)) return new AdminError("network", "Connexion impossible. Vérifiez votre réseau et réessayez.");
  return new AdminError("server", `${what} impossible.`);
}

function client() {
  if (!adminSupabase) throw new AdminError("server", "Base de données non configurée.");
  return adminSupabase;
}

/** Appelle la base ; toute exception (réseau coupé) devient une AdminError classée. */
async function run<T>(what: string, call: () => PromiseLike<{ data: T | null; error: Failure }>): Promise<T> {
  let res: { data: T | null; error: Failure };
  try {
    res = await call();
  } catch (e) {
    throw classify({ message: e instanceof Error ? e.message : "network" }, what);
  }
  if (res.error) throw classify(res.error, what);
  return res.data as T;
}

export async function adminEmail(): Promise<string | null> {
  if (!adminSupabase) return null;
  const { data } = await adminSupabase.auth.getSession();
  return data.session?.user.email ?? null;
}

export async function adminSignIn(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!adminSupabase) return { ok: false, error: "Base de données non configurée." };
  try {
    const { error } = await adminSupabase.auth.signInWithPassword({ email: email.trim(), password });
    // Message volontairement identique pour un mauvais e-mail ou un mauvais mot de passe.
    return error ? { ok: false, error: "E-mail ou mot de passe incorrect." } : { ok: true };
  } catch {
    return { ok: false, error: "Connexion impossible. Vérifiez votre réseau et réessayez." };
  }
}

export async function adminSignOut() {
  await adminSupabase?.auth.signOut();
}

/** Le compte connecté a-t-il le rôle `admin` ? (RLS : on ne lit que ses propres rôles.) */
export async function hasAdminRole(): Promise<boolean> {
  const rows = await run<{ role: string }[]>("Lecture des droits", () => client().from("user_roles").select("role"));
  return (rows ?? []).some((r) => r.role === "admin");
}

type BookingRow = {
  ref: string; name: string; phone: string; phone_key: string; service_name: string; date: string; slot: string;
  status: "confirmed" | "cancelled"; price_fcfa: number; created_at: string;
};

/** Réservations réelles, du rendez-vous le plus récent au plus ancien (BOOKINGS_LIMIT au maximum). */
export async function listAdminBookings(): Promise<AdminBooking[]> {
  const rows = await run<BookingRow[]>("Lecture des réservations", () =>
    client().from("bookings")
      .select("ref,name,phone,phone_key,service_name,date,slot,status,price_fcfa,created_at")
      .order("starts_at", { ascending: false })
      .limit(BOOKINGS_LIMIT));
  return (rows ?? []).map((r) => ({
    ref: r.ref, name: r.name, phone: r.phone, phoneKey: r.phone_key, serviceName: r.service_name,
    date: String(r.date).slice(0, 10), slot: String(r.slot).slice(0, 5), status: r.status, price: r.price_fcfa, createdAt: r.created_at,
  }));
}

type ServiceRow = {
  id: string; name: string; category: string; description: string; duration_label: string; duration_min: number;
  price_fcfa: number; active: boolean; is_demo: boolean; image_url: string | null;
};

/** Catalogue complet (actif ou non) : la politique « admin services » le permet à l'administrateur uniquement. */
export async function listAdminServices(): Promise<AdminService[]> {
  const rows = await run<ServiceRow[]>("Lecture des prestations", () =>
    client().from("services")
      .select("id,name,category,description,duration_label,duration_min,price_fcfa,active,is_demo,image_url")
      .order("sort_order"));
  return (rows ?? []).map((r) => ({
    id: r.id, name: r.name, category: r.category, description: r.description, durationLabel: r.duration_label,
    durationMin: r.duration_min, price: r.price_fcfa, active: r.active, isDemo: r.is_demo, imageUrl: r.image_url,
  }));
}

type SettingsRow = {
  timezone: string; min_notice_hours: number; cancel_notice_hours: number; max_days_ahead: number; max_active_bookings_per_phone: number;
};

export async function getAdminSettings(): Promise<AdminSettings> {
  const [s, t] = await Promise.all([
    run<SettingsRow[]>("Lecture des paramètres", () =>
      client().from("salon_settings").select("timezone,min_notice_hours,cancel_notice_hours,max_days_ahead,max_active_bookings_per_phone")),
    run<{ slot: string; active: boolean }[]>("Lecture des créneaux", () => client().from("time_slots").select("slot,active").order("slot")),
  ]);
  const row = (s ?? [])[0];
  if (!row) throw new AdminError("server", "Paramètres introuvables.");
  return {
    timezone: row.timezone, minNoticeHours: row.min_notice_hours, cancelNoticeHours: row.cancel_notice_hours,
    maxDaysAhead: row.max_days_ahead, maxActivePerPhone: row.max_active_bookings_per_phone,
    slots: (t ?? []).map((x) => ({ slot: String(x.slot).slice(0, 5), active: x.active })),
  };
}

// --- Calculs sur les réservations (purs, testés) ---

/** Réservations confirmées du jour (date d'Abidjan, UTC+0). */
export const bookingsToday = (rows: AdminBooking[], today = abidjanToday()) =>
  rows.filter((b) => b.status === "confirmed" && b.date === today);

/** Rendez-vous confirmés à venir, du plus proche au plus lointain. */
export const upcomingBookings = (rows: AdminBooking[], now = Date.now()) =>
  rows.filter((b) => b.status === "confirmed" && startsAtMs(b) >= now).sort((a, b) => startsAtMs(a) - startsAtMs(b));

/**
 * Clients : les réservations sont faites sans compte, la seule identité fiable est le numéro (clé normalisée par la base).
 * La table `profiles` n'est lisible que par chaque cliente pour elle-même : elle ne peut pas servir de fichier clients.
 */
export function clientsFromBookings(rows: AdminBooking[]): AdminClient[] {
  const byKey = new Map<string, AdminClient & { latest: string }>();
  for (const b of rows) {
    const c = byKey.get(b.phoneKey);
    const stamp = `${b.date}T${b.slot}`;
    if (!c) byKey.set(b.phoneKey, { key: b.phoneKey, name: b.name, phone: b.phone, bookings: b.status === "confirmed" ? 1 : 0, lastDate: b.date, latest: stamp });
    else {
      if (b.status === "confirmed") c.bookings += 1;
      if (stamp > c.latest) Object.assign(c, { name: b.name, phone: b.phone, lastDate: b.date, latest: stamp });
    }
  }
  return [...byKey.values()].map(({ latest: _latest, ...c }) => c).sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}
