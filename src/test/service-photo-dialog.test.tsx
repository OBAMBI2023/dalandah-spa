import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn() }));

vi.mock("@/components/app", () => ({
  Img: ({ src, alt }: { src: string; alt?: string }) => <img src={src} alt={alt} />,
}));
vi.mock("@/lib/admin-images", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-images")>()),
  uploadServiceImage: mocks.upload,
  removeServiceImage: mocks.remove,
}));

import { ServicePhotoDialog } from "@/components/service-photo-dialog";
import type { AdminService } from "@/lib/admin-api";

const service = (imageUrl: string | null): AdminService => ({
  id: "massage-dos", name: "Massage dos et nuque", category: "massage", description: "d", durationLabel: "30 min", durationMin: 30,
  price: 10000, active: true, isDemo: true, imageUrl,
});
const photo = (name = "p.jpg", type = "image/jpeg") => new File([new Uint8Array(2000)], name, { type });

function open(s: AdminService) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ServicePhotoDialog service={s} fallbackImage="/default.jpg" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Photo de Massage dos et nuque/ }));
}
const choose = (f: File) => fireEvent.change(screen.getByLabelText("Choisir une photo"), { target: { files: [f] } });

describe("dialogue photo d'une prestation", () => {
  beforeEach(() => {
    mocks.upload.mockReset();
    mocks.remove.mockReset();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:apercu"), revokeObjectURL: vi.fn() }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sans photo : « Importer une photo », image par défaut, pas de bouton Supprimer", async () => {
    open(service(null));

    expect(await screen.findByRole("button", { name: "Importer une photo" })).toBeInTheDocument();
    expect(screen.getByAltText("Aperçu : Massage dos et nuque")).toHaveAttribute("src", "/default.jpg");
    expect(screen.getByText(/l'image par défaut est affichée/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Supprimer la photo" })).not.toBeInTheDocument();
  });

  it("choix d'un fichier : aperçu avant enregistrement, rien n'est envoyé tant qu'on n'a pas confirmé", async () => {
    open(service(null));
    await screen.findByRole("button", { name: "Importer une photo" });
    choose(photo());

    expect(screen.getByAltText("Aperçu : Massage dos et nuque")).toHaveAttribute("src", "blob:apercu");
    expect(screen.getByText(/n'est pas encore enregistrée/)).toBeInTheDocument();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("enregistrement : progression, appel avec la prestation et la photo actuelle, message de réussite", async () => {
    let done!: (v: string) => void;
    mocks.upload.mockReturnValue(new Promise<string>((r) => { done = r; }));
    open(service("https://x/storage/v1/object/public/catalog-images/services/massage-dos/1-old.webp"));
    await screen.findByRole("button", { name: "Remplacer la photo" });
    choose(photo());
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la photo" }));

    expect(await screen.findByRole("progressbar", { name: "Téléversement en cours" })).toBeInTheDocument();
    expect(mocks.upload).toHaveBeenCalledWith("massage-dos", expect.any(File), expect.stringContaining("1-old.webp"));
    done("https://x/new.webp");
    expect(await screen.findByText(/Photo enregistrée/)).toBeInTheDocument();
  });

  it("erreur d'envoi : message explicite, la photo choisie reste disponible pour réessayer", async () => {
    mocks.upload.mockRejectedValue(new Error("Connexion impossible. Vérifiez votre réseau et réessayez."));
    open(service(null));
    await screen.findByRole("button", { name: "Importer une photo" });
    choose(photo());
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la photo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Connexion impossible");
    expect(screen.getByRole("button", { name: "Enregistrer la photo" })).toBeEnabled();
  });

  it("format refusé : message clair, aucun aperçu ni bouton d'enregistrement", async () => {
    open(service(null));
    await screen.findByRole("button", { name: "Importer une photo" });
    choose(photo("doc.pdf", "application/pdf"));

    expect(await screen.findByRole("alert")).toHaveTextContent("JPEG, PNG ou WebP");
    expect(screen.queryByRole("button", { name: "Enregistrer la photo" })).not.toBeInTheDocument();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("suppression : demande de confirmation, « Non, garder » n'appelle rien, « Oui » supprime", async () => {
    const url = "https://x/storage/v1/object/public/catalog-images/services/massage-dos/1-old.webp";
    mocks.remove.mockResolvedValue(undefined);
    open(service(url));
    fireEvent.click(await screen.findByRole("button", { name: "Supprimer la photo" }));

    expect(screen.getByRole("alertdialog", { name: "Confirmer la suppression" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Non, garder" }));
    expect(mocks.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Supprimer la photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Oui, supprimer" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("massage-dos", url));
    expect(await screen.findByText(/Photo supprimée/)).toBeInTheDocument();
  });
});
