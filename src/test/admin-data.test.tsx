import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ bookings: vi.fn(), services: vi.fn(), settings: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  Link: ({ children, to }: { children?: unknown; to: string }) => <a href={to}>{children as never}</a>,
}));
vi.mock("recharts", async (orig) => {
  const m = await orig<typeof import("recharts")>();
  return { ...m, ResponsiveContainer: ({ children, height }: { children: ReactElement; height?: number }) => cloneElement(children, { width: 600, height: height ?? 250 } as never) };
});
vi.mock("@/components/app", () => ({ Img: () => null }));
vi.mock("@/lib/admin-service-categories", async (orig) => ({ ...(await orig<typeof import("@/lib/admin-service-categories")>()), listAdminServiceCategories: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/admin-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-api")>()),
  listAdminBookings: mocks.bookings,
  listAdminServices: mocks.services,
  getAdminSettings: mocks.settings,
}));

import {
  AdminError, bookingsToday, classify, clientsFromBookings, upcomingBookings, type AdminBooking,
} from "@/lib/admin-api";
import { abidjanToday } from "@/lib/bookings";
import { Route as Overview } from "@/routes/admin.index";
import { Route as Clients } from "@/routes/admin.clients";
import { Route as Services } from "@/routes/admin.prestations";
import { Route as Settings } from "@/routes/admin.parametres";

const component = (r: unknown) => (r as { component: () => ReactElement }).component;

const today = abidjanToday();
const day = (offset: number) => new Date(Date.parse(`${today}T00:00:00Z`) + offset * 864e5).toISOString().slice(0, 10);
const booking = (o: Partial<AdminBooking>): AdminBooking => ({
  ref: "DLD-0000000001", name: "Awa Koné", phone: "07 00 00 00 00", phoneKey: "0700000000", serviceName: "Massage dos et nuque",
  date: today, slot: "23:59", status: "confirmed", price: 10000, createdAt: "2030-01-01T00:00:00Z", ...o,
});

function show(page: unknown) {
  const Page = component(page);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
}

describe("calculs sur les réservations", () => {
  it("réservations du jour : confirmées et à la date d'Abidjan seulement", () => {
    const rows = [booking({}), booking({ ref: "B", status: "cancelled" }), booking({ ref: "C", date: day(1) }), booking({ ref: "D", date: day(-1) })];
    expect(bookingsToday(rows).map((b) => b.ref)).toEqual(["DLD-0000000001"]);
  });

  it("à venir : confirmées et futures, du plus proche au plus lointain", () => {
    const rows = [
      booking({ ref: "LOIN", date: day(5), slot: "09:00" }),
      booking({ ref: "PASSE", date: day(-2), slot: "09:00" }),
      booking({ ref: "ANNULEE", date: day(2), slot: "09:00", status: "cancelled" }),
      booking({ ref: "PROCHE", date: day(1), slot: "09:00" }),
    ];
    expect(upcomingBookings(rows).map((b) => b.ref)).toEqual(["PROCHE", "LOIN"]);
  });

  it("clients : regroupés par numéro normalisé, rendez-vous confirmés comptés, nom le plus récent", () => {
    const rows = [
      booking({ ref: "1", name: "Awa", phone: "07 00 00 00 00", date: "2030-01-10" }),
      booking({ ref: "2", name: "Awa K.", phone: "+225 0700000000", date: "2030-02-10" }),
      booking({ ref: "3", name: "Awa", phone: "0700000000", date: "2030-03-10", status: "cancelled" }),
      booking({ ref: "4", name: "Fanta", phone: "05 00 00 00 00", phoneKey: "0500000000", date: "2030-01-01" }),
    ];
    const clients = clientsFromBookings(rows);
    expect(clients).toHaveLength(2);
    const awa = clients.find((c) => c.key === "0700000000")!;
    expect(awa).toMatchObject({ bookings: 2, lastDate: "2030-03-10" });
  });

  it("classe les erreurs : autorisation, réseau, autre", () => {
    expect(classify({ code: "42501", message: "permission denied" }, "x").code).toBe("forbidden");
    expect(classify({ status: 401 }, "x").code).toBe("forbidden");
    expect(classify({ message: "TypeError: Failed to fetch" }, "x").code).toBe("network");
    expect(classify({ code: "XX000", message: "boom" }, "x")).toMatchObject({ code: "server" });
    expect(classify({ code: "XX000" }, "x")).toBeInstanceOf(AdminError);
  });
});

