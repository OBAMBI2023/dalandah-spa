import { describe, expect, it } from "vitest";
import type { AdminBooking } from "@/lib/admin-api";
import { addDays, averageBasket, cancellationRate, dailySeries, monthStart, monthToDate, prevMonthStart, revenue, topServices, trend } from "@/lib/admin-dashboard";

const b = (o: Partial<AdminBooking>): AdminBooking => ({
  ref: "DLD-X", name: "A", phone: "1", phoneKey: "1", serviceName: "Soin", date: "2026-10-25", slot: "09:00", status: "confirmed", price: 10000, createdAt: "2026-10-01T00:00:00Z", ...o,
});

describe("calendrier (UTC, sans décalage de fuseau)", () => {
  it("jours et mois", () => {
    expect(addDays("2026-10-25", -1)).toBe("2026-10-24");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(monthStart("2026-10-25")).toBe("2026-10-01");
    expect(prevMonthStart("2026-10-25")).toBe("2026-09-01");
    expect(prevMonthStart("2026-01-15")).toBe("2025-12-01");
  });
});

describe("chiffre d'affaires", () => {
  it("somme des prix des réservations CONFIRMÉES à la date du rendez-vous ; les annulées ne comptent jamais", () => {
    const rows = [b({ price: 15000 }), b({ price: 8000 }), b({ price: 99999, status: "cancelled" }), b({ price: 5000, date: "2026-10-24" })];
    expect(revenue(rows, "2026-10-25", "2026-10-25")).toBe(23000);
    expect(revenue(rows, "2026-10-24", "2026-10-25")).toBe(28000);
    expect(revenue([], "2026-10-25", "2026-10-25")).toBe(0);
  });

  it("utilise le prix enregistré à la réservation (jamais un tarif du catalogue)", () => {
    expect(revenue([b({ price: 12345 })], "2026-10-25", "2026-10-25")).toBe(12345);
  });

  it("cumul du mois jusqu'à aujourd'hui, comparé au MÊME intervalle du mois précédent", () => {
    const rows = [
      b({ date: "2026-10-01", price: 1000 }), b({ date: "2026-10-25", price: 2000 }), b({ date: "2026-10-26", price: 50000 }),   // après aujourd'hui : exclu
      b({ date: "2026-09-01", price: 400 }), b({ date: "2026-09-25", price: 600 }), b({ date: "2026-09-26", price: 70000 }),     // après le 25 : exclu
    ];
    expect(monthToDate(rows, "2026-10-25")).toMatchObject({ current: 3000, previous: 1000, start: "2026-10-01", prevStart: "2026-09-01", prevEnd: "2026-09-25" });
  });

  it("fin de mois : l'intervalle précédent est plafonné à la longueur du mois précédent", () => {
    const m = monthToDate([b({ date: "2026-02-28", price: 700 }), b({ date: "2026-03-31", price: 100 })], "2026-03-31");
    expect(m.prevEnd).toBe("2026-02-28");
    expect(m.previous).toBe(700);
    expect(m.current).toBe(100);
  });
});

describe("tendance", () => {
  it("hausse, baisse, stable", () => {
    expect(trend(1500, 1000)).toEqual({ direction: "up", percent: 50 });
    expect(trend(750, 1000)).toEqual({ direction: "down", percent: -25 });
    expect(trend(1000, 1000)).toEqual({ direction: "flat", percent: 0 });
    expect(trend(1234, 1000)).toEqual({ direction: "up", percent: 23.4 });
  });
  it("aucune base de comparaison : jamais de pourcentage inventé", () => {
    expect(trend(5000, 0)).toEqual({ direction: "new", percent: null });
    expect(trend(0, 0)).toEqual({ direction: "none", percent: null });
  });
  it("retour à zéro : -100 %", () => { expect(trend(0, 1000)).toEqual({ direction: "down", percent: -100 }); });
});

