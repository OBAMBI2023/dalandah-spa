import type { AdminBooking } from "@/lib/admin-api";

// Indicateurs commerciaux du tableau de bord, calculés sur les réservations lues (AdminBooking, au plus BOOKINGS_LIMIT).
//
// DÉFINITIONS (aucun encaissement n'est enregistré dans la base) :
//  - « chiffre d'affaires » = somme des prix des réservations CONFIRMÉES, au prix enregistré lors de la réservation, rattachées à la DATE DU
//    RENDEZ-VOUS. C'est un chiffre d'affaires réservé (prévisionnel pour les dates à venir), pas un montant encaissé : la base ne connaît pas les paiements.
//  - Les réservations annulées ne comptent jamais dans le chiffre d'affaires.
//  - Dates : « AAAA-MM-JJ » du salon (Abidjan, UTC+0), manipulées en UTC pour éviter tout décalage de fuseau.

const DAY = 864e5;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => iso(ms(d) + n * DAY);
export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
/** Premier jour du mois précédent. */
export const prevMonthStart = (d: string) => { const t = new Date(ms(monthStart(d))); t.setUTCMonth(t.getUTCMonth() - 1); return iso(t.getTime()); };
const daysInMonth = (monthFirst: string) => { const t = new Date(ms(monthFirst)); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); };

const confirmed = (rows: readonly AdminBooking[]) => rows.filter((b) => b.status === "confirmed");

/** Chiffre d'affaires des réservations confirmées dont le rendez-vous tombe entre `from` et `to` inclus. */
export function revenue(rows: readonly AdminBooking[], from: string, to: string): number {
  return confirmed(rows).filter((b) => b.date >= from && b.date <= to).reduce((s, b) => s + b.price, 0);
}

/**
 * Cumul du mois en cours (du 1er à aujourd'hui) et du MÊME intervalle du mois précédent (du 1er au même quantième, plafonné à la fin de ce mois) :
 * la comparaison porte sur des périodes de même durée.
 */
export function monthToDate(rows: readonly AdminBooking[], today: string) {
  const start = monthStart(today), prevStart = prevMonthStart(today);
  const day = Number(today.slice(8, 10));
  const prevEnd = addDays(prevStart, Math.min(day, daysInMonth(prevStart)) - 1);
  return { current: revenue(rows, start, today), previous: revenue(rows, prevStart, prevEnd), start, prevStart, prevEnd };
}

export type Trend = { direction: "up" | "down" | "flat" | "new" | "none"; percent: number | null };

/** Évolution `current` par rapport à `previous` : pas de pourcentage inventé quand la base de comparaison est nulle. */
export function trend(current: number, previous: number): Trend {
  if (previous === 0) return current === 0 ? { direction: "none", percent: null } : { direction: "new", percent: null };
  const percent = Math.round(((current - previous) / previous) * 1000) / 10;
  return { direction: percent > 0 ? "up" : percent < 0 ? "down" : "flat", percent };
}

export type DayPoint = { date: string; revenue: number; bookings: number };

/** Les `days` derniers jours jusqu'à `today` inclus : chiffre d'affaires et nombre de réservations confirmées par jour. */
export function dailySeries(rows: readonly AdminBooking[], today: string, days = 14): DayPoint[] {
  const ok = confirmed(rows);
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i - (days - 1));
    const day = ok.filter((b) => b.date === date);
    return { date, revenue: day.reduce((s, b) => s + b.price, 0), bookings: day.length };
  });
}

export type ServiceStat = { name: string; revenue: number; bookings: number };

/** Prestations classées par chiffre d'affaires (réservations confirmées). */
export function topServices(rows: readonly AdminBooking[], limit = 5): ServiceStat[] {
  const by = new Map<string, ServiceStat>();
  for (const b of confirmed(rows)) {
    const s = by.get(b.serviceName) ?? { name: b.serviceName, revenue: 0, bookings: 0 };
    s.revenue += b.price; s.bookings += 1;
    by.set(b.serviceName, s);
  }
  return [...by.values()].sort((a, b) => b.revenue - a.revenue || b.bookings - a.bookings || a.name.localeCompare(b.name, "fr")).slice(0, limit);
}

