import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tableau de bord « Vue d'ensemble » : indicateurs commerciaux, graphiques, dernières réservations. Aucune donnée codée en dur : tout vient des
// réservations et des prestations lues (ici simulées). La section « État du système » n'existe plus.
const mocks = vi.hoisted(() => ({ bookings: vi.fn(), services: vi.fn(), signOut: vi.fn(), email: { value: "admin@example.test" as string | null } }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  Link: ({ children, to, className, ...rest }: { children?: ReactNode; to: string; className?: string } & Record<string, unknown>) => <a href={to} className={className} aria-label={rest["aria-label"] as string | undefined}>{children}</a>,
}));
vi.mock("@/components/admin-gate", () => ({ useAdminEmail: () => mocks.email.value, useAdminSignOut: () => mocks.signOut }));
vi.mock("@/lib/admin-service-categories", async (orig) => ({ ...(await orig<typeof import("@/lib/admin-service-categories")>()), listAdminServiceCategories: vi.fn().mockResolvedValue([]) }));
// jsdom n'a aucune dimension : le conteneur adaptatif reçoit une taille fixe pour que les graphiques se dessinent.
vi.mock("recharts", async (orig) => {
  const m = await orig<typeof import("recharts")>();
  return { ...m, ResponsiveContainer: ({ children, height }: { children: ReactElement; height?: number }) => cloneElement(children, { width: 600, height: height ?? 250 } as never) };
});
vi.mock("@/lib/admin-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-api")>()),
  listAdminBookings: mocks.bookings, listAdminServices: mocks.services,
}));

import { AdminError, type AdminBooking, type AdminService } from "@/lib/admin-api";
import { addDays } from "@/lib/admin-dashboard";
import { abidjanToday } from "@/lib/bookings";
import { Route } from "@/routes/admin.index";

const Page = (Route as unknown as { component: () => ReactElement }).component;
const today = abidjanToday();
const day = (n: number) => addDays(today, n);
const booking = (o: Partial<AdminBooking>): AdminBooking => ({
  ref: "DLD-0000000001", name: "Awa Koné", phone: "07 00 00 00 00", phoneKey: "0700000000", serviceName: "Massage dos et nuque",
  date: today, slot: "23:59", status: "confirmed", price: 10000, createdAt: "2030-01-01T00:00:00Z", ...o,
});
const service = (o: Partial<AdminService> = {}): AdminService => ({
  id: "s", name: "Soin", category: "visage", description: "", durationLabel: "60 min", durationMin: 60, price: 1000, active: true, isDemo: false, imageUrl: null, ...o,
});
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Page /></QueryClientProvider>);
}
const card = (label: string) => screen.getByText(label, { selector: ".dash-card-label" }).closest(".dash-card") as HTMLElement;

beforeEach(() => {
  mocks.email.value = "admin@example.test";
  mocks.bookings.mockReset().mockResolvedValue([]);
  mocks.services.mockReset().mockResolvedValue([]);
  mocks.signOut.mockReset();
});
afterEach(cleanup);

