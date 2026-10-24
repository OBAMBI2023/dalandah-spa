import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  adminEmail: vi.fn(),
  adminSignIn: vi.fn(),
  adminSignOut: vi.fn(),
  hasAdminRole: vi.fn(),
}));

vi.mock("@/lib/admin-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-api")>()),
  get adminConfigured() {
    return mocks.configured;
  },
  adminEmail: mocks.adminEmail,
  adminSignIn: mocks.adminSignIn,
  adminSignOut: mocks.adminSignOut,
  hasAdminRole: mocks.hasAdminRole,
}));

import { AdminGate } from "@/components/admin-gate";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AdminGate>
        <p>Contenu protégé</p>
      </AdminGate>
    </QueryClientProvider>,
  );
}

describe("AdminGate", () => {
  beforeEach(() => {
    mocks.configured = true;
    mocks.adminEmail.mockReset().mockResolvedValue("admin@example.com");
    mocks.adminSignIn.mockReset();
    mocks.adminSignOut.mockReset().mockResolvedValue(undefined);
    mocks.hasAdminRole.mockReset().mockResolvedValue(true);
  });
  afterEach(cleanup);

  it("compte administrateur : affiche le contenu et l'e-mail", async () => {
    setup();

    expect(await screen.findByText("Contenu protégé")).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
  });

  it("sans session : formulaire de connexion, contenu masqué, rôle non interrogé", async () => {
    mocks.adminEmail.mockResolvedValue(null);
    setup();

    expect(await screen.findByText("Connexion administrateur")).toBeInTheDocument();
    expect(screen.queryByText("Contenu protégé")).not.toBeInTheDocument();
    expect(mocks.hasAdminRole).not.toHaveBeenCalled();
  });

  it("mauvais identifiants : message générique", async () => {
    mocks.adminEmail.mockResolvedValue(null);
    mocks.adminSignIn.mockResolvedValue({ ok: false, error: "E-mail ou mot de passe incorrect." });
    setup();
    await screen.findByText("Connexion administrateur");

    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: "x@y.fr" } });
    fireEvent.change(screen.getByLabelText(/Mot de passe/), { target: { value: "mauvais" } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("E-mail ou mot de passe incorrect.");
    expect(screen.queryByText("Contenu protégé")).not.toBeInTheDocument();
  });

  it("compte sans rôle administrateur : accès refusé, contenu masqué", async () => {
    mocks.hasAdminRole.mockResolvedValue(false);
    setup();

    expect(await screen.findByText("Accès refusé")).toBeInTheDocument();
    expect(screen.queryByText("Contenu protégé")).not.toBeInTheDocument();
  });

  it("erreur lors de la lecture du rôle : erreur, jamais un accès accordé", async () => {
    mocks.hasAdminRole.mockRejectedValue(new Error("réseau"));
    setup();

    expect(await screen.findByText("Chargement impossible")).toBeInTheDocument();
    expect(screen.queryByText("Contenu protégé")).not.toBeInTheDocument();
  });

  it("sans variables Supabase (mode local) : « Base de données non configurée », contenu masqué", async () => {
    mocks.configured = false;
    setup();

    expect(await screen.findByText("Base de données non configurée")).toBeInTheDocument();
    expect(screen.queryByText("Contenu protégé")).not.toBeInTheDocument();
    expect(mocks.adminEmail).not.toHaveBeenCalled();
  });

  it("déconnexion", async () => {
    setup();
    await screen.findByText("Contenu protégé");
    fireEvent.click(screen.getByRole("button", { name: /Se déconnecter/ }));

    expect(mocks.adminSignOut).toHaveBeenCalledTimes(1);
  });
});
