import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// L'accès à la base est simulé : ces tests vérifient l'affichage et le filtrage de la page, pas Supabase ni la RLS.
const mocks = vi.hoisted(() => ({ listAdminBookings: vi.fn(), mobile: { value: false } }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mocks.mobile.value }));
vi.mock("@/lib/admin-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-api")>()),
  listAdminBookings: mocks.listAdminBookings,
}));

import { Route } from "@/routes/admin.reservations";
import { AdminError, type AdminBooking } from "@/lib/admin-api";
import { abidjanToday } from "@/lib/bookings";

const Page = (Route as unknown as { component: () => ReactElement }).component;
const day = (n: number) => new Date(Date.parse(`${abidjanToday()}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

const row: AdminBooking = {
  ref: "DLD-ABCDEF1234", name: "Awa Koné", phone: "07 00 00 00 00", phoneKey: "0700000000", serviceName: "Massage dos et nuque",
  date: "2030-01-15", slot: "09:00", status: "confirmed", price: 10000, createdAt: "2030-01-01T09:30:00Z",
};
// Données de référence de la maquette (présentation seulement : rien n'est codé en dur dans la page).
const REF: AdminBooking[] = [
  { ...row, ref: "DLD-7B3DCFE01D", name: "mahama bamba", phone: "+2250758483726", phoneKey: "0758483726", serviceName: "Soin du visage éclat", date: "2026-10-30", slot: "15:30", price: 15000, createdAt: "2026-10-25T10:00:00Z" },
  { ...row, ref: "DLD-A2BC417F7A", name: "INNOCENT GNANGBO", phone: "+2250102030405", phoneKey: "0102030405", serviceName: "Pédicure soin", date: "2026-10-29", slot: "15:30", price: 8000, createdAt: "2026-10-24T10:00:00Z" },
  { ...row, ref: "DLD-727BE7A458", name: "Client Zones", phone: "+2250504030201", phoneKey: "0504030201", serviceName: "Nattes et tresses", date: "2026-10-26", slot: "09:00", price: 15000, createdAt: "2026-10-23T10:00:00Z" },
];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Page /></QueryClientProvider>);
}
const tr = (ref: string) => screen.getByText(ref).closest("tr") as HTMLElement;
const refs = () => [...document.querySelectorAll("tbody .ap-mono")].map((e) => e.textContent);

describe("/admin/reservations", () => {
  beforeEach(() => {
    mocks.mobile.value = false;
    mocks.listAdminBookings.mockReset();
  });
  afterEach(cleanup);

  it("en-tête, chargement avant la réponse, puis les réservations réelles", async () => {
    mocks.listAdminBookings.mockResolvedValue([row]);
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "Réservations" })).toBeInTheDocument();
    expect(screen.getByText("Gérez les rendez-vous, consultez les détails et suivez leur statut.")).toBeInTheDocument();
    expect(screen.getByLabelText("Chargement")).toBeInTheDocument();

    expect(await screen.findByText("DLD-ABCDEF1234")).toBeInTheDocument();
    expect(screen.getByText("Awa Koné")).toBeInTheDocument();
    expect(screen.getByText("Massage dos et nuque")).toBeInTheDocument();
    expect(screen.getByText("Confirmée", { selector: "td .ap-pill" })).toBeInTheDocument();
    expect(screen.queryByText("Source de données non connectée")).not.toBeInTheDocument();
  });

  it("colonnes : Référence, Client, Prestation, Date et heure, Statut, Prix, Actions", async () => {
    mocks.listAdminBookings.mockResolvedValue([row]);
    setup();
    await screen.findByText("DLD-ABCDEF1234");
    for (const h of ["Référence", "Client", "Prestation", "Date et heure", "Statut", "Prix", "Actions"]) expect(screen.getByRole("columnheader", { name: h })).toBeInTheDocument();
  });

  describe("présentation des lignes", () => {
    it("le nom et le téléphone sont sur deux lignes séparées, le numéro est conservé tel quel", async () => {
      mocks.listAdminBookings.mockResolvedValue(REF);
      setup();
      await screen.findByText("DLD-7B3DCFE01D");
      const cell = within(tr("DLD-7B3DCFE01D")).getByText("mahama bamba").closest("td") as HTMLElement;
      expect(within(cell).getByText("mahama bamba").tagName).toBe("P");
      expect(within(cell).getByText("+2250758483726").tagName).toBe("P");
      expect(cell.querySelectorAll("p")).toHaveLength(2);   // deux éléments distincts : jamais « nom+téléphone » collés
    });

    it("date lisible sur deux lignes (jour puis heure), sans format technique", async () => {
      mocks.listAdminBookings.mockResolvedValue(REF);
      setup();
      await screen.findByText("DLD-7B3DCFE01D");
      const when = tr("DLD-7B3DCFE01D").querySelector(".ap-when") as HTMLElement;
      expect([...when.children].map((c) => c.textContent)).toEqual(["30 oct. 2026", "15:30"]);
      expect(screen.queryByText(/2026-10-30/)).not.toBeInTheDocument();
      expect(when).toHaveAttribute("title", "vendredi 30 octobre 2026 à 15:30");
    });

    it("la date affichée est celle de la réservation, sans décalage de fuseau (début et fin de mois)", async () => {
      mocks.listAdminBookings.mockResolvedValue([{ ...row, ref: "DLD-0000000001", date: "2026-12-31", slot: "23:59" }, { ...row, ref: "DLD-0000000002", date: "2027-01-01", slot: "00:00", phoneKey: "1" }]);
      setup();
      await screen.findByText("DLD-0000000001");
      expect(within(tr("DLD-0000000001")).getByText("31 déc. 2026")).toBeInTheDocument();
      expect(within(tr("DLD-0000000001")).getByText("23:59")).toBeInTheDocument();
      expect(within(tr("DLD-0000000002")).getByText("1 janv. 2027")).toBeInTheDocument();
    });

    it("prix en FCFA tel qu'enregistré, statut en badge", async () => {
      mocks.listAdminBookings.mockResolvedValue(REF);
      setup();
      await screen.findByText("DLD-A2BC417F7A");
      expect(within(tr("DLD-A2BC417F7A")).getByText("8 000 FCFA")).toBeInTheDocument();
      expect(within(tr("DLD-7B3DCFE01D")).getByText("15 000 FCFA")).toBeInTheDocument();
      expect(within(tr("DLD-7B3DCFE01D")).getByText("Confirmée")).toHaveClass("ap-pill-ok");
    });

    it("statut annulée : badge distinct, libellé métier conservé", async () => {
      mocks.listAdminBookings.mockResolvedValue([{ ...row, status: "cancelled" }]);
      setup();
      await screen.findByText("DLD-ABCDEF1234");
      expect(within(tr("DLD-ABCDEF1234")).getByText("Annulée")).toHaveClass("ap-pill-muted");
    });
  });

  describe("indicateurs", () => {
    const data = () => [
      { ...row, ref: "DLD-A", status: "confirmed" as const, date: day(3) }, { ...row, ref: "DLD-B", status: "confirmed" as const, date: day(-3), phoneKey: "1" },
      { ...row, ref: "DLD-C", status: "cancelled" as const, date: day(5), phoneKey: "2" }, { ...row, ref: "DLD-D", status: "confirmed" as const, date: day(9), phoneKey: "3" },
    ];
    const kpi = (label: string) => screen.getByText(label, { selector: ".ap-kpi-label" }).closest(".ap-kpi") as HTMLElement;

    it("total, confirmées, annulées et à venir, calculés sur les données réelles (statuts existants seulement)", async () => {
      mocks.listAdminBookings.mockResolvedValue(data());
      setup();
      await screen.findByText("DLD-A");
      expect(within(kpi("Total des réservations")).getByText("4")).toBeInTheDocument();
      expect(within(kpi("Confirmées")).getByText("3")).toBeInTheDocument();
      expect(within(kpi("Annulées")).getByText("1")).toBeInTheDocument();
      expect(within(kpi("À venir")).getByText("2")).toBeInTheDocument();
      expect(screen.queryByText("À confirmer")).not.toBeInTheDocument();   // aucun statut « à confirmer » n'existe
    });

    it("ne dépendent pas des filtres en cours", async () => {
      mocks.listAdminBookings.mockResolvedValue(data());
      setup();
      await screen.findByText("DLD-A");
      fireEvent.change(screen.getByLabelText("Filtrer par statut"), { target: { value: "cancelled" } });
      expect(refs()).toEqual(["DLD-C"]);
      expect(within(kpi("Total des réservations")).getByText("4")).toBeInTheDocument();
      expect(within(kpi("Confirmées")).getByText("3")).toBeInTheDocument();
    });

    it("jamais un zéro quand le chargement échoue", async () => {
      mocks.listAdminBookings.mockRejectedValue(new AdminError("server", "x"));
      setup();
      await screen.findByText("Chargement impossible", { selector: "h3" });
      expect(within(kpi("Total des réservations")).getByText("—")).toBeInTheDocument();
    });
  });

  describe("recherche et filtres", () => {
    beforeEach(() => mocks.listAdminBookings.mockResolvedValue(REF));
    const search = (v: string) => fireEvent.change(screen.getByLabelText("Rechercher une réservation"), { target: { value: v } });

    it("par référence (insensible à la casse)", async () => {
      setup(); await screen.findByText("DLD-7B3DCFE01D");
      search("a2bc"); expect(refs()).toEqual(["DLD-A2BC417F7A"]);
    });
    it("par nom du client", async () => {
      setup(); await screen.findByText("DLD-7B3DCFE01D");
      search("zones"); expect(refs()).toEqual(["DLD-727BE7A458"]);
    });
    it("par numéro de téléphone : saisie partielle, avec ou sans espaces et indicatif", async () => {
      setup(); await screen.findByText("DLD-7B3DCFE01D");
      search("0758"); expect(refs()).toEqual(["DLD-7B3DCFE01D"]);
      search("+225 07 58"); expect(refs()).toEqual(["DLD-7B3DCFE01D"]);
      search("0504030201"); expect(refs()).toEqual(["DLD-727BE7A458"]);
    });
    it("par prestation (comportement conservé)", async () => {
      setup(); await screen.findByText("DLD-7B3DCFE01D");
      search("pédicure"); expect(refs()).toEqual(["DLD-A2BC417F7A"]);
    });
    it("filtre par statut : « Tous les statuts » conservé", async () => {
      mocks.listAdminBookings.mockResolvedValue([...REF, { ...row, status: "cancelled" }]);
      setup(); await screen.findByText("DLD-7B3DCFE01D");
      const f = screen.getByLabelText("Filtrer par statut") as HTMLSelectElement;
      expect([...f.options].map((o) => o.textContent)).toEqual(["Tous les statuts", "Confirmées", "Annulées"]);
      fireEvent.change(f, { target: { value: "cancelled" } }); expect(refs()).toEqual(["DLD-ABCDEF1234"]);
      fireEvent.change(f, { target: { value: "confirmed" } }); expect(refs()).toHaveLength(3);
      fireEvent.change(f, { target: { value: "all" } }); expect(refs()).toHaveLength(4);
    });
    it("filtre par date du rendez-vous", async () => {
      setup(); await screen.findByText("DLD-7B3DCFE01D");
      fireEvent.change(screen.getByLabelText("Filtrer par date du rendez-vous"), { target: { value: "2026-10-29" } });
      expect(refs()).toEqual(["DLD-A2BC417F7A"]);
    });
    it("critères combinés, compteur « x sur n » et réinitialisation (visible seulement si un filtre est actif)", async () => {
      setup(); await screen.findByText("DLD-7B3DCFE01D");
      expect(screen.queryByRole("button", { name: "Réinitialiser les filtres" })).not.toBeInTheDocument();
      expect(screen.getByText("3 réservations")).toBeInTheDocument();
      search("o"); fireEvent.change(screen.getByLabelText("Filtrer par date du rendez-vous"), { target: { value: "2026-10-26" } });
      expect(refs()).toEqual(["DLD-727BE7A458"]);
      expect(screen.getByText("1 sur 3 réservations")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Réinitialiser les filtres" }));
      expect(refs()).toHaveLength(3);
      expect(screen.getByLabelText("Rechercher une réservation")).toHaveValue("");
      expect(screen.getByLabelText("Filtrer par date du rendez-vous")).toHaveValue("");
      expect(screen.queryByRole("button", { name: "Réinitialiser les filtres" })).not.toBeInTheDocument();
    });
    it("aucun résultat : message dédié et bouton de réinitialisation, sans requête supplémentaire", async () => {
      setup(); await screen.findByText("DLD-7B3DCFE01D");
      search("introuvable");
      expect(screen.getByText("Aucune réservation ne correspond à vos critères.")).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole("button", { name: "Réinitialiser les filtres" })[0]!);
      expect(refs()).toHaveLength(3);
      expect(mocks.listAdminBookings).toHaveBeenCalledTimes(1);
    });
  });

  describe("actions", () => {
    it("détails : fenêtre en lecture seule avec les champs enregistrés, sans aucune action de modification", async () => {
      mocks.listAdminBookings.mockResolvedValue(REF);
      setup(); await screen.findByText("DLD-7B3DCFE01D");
      fireEvent.click(screen.getByRole("button", { name: "Détails de la réservation DLD-7B3DCFE01D" }));
      const d = await screen.findByRole("dialog");
      expect(within(d).getByText("mahama bamba")).toBeInTheDocument();
      expect(within(d).getByText("+2250758483726")).toBeInTheDocument();
      expect(within(d).getByText("Soin du visage éclat")).toBeInTheDocument();
      expect(within(d).getByText("vendredi 30 octobre 2026 à 15:30")).toBeInTheDocument();
      expect(within(d).getByText(/15 000 FCFA/)).toBeInTheDocument();
      expect(within(d).getByText("Confirmée")).toBeInTheDocument();
      expect(within(d).getByText(/25 oct\. 2026/)).toBeInTheDocument();
      expect(within(d).queryByRole("button", { name: /Annuler|Modifier|Supprimer|Changer/ })).not.toBeInTheDocument();
      fireEvent.click(within(d).getByRole("button", { name: "Fermer" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("copier la référence : presse-papiers appelé, retour visuel accessible", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
      mocks.listAdminBookings.mockResolvedValue([row]);
      setup(); await screen.findByText("DLD-ABCDEF1234");
      fireEvent.click(screen.getByRole("button", { name: "Copier la référence DLD-ABCDEF1234" }));
      expect(writeText).toHaveBeenCalledWith("DLD-ABCDEF1234");
      expect(await screen.findByRole("button", { name: "Référence DLD-ABCDEF1234 copiée" })).toBeInTheDocument();
      vi.unstubAllGlobals();
    });

    it("« Actualiser » relit les réservations une seule fois", async () => {
      mocks.listAdminBookings.mockResolvedValue([row]);
      setup(); await screen.findByText("DLD-ABCDEF1234");
      await waitFor(() => expect(screen.getByRole("button", { name: "Actualiser les réservations" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Actualiser les réservations" }));
      await waitFor(() => expect(mocks.listAdminBookings).toHaveBeenCalledTimes(2));
    });

    it("aucune action sans comportement réel : ni création, ni annulation, ni changement de statut", async () => {
      mocks.listAdminBookings.mockResolvedValue([row]);
      setup(); await screen.findByText("DLD-ABCDEF1234");
      expect(screen.queryByRole("button", { name: /Nouvelle réservation|Annuler|Modifier|Confirmer/ })).not.toBeInTheDocument();
    });
  });

  describe("états", () => {
    it("aucune réservation enregistrée : message adapté, sans bouton de création", async () => {
      mocks.listAdminBookings.mockResolvedValue([]);
      setup();
      expect(await screen.findByText("Aucune réservation enregistrée")).toBeInTheDocument();
      expect(screen.queryByText("Source de données non connectée")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Nouvelle|Créer|Ajouter/ })).not.toBeInTheDocument();
    });

    it("erreur serveur : « Chargement impossible » avec Réessayer, jamais de données fictives", async () => {
      mocks.listAdminBookings.mockRejectedValueOnce(new AdminError("server", "Lecture des réservations impossible.")).mockResolvedValue([row]);
      setup();
      expect(await screen.findByText("Chargement impossible", { selector: "h3" })).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByText("Aucune réservation enregistrée")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Réessayer/ }));
      expect(await screen.findByText("DLD-ABCDEF1234")).toBeInTheDocument();
    });

    it("erreur d'autorisation : « Accès refusé »", async () => {
      mocks.listAdminBookings.mockRejectedValue(new AdminError("forbidden", "Accès refusé."));
      setup();
      expect(await screen.findByText("Accès refusé")).toBeInTheDocument();
      expect(screen.queryByText("Aucune réservation enregistrée")).not.toBeInTheDocument();
    });

    it("erreur réseau : « Connexion impossible »", async () => {
      mocks.listAdminBookings.mockRejectedValue(new AdminError("network", "Connexion impossible."));
      setup();
      expect(await screen.findByText("Connexion impossible")).toBeInTheDocument();
      expect(screen.queryByText("Aucune réservation enregistrée")).not.toBeInTheDocument();
    });
  });

  describe("mobile", () => {
    it("cartes compactes avec les mêmes informations : nom et téléphone séparés, date, prix, statut, référence, détails", async () => {
      mocks.mobile.value = true;
      mocks.listAdminBookings.mockResolvedValue(REF);
      setup();
      await screen.findByText("DLD-7B3DCFE01D");
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      const card = screen.getByText("DLD-7B3DCFE01D").closest("li") as HTMLElement;
      expect(within(card).getByText("mahama bamba").tagName).toBe("P");
      expect(within(card).getByText("+2250758483726").tagName).toBe("P");
      expect(within(card).getByText("30 oct. 2026")).toBeInTheDocument();
      expect(within(card).getByText("15 000 FCFA")).toBeInTheDocument();
      expect(within(card).getByText("Confirmée")).toBeInTheDocument();
      fireEvent.click(within(card).getByRole("button", { name: /Détails/ }));
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });
  });
});