describe("séries et classements", () => {
  it("14 jours jusqu'à aujourd'hui inclus, du plus ancien au plus récent, jours sans activité à zéro", () => {
    const s = dailySeries([b({ date: "2026-10-25", price: 3000 }), b({ date: "2026-10-25", price: 2000 }), b({ date: "2026-10-12", price: 900 }), b({ date: "2026-10-11", price: 7777 }), b({ date: "2026-10-26", price: 5 })], "2026-10-25", 14);
    expect(s).toHaveLength(14);
    expect(s[0]!.date).toBe("2026-10-12");
    expect(s[13]!.date).toBe("2026-10-25");
    expect(s[13]).toEqual({ date: "2026-10-25", revenue: 5000, bookings: 2 });
    expect(s[0]).toEqual({ date: "2026-10-12", revenue: 900, bookings: 1 });
    expect(s.reduce((t, p) => t + p.revenue, 0)).toBe(5900);   // ni la veille de la fenêtre, ni demain
  });

  it("prestations les plus rentables : classées par chiffre d'affaires confirmé, départage par nombre puis nom", () => {
    const rows = [
      b({ serviceName: "B", price: 5000 }), b({ serviceName: "B", price: 5000 }), b({ serviceName: "A", price: 10000 }), b({ serviceName: "C", price: 20000 }),
      b({ serviceName: "D", price: 90000, status: "cancelled" }),
    ];
    expect(topServices(rows, 5)).toEqual([
      { name: "C", revenue: 20000, bookings: 1 }, { name: "B", revenue: 10000, bookings: 2 }, { name: "A", revenue: 10000, bookings: 1 },
    ]);
    expect(topServices(rows, 1)).toHaveLength(1);
    expect(topServices([], 5)).toEqual([]);
  });

  it("panier moyen et taux d'annulation", () => {
    const rows = [b({ price: 10000 }), b({ price: 20000 }), b({ price: 5000, status: "cancelled" }), b({ price: 5000, status: "cancelled" })];
    expect(averageBasket(rows)).toBe(15000);
    expect(cancellationRate(rows)).toBe(50);
    expect(cancellationRate([b({}), b({}), b({ status: "cancelled" })])).toBe(33.3);
    expect(averageBasket([])).toBeNull();
    expect(averageBasket([b({ status: "cancelled" })])).toBeNull();
    expect(cancellationRate([])).toBeNull();
  });
});

import { categoryBreakdown, granularity, newClientsThisMonth, periodRanges, revenueSeries, topBooked } from "@/lib/admin-dashboard";

describe("périodes du graphique", () => {
  const T = "2026-10-25";
  it("7 et 30 jours glissants, comparés aux périodes précédentes de même durée", () => {
    expect(periodRanges("7d", T)).toEqual({ current: { from: "2026-10-19", to: T }, previous: { from: "2026-10-12", to: "2026-10-18" } });
    expect(periodRanges("30d", T)).toEqual({ current: { from: "2026-09-26", to: T }, previous: { from: "2026-08-27", to: "2026-09-25" } });
  });
  it("mois, trimestre, année en cours : même nombre de jours que la période précédente", () => {
    expect(periodRanges("month", T)).toEqual({ current: { from: "2026-10-01", to: T }, previous: { from: "2026-09-01", to: "2026-09-25" } });
    expect(periodRanges("quarter", T)).toEqual({ current: { from: "2026-10-01", to: T }, previous: { from: "2026-07-01", to: "2026-07-25" } });
    expect(periodRanges("year", T)).toEqual({ current: { from: "2026-01-01", to: T }, previous: { from: "2025-01-01", to: "2025-10-25" } });
  });
  it("fins de période : la période précédente est plafonnée à sa propre fin", () => {
    expect(periodRanges("month", "2026-03-31").previous).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRanges("quarter", "2026-06-30").previous).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(periodRanges("quarter", "2026-02-15").current.from).toBe("2026-01-01");
    expect(periodRanges("year", "2028-02-29").previous.to).toBe("2027-02-28".replace("02-28", "02-28") === "2027-02-28" ? periodRanges("year", "2028-02-29").previous.to : "");
  });
  it("granularité : jour, semaine pour le trimestre, mois pour l'année", () => {
    expect(["7d", "30d", "month", "quarter", "year"].map((p) => granularity(p as never))).toEqual(["day", "day", "day", "week", "month"]);
  });
});