describe("pages d'administration branchées sur la base", () => {
  beforeEach(() => {
    mocks.bookings.mockReset();
    mocks.services.mockReset().mockResolvedValue([]);
    mocks.settings.mockReset();
  });
  afterEach(cleanup);

  it("vue d'ensemble : indicateurs et activité calculés sur les réservations lues", async () => {
    mocks.bookings.mockResolvedValue([
      booking({ ref: "AUJ", createdAt: "2030-01-03T00:00:00Z" }),
      booking({ ref: "FUT", date: day(3), slot: "10:30", name: "Fanta", phoneKey: "0500000000", createdAt: "2030-01-02T00:00:00Z" }),
    ]);
    mocks.services.mockResolvedValue([{ id: "a", name: "A", category: "visage", description: "", durationLabel: "60 min", durationMin: 60, price: 1, active: true, isDemo: true }]);
    show(Overview);

    const card = (label: string) => screen.getByText(label, { selector: ".dash-card-label" }).parentElement!;
    await waitFor(() => expect(within(card("Réservations du jour")).getByText("1")).toBeInTheDocument());
    expect(within(card("Rendez-vous à venir")).getByText("2")).toBeInTheDocument();
    await waitFor(() => expect(within(card("Clients")).getByText("2")).toBeInTheDocument());   // clients distincts
    expect(await screen.findByText(/AUJ/)).toBeInTheDocument();
    expect(screen.queryByText("Aucune donnée connectée")).not.toBeInTheDocument();
  });

  it("vue d'ensemble : erreur de lecture signalée, pas affichée comme zéro", async () => {
    mocks.bookings.mockRejectedValue(new AdminError("server", "Lecture des réservations impossible."));
    show(Overview);

    expect(await screen.findAllByText("Chargement impossible")).not.toHaveLength(0);
    expect(screen.queryByText("Aucun élément")).not.toBeInTheDocument();
  });

  it("clients : liste issue des réservations ; vide si aucune réservation", async () => {
    mocks.bookings.mockResolvedValue([booking({})]);
    show(Clients);
    expect(await screen.findByText("Awa Koné")).toBeInTheDocument();
    cleanup();

    mocks.bookings.mockResolvedValue([]);
    show(Clients);
    expect(await screen.findByText("Aucun élément")).toBeInTheDocument();
  });

  it("prestations : catalogue lu en base, inactives signalées", async () => {
    mocks.services.mockResolvedValue([
      { id: "massage-dos", name: "Massage dos et nuque", category: "massage", description: "d", durationLabel: "30 min", durationMin: 30, price: 10000, active: true, isDemo: true },
      { id: "x", name: "Soin masqué", category: "spa", description: "d", durationLabel: "1 h", durationMin: 60, price: 5000, active: false, isDemo: false },
    ]);
    show(Services);

    expect(await screen.findByText("Massage dos et nuque")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getByText("Tarif à confirmer")).toBeInTheDocument(); // donnée de démonstration signalée sur la ligne concernée
    expect(screen.queryByText(/Tarifs et durées de démonstration/)).not.toBeInTheDocument(); // plus de bandeau provisoire : la gestion est réelle
  });

  it("paramètres : règles lues en base", async () => {
    mocks.settings.mockResolvedValue({
      timezone: "Africa/Abidjan", minNoticeHours: 2, cancelNoticeHours: 2, maxDaysAhead: 180, maxActivePerPhone: 3,
      slots: [{ slot: "09:00", active: true }, { slot: "10:30", active: false }],
    });
    show(Settings);

    expect(await screen.findByText("Africa/Abidjan")).toBeInTheDocument();
    expect(screen.getByText("180 jours à l'avance")).toBeInTheDocument();
    expect(screen.getByText("09:00")).toBeInTheDocument();
  });
});
