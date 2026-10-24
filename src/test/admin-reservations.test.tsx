import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// L'accès à la base est simulé : ces tests vérifient les états de la page, pas Supabase ni la RLS.
const mocks = vi.hoisted(() => ({ listAdminBookings: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
}));
vi.mock("@/lib/admin-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-api")>()),
  listAdminBookings: mocks.listAdminBookings,
}));

import { Route } from "@/routes/admin.reservations";
import { AdminError } from "@/lib/admin-api";

const Page = (Route as unknown as { component: () => ReactElement }).component;

const row = {
  ref: "DLD-ABCDEF1234", name: "Awa Koné", phone: "07 00 00 00 00", phoneKey: "0700000000", serviceName: "Massage dos et nuque",
  date: "2030-01-15", slot: "09:00", status: "confirmed" as const, price: 10000, createdAt: "2030-01-01T00:00:00Z",
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
}

describe("/admin/reservations", () => {
  beforeEach(() => {
    mocks.listAdminBookings.mockReset();
  });
  afterEach(cleanup);

  it("affiche un chargement avant la réponse, puis les réservations réelles", async () => {
    mocks.listAdminBookings.mockResolvedValue([row]);
    setup();
    expect(screen.getByLabelText("Chargement")).toBeInTheDocument();

    expect(await screen.findByText("DLD-ABCDEF1234")).toBeInTheDocument();
    expect(screen.getByText("Awa Koné")).toBeInTheDocument();
    expect(screen.getByText("Massage dos et nuque")).toBeInTheDocument();
    expect(screen.getByText("2030-01-15 · 09:00")).toBeInTheDocument();
    expect(screen.getByText("Confirmée")).toBeInTheDocument();
    expect(screen.queryByText("Source de données non connectée")).not.toBeInTheDocument();
  });

  it("liste vide : « Aucun élément », jamais « Source de données non connectée »", async () => {
    mocks.listAdminBookings.mockResolvedValue([]);
    setup();

    expect(await screen.findByText("Aucun élément")).toBeInTheDocument();
    expect(screen.queryByText("Source de données non connectée")).not.toBeInTheDocument();
  });

  it("recherche conservée", async () => {
    mocks.listAdminBookings.mockResolvedValue([row, { ...row, ref: "DLD-0000000000", name: "Fanta", status: "cancelled" as const }]);
    setup();
    await screen.findByText("DLD-ABCDEF1234");

    fireEvent.change(screen.getByLabelText("Rechercher une réservation"), { target: { value: "fanta" } });
    expect(screen.queryByText("DLD-ABCDEF1234")).not.toBeInTheDocument();
    expect(screen.getByText("DLD-0000000000")).toBeInTheDocument();
  });

  it("erreur serveur : « Chargement impossible » avec Réessayer, pas « Aucun élément »", async () => {
    mocks.listAdminBookings.mockRejectedValue(new AdminError("server", "Lecture des réservations impossible."));
    setup();

    expect(await screen.findByText("Chargement impossible")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Réessayer/ })).toBeInTheDocument();
    expect(screen.queryByText("Aucun élément")).not.toBeInTheDocument();
  });

  it("erreur d'autorisation : « Accès refusé », pas « Aucun élément »", async () => {
    mocks.listAdminBookings.mockRejectedValue(new AdminError("forbidden", "Accès refusé."));
    setup();

    expect(await screen.findByText("Accès refusé")).toBeInTheDocument();
    expect(screen.queryByText("Aucun élément")).not.toBeInTheDocument();
  });

  it("erreur réseau : « Connexion impossible »", async () => {
    mocks.listAdminBookings.mockRejectedValue(new AdminError("network", "Connexion impossible."));
    setup();

    expect(await screen.findByText("Connexion impossible")).toBeInTheDocument();
    expect(screen.queryByText("Aucun élément")).not.toBeInTheDocument();
  });
});