/** Panier moyen : chiffre d'affaires ÷ réservations confirmées ; null sans réservation confirmée. */
export function averageBasket(rows: readonly AdminBooking[]): number | null {
  const ok = confirmed(rows);
  return ok.length ? Math.round(ok.reduce((s, b) => s + b.price, 0) / ok.length) : null;
}

/** Taux d'annulation en % (une décimale) ; null sans réservation. */
export function cancellationRate(rows: readonly AdminBooking[]): number | null {
  return rows.length ? Math.round((rows.filter((b) => b.status === "cancelled").length / rows.length) * 1000) / 10 : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Période sélectionnée, série du graphique, répartition par catégorie, prestations les plus réservées, nouveaux clients.
// Tous les montants restent des MONTANTS ESTIMÉS des réservations confirmées (voir plus haut) : la base ne contient aucun paiement.

export type PeriodId = "7d" | "30d" | "month" | "quarter" | "year";
export const PERIODS: { id: PeriodId; label: string; sub: string }[] = [
  { id: "7d", label: "7 derniers jours", sub: "7 derniers jours" },
  { id: "30d", label: "30 derniers jours", sub: "30 derniers jours" },
  { id: "month", label: "Ce mois", sub: "ce mois" },
  { id: "quarter", label: "Ce trimestre", sub: "ce trimestre" },
  { id: "year", label: "Cette année", sub: "cette année" },
];

export type Range = { from: string; to: string };

const lastDayOfMonth = (first: string) => { const t = new Date(ms(first)); return iso(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)); };
const addMonths = (first: string, n: number) => { const t = new Date(ms(first)); t.setUTCMonth(t.getUTCMonth() + n); return iso(t.getTime()); };
const quarterStart = (d: string) => `${d.slice(0, 4)}-${String(Math.floor((Number(d.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
const diffDays = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);

/**
 * Période choisie (jusqu'à aujourd'hui inclus) et période PRÉCÉDENTE de même durée :
 * 7 / 30 jours glissants ; mois, trimestre et année en cours comparés au début du mois / trimestre / année précédent, sur le même nombre de jours.
 */
export function periodRanges(period: PeriodId, today: string): { current: Range; previous: Range } {
  if (period === "7d" || period === "30d") {
    const n = period === "7d" ? 7 : 30;
    return { current: { from: addDays(today, 1 - n), to: today }, previous: { from: addDays(today, 1 - 2 * n), to: addDays(today, -n) } };
  }
  const start = period === "month" ? monthStart(today) : period === "quarter" ? quarterStart(today) : `${today.slice(0, 4)}-01-01`;
  const prevStart = period === "month" ? prevMonthStart(today) : period === "quarter" ? addMonths(start, -3) : `${Number(today.slice(0, 4)) - 1}-01-01`;
  const prevEndMax = period === "month" ? lastDayOfMonth(prevStart) : period === "quarter" ? addDays(start, -1) : `${Number(today.slice(0, 4)) - 1}-12-31`;
  const span = diffDays(start, today);
  const prevEnd = addDays(prevStart, span) > prevEndMax ? prevEndMax : addDays(prevStart, span);
  return { current: { from: start, to: today }, previous: { from: prevStart, to: prevEnd } };
}

export type SeriesPoint = { key: string; from: string; to: string; revenue: number; bookings: number };
export type Granularity = "day" | "week" | "month";

/** Jour pour 7 jours, 30 jours et le mois ; semaine (blocs de 7 jours) pour le trimestre ; mois pour l'année. */
export const granularity = (period: PeriodId): Granularity => (period === "quarter" ? "week" : period === "year" ? "month" : "day");

/** Série du graphique : un point par jour, par bloc de 7 jours ou par mois, de `range.from` à `range.to`, zéros compris. */
export function revenueSeries(rows: readonly AdminBooking[], range: Range, g: Granularity): SeriesPoint[] {
  const ok = confirmed(rows).filter((b) => b.date >= range.from && b.date <= range.to);
  const buckets: { from: string; to: string }[] = [];
  if (g === "day") for (let d = range.from; d <= range.to; d = addDays(d, 1)) buckets.push({ from: d, to: d });
  else if (g === "week") for (let d = range.from; d <= range.to; d = addDays(d, 7)) buckets.push({ from: d, to: addDays(d, 6) > range.to ? range.to : addDays(d, 6) });
  else for (let d = monthStart(range.from); d <= range.to; d = addMonths(d, 1)) buckets.push({ from: d < range.from ? range.from : d, to: lastDayOfMonth(d) > range.to ? range.to : lastDayOfMonth(d) });
  return buckets.map(({ from, to }) => {
    const inB = ok.filter((b) => b.date >= from && b.date <= to);
    return { key: from, from, to, revenue: inB.reduce((s, b) => s + b.price, 0), bookings: inB.length };
  });
}

export type CategoryShare = { id: string; label: string; revenue: number; bookings: number; percent: number };

/**
 * Répartition du chiffre d'affaires estimé par CATÉGORIE de prestation. Le rattachement passe par l'identifiant de la prestation réservée
 * (bookings.service_id -> services.category) ; une réservation dont la prestation est inconnue va dans « Autres ». Aucun pourcentage inventé :
 * liste vide quand le total est nul.
 */
export function categoryBreakdown(
  rows: readonly AdminBooking[], range: Range, categoryOf: (serviceId: string | undefined) => { id: string; label: string },
): CategoryShare[] {
  const ok = confirmed(rows).filter((b) => b.date >= range.from && b.date <= range.to);
  const by = new Map<string, Omit<CategoryShare, "percent">>();
  for (const b of ok) {
    const c = categoryOf(b.serviceId);
    const e = by.get(c.id) ?? { id: c.id, label: c.label, revenue: 0, bookings: 0 };
    e.revenue += b.price; e.bookings += 1;
    by.set(c.id, e);
  }
  const total = [...by.values()].reduce((s, e) => s + e.revenue, 0);
  if (total === 0) return [];
  return [...by.values()].sort((a, b) => b.revenue - a.revenue || a.label.localeCompare(b.label, "fr"))
    .map((e) => ({ ...e, percent: Math.round((e.revenue / total) * 1000) / 10 }));
}

export type SoldService = { key: string; name: string; serviceId: string | undefined; bookings: number; percent: number };

/**
 * Prestations les plus RÉSERVÉES de la période (réservations confirmées). Ce nombre de réservations n'est pas un nombre de prestations payées ou
 * réalisées : la base n'enregistre ni paiement ni réalisation. Le pourcentage est la part des réservations confirmées de la période.
 */
export function topBooked(rows: readonly AdminBooking[], range: Range, limit = 5): SoldService[] {
  const ok = confirmed(rows).filter((b) => b.date >= range.from && b.date <= range.to);
  const by = new Map<string, SoldService>();
  for (const b of ok) {
    const key = b.serviceId ?? `nom:${b.serviceName}`;
    const e = by.get(key) ?? { key, name: b.serviceName, serviceId: b.serviceId, bookings: 0, percent: 0 };
    e.bookings += 1;
    by.set(key, e);
  }
  return [...by.values()].sort((a, b) => b.bookings - a.bookings || a.name.localeCompare(b.name, "fr")).slice(0, limit)
    .map((e) => ({ ...e, percent: Math.round((e.bookings / ok.length) * 1000) / 10 }));
}

/**
 * Nouveaux clients du mois : clients (numéro normalisé) dont la PREMIÈRE réservation lue a été enregistrée ce mois-ci. Calculé sur les réservations
 * chargées (BOOKINGS_LIMIT au plus) : un client plus ancien dont les premières réservations ne sont pas chargées pourrait être compté à tort.
 */
export function newClientsThisMonth(rows: readonly AdminBooking[], today: string): number {
  const first = new Map<string, string>();
  for (const b of rows) { const c = first.get(b.phoneKey); if (c === undefined || b.createdAt < c) first.set(b.phoneKey, b.createdAt); }
  const prefix = today.slice(0, 7);
  return [...first.values()].filter((c) => c.slice(0, 7) === prefix).length;
}