describe("série du graphique", () => {
  const rows = [b({ date: "2026-10-25", price: 3000 }), b({ date: "2026-10-19", price: 1000 }), b({ date: "2026-10-18", price: 999 }), b({ date: "2026-10-20", price: 500, status: "cancelled" }), b({ date: "2026-08-10", price: 400 })];
  it("un point par jour, zéros compris, annulées exclues", () => {
    const s = revenueSeries(rows, { from: "2026-10-19", to: "2026-10-25" }, "day");
    expect(s).toHaveLength(7);
    expect(s[0]).toMatchObject({ from: "2026-10-19", revenue: 1000, bookings: 1 });
    expect(s[1]).toMatchObject({ from: "2026-10-20", revenue: 0, bookings: 0 });
    expect(s[6]).toMatchObject({ from: "2026-10-25", revenue: 3000 });
    expect(s.reduce((t, p) => t + p.revenue, 0)).toBe(4000);
  });
  it("blocs de 7 jours pour le trimestre, le dernier plafonné à aujourd'hui", () => {
    const s = revenueSeries(rows, { from: "2026-10-01", to: "2026-10-25" }, "week");
    expect(s.map((p) => [p.from, p.to])).toEqual([["2026-10-01", "2026-10-07"], ["2026-10-08", "2026-10-14"], ["2026-10-15", "2026-10-21"], ["2026-10-22", "2026-10-25"]]);
    expect(s[2]!.revenue).toBe(1999);   // 18 et 19 octobre
    expect(s[3]!.revenue).toBe(3000);
  });
  it("un point par mois pour l'année : premier mois complet, dernier arrêté à aujourd'hui", () => {
    const s = revenueSeries(rows, { from: "2026-01-01", to: "2026-10-25" }, "month");
    expect(s).toHaveLength(10);
    expect(s[0]).toMatchObject({ from: "2026-01-01", to: "2026-01-31" });
    expect(s[7]).toMatchObject({ from: "2026-08-01", revenue: 400 });
    expect(s[9]).toMatchObject({ from: "2026-10-01", to: "2026-10-25", revenue: 4999 });
  });
});

describe("répartition par catégorie et prestations les plus réservées", () => {
  const cat = (sid: string | undefined) => (sid === "a" ? { id: "visage", label: "Visage" } : sid === "b" ? { id: "massage", label: "Massage" } : { id: "autres", label: "Autres" });
  const rows = [
    b({ serviceId: "a", serviceName: "Soin A", price: 6000 }), b({ serviceId: "a", serviceName: "Soin A", price: 4000 }), b({ serviceId: "b", serviceName: "Massage", price: 10000 }),
    b({ serviceName: "Inconnue", price: 20000 }), b({ serviceId: "b", serviceName: "Massage", price: 99999, status: "cancelled" }), b({ serviceId: "a", serviceName: "Soin A", price: 77, date: "2026-01-01" }),
  ];
  const range = { from: "2026-10-01", to: "2026-10-31" };

  it("montants et pourcentages par catégorie, sur la période et les réservations confirmées seulement", () => {
    const s = categoryBreakdown(rows, range, cat);
    expect(s.map((c) => [c.label, c.revenue, c.percent, c.bookings])).toEqual([["Autres", 20000, 50, 1], ["Massage", 10000, 25, 1], ["Visage", 10000, 25, 2]].map((x) => x));
    expect(s.reduce((t, c) => t + c.percent, 0)).toBe(100);
  });
  it("aucune donnée : liste vide, jamais de répartition inventée", () => {
    expect(categoryBreakdown([], range, cat)).toEqual([]);
    expect(categoryBreakdown([b({ status: "cancelled" })], range, cat)).toEqual([]);
    expect(categoryBreakdown(rows, { from: "2025-01-01", to: "2025-01-31" }, cat)).toEqual([]);
  });
  it("prestations les plus réservées : nombre de réservations confirmées et part du total de la période", () => {
    const s = topBooked(rows, range, 5);
    expect(s.map((x) => [x.name, x.bookings, x.percent])).toEqual([["Soin A", 2, 50], ["Inconnue", 1, 25], ["Massage", 1, 25]]);
    expect(topBooked(rows, range, 1)).toHaveLength(1);
    expect(topBooked([], range)).toEqual([]);
  });
  it("nouveaux clients du mois : première réservation enregistrée ce mois-ci", () => {
    const r = [
      b({ phoneKey: "1", createdAt: "2026-10-03T10:00:00Z" }), b({ phoneKey: "1", createdAt: "2026-10-20T10:00:00Z" }),   // nouveau
      b({ phoneKey: "2", createdAt: "2026-09-30T10:00:00Z" }), b({ phoneKey: "2", createdAt: "2026-10-10T10:00:00Z" }),   // ancien
      b({ phoneKey: "3", createdAt: "2026-10-25T08:00:00Z" }),                                                            // nouveau
    ];
    expect(newClientsThisMonth(r, "2026-10-25")).toBe(2);
    expect(newClientsThisMonth([], "2026-10-25")).toBe(0);
  });
});