describe("section « État du système » supprimée", () => {
  it("aucun bloc, aucun indicateur technique sur le dashboard", async () => {
    mocks.services.mockResolvedValue([service({ isDemo: true })]);
    show();
    await screen.findByRole("heading", { level: 1, name: "Vue d'ensemble" });
    for (const t of [/État du système/, /Base de données/, /Authentification administrateur/, /Rôle administrateur/, /Politiques d'accès/, /RLS/, /Catalogue de prestations/, /Connexion à Supabase/, /Tarifs de démonstration/, /État de la configuration/]) {
      expect(screen.queryByText(t)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("heading", { name: /système/i })).not.toBeInTheDocument();
  });
});

describe("barre supérieure et bannière", () => {
  it("date du jour en français, session, bouton Actualiser", async () => {
    show();
    expect(await screen.findByLabelText("Date du jour")).toHaveTextContent(/^(Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche) \d{1,2} \S+ \d{4}$/);
    expect(screen.getByRole("status", { name: "État de la connexion" })).toHaveTextContent("Session active");
    expect(screen.getByRole("button", { name: "Actualiser les données" })).toBeInTheDocument();
  });

  it("pas d'indicateur de session sans compte", async () => {
    mocks.email.value = null;
    show();
    await screen.findByLabelText("Date du jour");
    expect(screen.queryByRole("status", { name: "État de la connexion" })).not.toBeInTheDocument();
  });

  it("bannière : photo décorative, titre et sous-titre", async () => {
    show();
    const banner = (await screen.findByRole("heading", { level: 1, name: "Vue d'ensemble" })).closest("section") as HTMLElement;
    expect(within(banner).getByText("Le résumé de l'activité de votre spa en un coup d'œil.")).toBeInTheDocument();
    expect(banner.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("« Actualiser » relit les deux sources sans en créer d'autres", async () => {
    show();
    await waitFor(() => expect(mocks.bookings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Actualiser les données" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Actualiser les données" }));
    await waitFor(() => expect(mocks.bookings).toHaveBeenCalledTimes(2));
    expect(mocks.services).toHaveBeenCalledTimes(2);
  });
});

describe("cartes des indicateurs", () => {
  it("chiffre d'affaires du jour : réservations confirmées du jour, comparaison avec la veille", async () => {
    mocks.bookings.mockResolvedValue([
      booking({ ref: "A", price: 15000 }), booking({ ref: "B", price: 8000, phoneKey: "1" }), booking({ ref: "C", price: 50000, status: "cancelled", phoneKey: "2" }),
      booking({ ref: "D", price: 10000, date: day(-1), phoneKey: "3" }),
    ]);
    show();
    await waitFor(() => expect(within(card("Chiffre d'affaires du jour")).getByText("23 000 FCFA")).toBeInTheDocument());
    const c = within(card("Chiffre d'affaires du jour"));
    expect(c.getByText("+130 % vs hier")).toBeInTheDocument();
    expect(c.getByText(/hier : 10 000 FCFA/)).toBeInTheDocument();
  });

  it("veille sans chiffre d'affaires : « Nouveau » sans pourcentage inventé ; aucun des deux jours : « Pas de comparaison »", async () => {
    mocks.bookings.mockResolvedValue([booking({ price: 15000 })]);
    show();
    await waitFor(() => expect(within(card("Chiffre d'affaires du jour")).getByText("Nouveau vs hier")).toBeInTheDocument());
    cleanup();
    mocks.bookings.mockResolvedValue([]);
    show();
    await waitFor(() => expect(within(card("Chiffre d'affaires du jour")).getByText("Pas de comparaison")).toBeInTheDocument());
  });

  it("baisse par rapport à la veille", async () => {
    mocks.bookings.mockResolvedValue([booking({ price: 5000 }), booking({ ref: "H", price: 10000, date: day(-1), phoneKey: "1" })]);
    show();
    await waitFor(() => expect(within(card("Chiffre d'affaires du jour")).getByText("−50 % vs hier")).toBeInTheDocument());
  });

  it("chiffre d'affaires mensuel : cumul du mois et évolution par rapport à la même période du mois précédent", async () => {
    const start = `${today.slice(0, 7)}-01`;
    const prev = addDays(start, -1).slice(0, 7);
    mocks.bookings.mockResolvedValue([
      booking({ ref: "A", date: start, price: 30000 }),
      booking({ ref: "P", date: `${prev}-01`, price: 20000, phoneKey: "1" }),
    ]);
    show();
    const c = () => within(card("Chiffre d'affaires mensuel"));
    await waitFor(() => expect(c().getByText("30 000 FCFA")).toBeInTheDocument());
    expect(c().getByText("+50 % vs mois précédent")).toBeInTheDocument();
    expect(c().getByText(/même période : 20 000 FCFA/)).toBeInTheDocument();
  });

  it("réservations du jour : confirmées (et annulées signalées), lien vers la liste", async () => {
    mocks.bookings.mockResolvedValue([booking({ ref: "A" }), booking({ ref: "B", phoneKey: "1" }), booking({ ref: "C", status: "cancelled", phoneKey: "2" })]);
    show();
    await waitFor(() => expect(within(card("Réservations du jour")).getByText("2")).toBeInTheDocument());
    expect(within(card("Réservations du jour")).getByText("2 confirmées · 1 annulée")).toBeInTheDocument();
    expect(card("Réservations du jour")).toHaveAttribute("href", "/admin/reservations");
  });

  it("rendez-vous à venir : confirmés non passés ; aucun statut « en attente » inventé ; lien vers la liste", async () => {
    mocks.bookings.mockResolvedValue([booking({ ref: "A", date: day(2) }), booking({ ref: "B", date: day(4), phoneKey: "1" }), booking({ ref: "C", date: day(3), status: "cancelled", phoneKey: "2" })]);
    show();
    await waitFor(() => expect(within(card("Rendez-vous à venir")).getByText("2")).toBeInTheDocument());
    expect(screen.queryByText(/en attente/i)).not.toBeInTheDocument();
    expect(card("Rendez-vous à venir")).toHaveAttribute("href", "/admin/reservations");
  });

  it("erreur de lecture : « Chargement impossible », jamais un montant à zéro", async () => {
    mocks.bookings.mockRejectedValue(new AdminError("server", "Lecture impossible."));
    show();
    await waitFor(() => expect(within(card("Chiffre d'affaires du jour")).getByRole("alert")).toHaveTextContent("Chargement impossible"));
    expect(within(card("Chiffre d'affaires du jour")).getByText("—")).toBeInTheDocument();
    expect(within(card("Chiffre d'affaires mensuel")).getByText("—")).toBeInTheDocument();
  });

  it("précise que le chiffre d'affaires est un montant réservé (aucun encaissement enregistré)", async () => {
    show();
    expect(await screen.findByText(/Aucun paiement n'est enregistré/)).toBeInTheDocument();
  });
});

describe("graphique du chiffre d'affaires", () => {
  const chart = () => screen.getByRole("img", { name: /Évolution du chiffre d'affaires estimé/ });
  const detail = () => within(screen.getByRole("list", { name: "Détail du graphique" }));

  it("7 derniers jours par défaut : total, comparaison avec la période précédente, détail jour par jour fidèle aux réservations confirmées", async () => {
    mocks.bookings.mockResolvedValue([
      booking({ price: 12000 }), booking({ ref: "B", date: day(-3), price: 3000, phoneKey: "1" }), booking({ ref: "C", date: day(-1), price: 99000, status: "cancelled", phoneKey: "2" }),
      booking({ ref: "D", date: day(-9), price: 5000, phoneKey: "3" }),   // période précédente (7 jours avant les 7 derniers)
    ]);
    show();
    await waitFor(() => expect(chart()).toHaveAttribute("aria-label", expect.stringContaining("15 000 FCFA")));
    expect(screen.getByLabelText("Période du graphique")).toHaveValue("7d");
    const panel = within(screen.getByRole("heading", { name: "Chiffre d'affaires" }).closest("section") as HTMLElement);
    expect(panel.getByText("Période précédente : 5 000 FCFA")).toBeInTheDocument();
    expect(panel.getByText("+200 % aux 7 jours précédents")).toBeInTheDocument();
    expect(detail().getAllByRole("listitem")).toHaveLength(7);
    expect(detail().getByText(/: 12 000 FCFA$/)).toBeInTheDocument();
    expect(detail().getByText(/: 3 000 FCFA$/)).toBeInTheDocument();
    expect(detail().queryByText(/99 000/)).not.toBeInTheDocument();   // annulée : jamais comptée
  });

  it("changer de période recalcule le graphique, la comparaison et le nombre de points", async () => {
    mocks.bookings.mockResolvedValue([booking({ price: 4000 }), booking({ ref: "B", date: day(-20), price: 6000, phoneKey: "1" })]);
    show();
    await waitFor(() => expect(chart()).toHaveAttribute("aria-label", expect.stringContaining("4 000 FCFA")));
    fireEvent.change(screen.getByLabelText("Période du graphique"), { target: { value: "30d" } });
    await waitFor(() => expect(chart()).toHaveAttribute("aria-label", expect.stringContaining("10 000 FCFA")));
    expect(detail().getAllByRole("listitem")).toHaveLength(30);
    expect([...(screen.getByLabelText("Période du graphique") as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["7 derniers jours", "30 derniers jours", "Ce mois", "Ce trimestre", "Cette année"]);
  });

  it("aucune réservation : état vide explicite, aucun graphique ; chargement et erreur signalés", async () => {
    show();
    expect((await screen.findAllByText("Aucune réservation confirmée sur cette période.")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("img", { name: /Évolution du chiffre d'affaires estimé/ })).not.toBeInTheDocument();
    cleanup();
    mocks.bookings.mockReturnValue(new Promise(() => {}));
    show();
    expect(screen.getAllByLabelText("Chargement").length).toBeGreaterThan(0);
    cleanup();
    mocks.bookings.mockRejectedValue(new AdminError("server", "x"));
    show();
    expect((await screen.findAllByText("Chargement impossible")).length).toBeGreaterThan(0);
  });
});

describe("répartition des revenus", () => {
  it("par catégorie de prestation réelle ; réservations sans prestation connue regroupées sous « Autres prestations »", async () => {
    mocks.services.mockResolvedValue([service({ id: "s1", category: "visage" })]);
    mocks.bookings.mockResolvedValue([booking({ ref: "A", serviceId: "s1", price: 10000 }), booking({ ref: "B", price: 10000, phoneKey: "1" }), booking({ ref: "C", serviceId: "s1", price: 77000, status: "cancelled", phoneKey: "2" })]);
    show();
    await waitFor(() => expect(document.querySelectorAll(".dash-legend > li")).toHaveLength(2));
    const items = [...document.querySelectorAll(".dash-legend > li")].map((li) => [li.querySelector(".dash-legend-pct")!.textContent, li.querySelector(".dash-legend-amount")!.textContent]);
    expect(items).toEqual([["50 %", "10 000 FCFA"], ["50 %", "10 000 FCFA"]]);
    expect(screen.getByText("Autres prestations")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Répartition des revenus estimés : 20 000 FCFA" })).toBeInTheDocument();
  });

  it("données insuffisantes : message explicite, aucune répartition inventée", async () => {
    show();
    expect(await screen.findByText(/Pas assez de données/)).toBeInTheDocument();
    expect(document.querySelector(".dash-legend")).toBeNull();
  });
});

describe("prestations les plus vendues", () => {
  it("classement par nombre de réservations confirmées, avec part de la période ; annulées ignorées", async () => {
    mocks.bookings.mockResolvedValue([
      booking({ ref: "A", serviceName: "Nattes et tresses" }), booking({ ref: "B", serviceName: "Pédicure soin", phoneKey: "1" }),
      booking({ ref: "C", serviceName: "Pédicure soin", phoneKey: "2" }), booking({ ref: "D", serviceName: "Annulée", status: "cancelled", phoneKey: "3" }),
    ]);
    show();
    await waitFor(() => expect(document.querySelectorAll(".dash-sold > li")).toHaveLength(2));
    const items = [...document.querySelectorAll(".dash-sold > li")].map((li) => [li.querySelector(".dash-sold-name")!.textContent, li.querySelector(".dash-sold-count")!.textContent, li.querySelector(".dash-sold-pct")!.textContent]);
    expect(items).toEqual([["Pédicure soin", "2 réservations", "66,7 %"], ["Nattes et tresses", "1 réservation", "33,3 %"]]);
  });

  it("aucune réservation sur la période : message vide", async () => {
    mocks.bookings.mockResolvedValue([booking({ date: day(-60) })]);
    show();
    await waitFor(() => expect(screen.getAllByText("Aucune réservation confirmée sur cette période.")).toHaveLength(2));   // graphique + classement
    expect(document.querySelector(".dash-sold")).toBeNull();
  });
});

describe("accès rapides", () => {
  it("cinq raccourcis vers les pages existantes", async () => {
    show();
    const nav = within(await screen.findByRole("navigation", { name: "Accès rapides" }));
    expect(nav.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Gérer les réservations", "/admin/reservations"], ["Consulter les prestations", "/admin/prestations"], ["Gérer les produits", "/admin/produits"],
      ["Gérer les promotions", "/admin/promotions"], ["Accéder aux paramètres", "/admin/parametres"],
    ]);
  });
});

describe("activité récente", () => {
  const rows = () => [...document.querySelectorAll<HTMLElement>(".dash-table tbody tr")];

  it("derniers rendez-vous ENREGISTRÉS (date de création) : client, prestation, référence, date et heure, statut", async () => {
    mocks.bookings.mockResolvedValue([
      booking({ ref: "DLD-ANCIEN", name: "Ancienne", createdAt: "2030-01-01T00:00:00Z", date: "2026-10-30", slot: "15:30", serviceName: "Soin du visage éclat" }),
      booking({ ref: "DLD-RECENT", name: "Récente", createdAt: "2030-01-09T00:00:00Z", date: "2026-10-26", slot: "09:00", serviceName: "Nattes et tresses" }),
      booking({ ref: "DLD-ANNULE", name: "Dupont", createdAt: "2030-01-05T00:00:00Z", status: "cancelled", date: "2026-10-29", slot: "15:30", serviceName: "Pédicure soin" }),
    ]);
    show();
    await screen.findByText("DLD-RECENT");
    expect([...document.querySelectorAll(".dash-table thead th")].map((th) => th.textContent)).toEqual(["Client", "Prestation", "Référence", "Date et heure", "Statut"]);
    expect(rows().map((r) => within(r).getByText(/^DLD-/).textContent)).toEqual(["DLD-RECENT", "DLD-ANNULE", "DLD-ANCIEN"]);
    const first = rows()[0]!;
    expect(within(first).getByText("Récente")).toBeInTheDocument();
    expect(within(first).getByText("Nattes et tresses")).toBeInTheDocument();
    expect(within(first).getByText("26 oct. 2026 · 09:00")).toBeInTheDocument();
    expect(within(first).getByText("Confirmée")).toBeInTheDocument();
    expect(within(rows()[1]!).getByText("Annulée", { selector: ".dash-badge" })).toBeInTheDocument();
  });

  it("limitée aux 5 dernières, avec un lien vers toutes les réservations", async () => {
    mocks.bookings.mockResolvedValue(Array.from({ length: 9 }, (_, i) => booking({ ref: `DLD-${i}`, createdAt: `2030-01-0${i + 1}T00:00:00Z`, phoneKey: String(i) })));
    show();
    await screen.findByText("DLD-8");
    expect(rows()).toHaveLength(5);
    expect(screen.getByRole("link", { name: /Voir toutes les réservations/ })).toHaveAttribute("href", "/admin/reservations");
  });

  it("vide : message explicite ; erreur : « Réessayer », jamais de faux rendez-vous", async () => {
    show();
    expect(await screen.findByText("Aucune réservation")).toBeInTheDocument();
    cleanup();
    mocks.bookings.mockRejectedValueOnce(new AdminError("network", "x")).mockResolvedValue([booking({ ref: "DLD-OK" })]);
    show();
    expect((await screen.findAllByText("Chargement impossible")).length).toBeGreaterThan(0);
    expect(rows()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Réessayer/ }));
    expect(await screen.findByText("DLD-OK")).toBeInTheDocument();
  });
});

describe("cartes clients et prestations, bandeau final, structure", () => {
  it("clients distincts et nouveaux clients du mois ; prestations actives au catalogue", async () => {
    const created = `${today.slice(0, 7)}-01T10:00:00Z`;
    mocks.bookings.mockResolvedValue([booking({ ref: "A", phoneKey: "1", createdAt: created }), booking({ ref: "B", phoneKey: "2", createdAt: "2020-01-01T00:00:00Z" })]);
    mocks.services.mockResolvedValue([service({ id: "a" }), service({ id: "b" }), service({ id: "c", active: false })]);
    show();
    await waitFor(() => expect(within(card("Clients")).getByText("2")).toBeInTheDocument());
    expect(within(card("Clients")).getByText(/1 nouveau client ce mois/)).toBeInTheDocument();
    expect(card("Clients")).toHaveAttribute("href", "/admin/clients");
    await waitFor(() => expect(within(card("Prestations au catalogue")).getByText("2")).toBeInTheDocument());
    expect(card("Prestations au catalogue")).toHaveAttribute("href", "/admin/prestations");
  });

  it("sans donnée : tirets, jamais de zéros trompeurs", async () => {
    mocks.bookings.mockRejectedValue(new AdminError("server", "x"));
    mocks.services.mockRejectedValue(new AdminError("server", "x"));
    show();
    await waitFor(() => expect(within(card("Clients")).getByText("—")).toBeInTheDocument());
    await waitFor(() => expect(within(card("Prestations au catalogue")).getByText("—")).toBeInTheDocument());
  });

  it("bandeau final : message d'accueil et bouton vers les prestations", async () => {
    show();
    const end = within(await screen.findByLabelText("Message de bienvenue"));
    expect(end.getByText("Prenez soin de vous, chaque jour")).toBeInTheDocument();
    expect(end.getByText("Une expérience beauté et détente, sur mesure.")).toBeInTheDocument();
    expect(end.getByRole("link", { name: /Voir nos prestations/ })).toHaveAttribute("href", "/admin/prestations");
  });

  it("zone de compte du tableau de bord : e-mail réel et déconnexion", async () => {
    show();
    const zone = await screen.findByLabelText("Compte administrateur");
    expect(within(zone).getByText("admin@example.test")).toBeInTheDocument();
    fireEvent.click(within(zone).getByRole("button", { name: "Se déconnecter" }));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("ordre des sections", async () => {
    show();
    await screen.findByRole("heading", { name: "Activité récente" });
    expect([...document.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Chiffre d'affaires", "Répartition des revenus", "Accès rapides", "Prestations les plus vendues", "Activité récente"]);
  });
});
