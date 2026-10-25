import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), toggle: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
}));
vi.mock("@/components/app", () => ({
  Img: ({ src, alt }: { src: string; alt?: string }) => <img src={src} alt={alt ?? ""} />,
}));
vi.mock("@/lib/admin-products", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-products")>()),
  listAdminProducts: mocks.list,
  createAdminProduct: mocks.create,
  updateAdminProduct: mocks.update,
  setProductActive: mocks.toggle,
}));

import { AdminError } from "@/lib/admin-api";
import { CatalogueNotInstalledError, ProductActionError, type AdminProduct } from "@/lib/admin-products";
import { Route } from "@/routes/admin.produits";

const product = (o: Partial<AdminProduct> = {}): AdminProduct => ({
  id: "savon-melisse-2en1", sku: "DAL-SAV-MEL", name: "Savon Mélisse 2 en 1", category: "Nettoyants", shortDescription: "Résumé", description: "Texte",
  features: ["Format pot"], usageTips: null, volume: null, imageUrl: "https://x/storage/v1/object/public/catalog-images/products/savon/1.webp",
  price: 6000, costPrice: null, stock: 20, lowStockThreshold: 3, active: true, isDemo: false, createdAt: "", updatedAt: "", ...o,
});
const SAVON = product();
const MOUSSE = product({ id: "mousse-nettoyante", sku: "DAL-MOU-NET", name: "Mousse nettoyante", category: "Soins du visage", price: 5000, costPrice: 2000, stock: 0, imageUrl: null });
const GEL = product({ id: "gel-douche", sku: "DAL-GEL-DOU", name: "Gel douche", category: "Soins du corps", price: 5500, stock: 12, active: false });

const Page = (Route as unknown as { component: () => ReactElement }).component;
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Page /></QueryClientProvider>);
}
const fill = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const row = (name: string) => screen.getByText(name).closest("tr")!;

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue([SAVON, MOUSSE, GEL]);
  mocks.create.mockReset().mockResolvedValue("x");
  mocks.update.mockReset().mockResolvedValue(undefined);
  mocks.toggle.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("liste des produits", () => {
  it("affiche photo, nom, catégorie, prix FCFA, coût (ou « Inconnu »), stock et statut ; statistiques issues des données chargées", async () => {
    show();
    expect(await screen.findByText("Savon Mélisse 2 en 1")).toBeInTheDocument();

    const savon = within(row("Savon Mélisse 2 en 1"));
    expect(row("Savon Mélisse 2 en 1").querySelector("img")).toHaveAttribute("src", SAVON.imageUrl);
    expect(savon.getByText("Nettoyants")).toBeInTheDocument();
    expect(savon.getByText("6 000 FCFA")).toBeInTheDocument();
    expect(savon.getByText("Inconnu")).toBeInTheDocument();
    expect(savon.getByText("Disponible")).toBeInTheDocument();
    expect(within(row("Mousse nettoyante")).getByText("2 000 FCFA")).toBeInTheDocument();

    const stat = (label: string) => within(screen.getByLabelText("Statistiques du catalogue")).getByText(label).parentElement!;
    expect(within(stat("Produits")).getByText("3")).toBeInTheDocument();
    expect(within(stat("Produits actifs")).getByText("2")).toBeInTheDocument();
    expect(within(stat("Produits indisponibles")).getByText("2")).toBeInTheDocument(); // stock nul + inactif
  });

  it("stock nul : « Rupture » et indisponible, sans être confondu avec un produit inactif", async () => {
    show();
    await screen.findByText("Mousse nettoyante");
    expect(within(row("Mousse nettoyante")).getByText("Rupture")).toBeInTheDocument();
    expect(within(row("Mousse nettoyante")).getByText("0")).toBeInTheDocument();
    expect(within(row("Gel douche")).getByText("Inactif")).toBeInTheDocument();
    expect(row("Mousse nettoyante")).toHaveAttribute("data-available", "false");
    expect(row("Savon Mélisse 2 en 1")).toHaveAttribute("data-available", "true");
  });

  it("recherche par nom (sans accents ni casse), filtre catégorie et filtre statut", async () => {
    show();
    await screen.findByText("Savon Mélisse 2 en 1");

    fireEvent.change(screen.getByLabelText("Rechercher un produit"), { target: { value: "melisse" } });
    expect(screen.getByText("Savon Mélisse 2 en 1")).toBeInTheDocument();
    expect(screen.queryByText("Mousse nettoyante")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Rechercher un produit"), { target: { value: "" } });

    fireEvent.change(screen.getByLabelText("Filtrer par catégorie"), { target: { value: "Soins du visage" } });
    expect(screen.getByText("Mousse nettoyante")).toBeInTheDocument();
    expect(screen.queryByText("Gel douche")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrer par catégorie"), { target: { value: "all" } });

    fireEvent.change(screen.getByLabelText("Filtrer par statut"), { target: { value: "inactive" } });
    expect(screen.getByText("Gel douche")).toBeInTheDocument();
    expect(screen.queryByText("Savon Mélisse 2 en 1")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrer par statut"), { target: { value: "active" } });
    expect(screen.queryByText("Gel douche")).not.toBeInTheDocument();
    expect(screen.getByText("Mousse nettoyante")).toBeInTheDocument();
  });

  it("aucun résultat de recherche : message dédié", async () => {
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    fireEvent.change(screen.getByLabelText("Rechercher un produit"), { target: { value: "zzz" } });
    expect(screen.getByText("Aucun résultat")).toBeInTheDocument();
  });

  it("chargement : squelette, aucune statistique affichée", () => {
    mocks.list.mockReturnValue(new Promise(() => {}));
    show();
    expect(screen.getByLabelText("Chargement")).toBeInTheDocument();
    expect(screen.queryByText("Produits actifs")).not.toBeInTheDocument();
  });

  it("liste vide : message d'invitation, statistiques à zéro (données réelles)", async () => {
    mocks.list.mockResolvedValue([]);
    show();
    expect(await screen.findByText("Aucun produit")).toBeInTheDocument();
    const stats = within(screen.getByLabelText("Statistiques du catalogue"));
    expect(stats.getAllByText("0")).toHaveLength(3);
  });

  it("erreur : message et bouton Réessayer, jamais présentée comme une liste vide", async () => {
    mocks.list.mockRejectedValueOnce(new AdminError("server", "Lecture des produits impossible."));
    show();
    expect(await screen.findByText("Chargement impossible")).toBeInTheDocument();
    expect(screen.queryByText("Aucun produit")).not.toBeInTheDocument();
    expect(screen.queryByText("Produits actifs")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Savon Mélisse 2 en 1")).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("migration non appliquée : message explicite et exploitable", async () => {
    mocks.list.mockRejectedValue(new CatalogueNotInstalledError());
    show();
    expect(await screen.findByText("Catalogue non installé")).toBeInTheDocument();
    expect(screen.getByText(/20261026000000_products_catalog\.sql/)).toBeInTheDocument();
  });

  it("refus d'autorisation : « Accès refusé »", async () => {
    mocks.list.mockRejectedValue(new AdminError("forbidden", "Accès refusé."));
    show();
    expect(await screen.findByText("Accès refusé")).toBeInTheDocument();
  });
});

describe("ajout d'un produit", () => {
  const open = async () => {
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("button", { name: /Ajouter un produit/ }));
    return screen.findByRole("dialog");
  };
  const fillValid = () => {
    fill(/^Nom/, "Crème Hydratante");
    fill(/^Référence/, "dal-cre-hyd");
    fill(/^Catégorie/, "Hydratation");
    fill(/^Prix de vente/, "7 500");
    fill(/^Stock initial/, "0");
  };

  it("formulaire vide : erreurs de validation, aucun appel à la base", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Ajouter le produit" }));

    expect(await screen.findByText(/Indiquez le nom du produit/)).toBeInTheDocument();
    expect(screen.getByText(/Référence invalide/)).toBeInTheDocument();
    expect(screen.getByText("Choisissez une catégorie.")).toBeInTheDocument();
    expect(screen.getByText("Prix de vente : indiquez une valeur.")).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("valeurs hors limites : prix négatif, décimal ou trop grand refusés", async () => {
    await open();
    fillValid();
    fill(/^Prix de vente/, "-5");
    fireEvent.click(screen.getByRole("button", { name: "Ajouter le produit" }));
    expect(await screen.findByText(/Prix de vente : nombre entier positif/)).toBeInTheDocument();
    fill(/^Prix de vente/, "999999999");
    fireEvent.click(screen.getByRole("button", { name: "Ajouter le produit" }));
    expect(await screen.findByText(/Prix de vente : 100 000 000 au maximum/)).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("création : identifiant tiré du nom, stock initial 0 accepté, liste rechargée, message de réussite", async () => {
    await open();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Ajouter le produit" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      id: "creme-hydratante", sku: "DAL-CRE-HYD", name: "Crème Hydratante", category: "Hydratation", price: 7500, costPrice: null, initialQty: 0, active: true,
    }));
    expect(await screen.findByText(/« Crème Hydratante » a été ajouté au catalogue/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2)); // invalidation après mutation
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("erreur métier de la base (référence déjà prise) : message exact sous le champ, formulaire conservé", async () => {
    mocks.create.mockRejectedValue(new ProductActionError("sku_taken", "Cette référence existe déjà."));
    await open();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Ajouter le produit" }));

    expect(await screen.findByText("Cette référence existe déjà.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nom/)).toHaveValue("Crème Hydratante");
    expect(mocks.list).toHaveBeenCalledTimes(1); // pas de rechargement : rien n'a changé
  });

  it("autre erreur (refus d'autorisation) : message affiché dans le formulaire, jamais un succès", async () => {
    mocks.create.mockRejectedValue(new AdminError("forbidden", "Accès refusé."));
    await open();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Ajouter le produit" }));

    expect(await screen.findByText("Accès refusé.")).toBeInTheDocument();
    expect(screen.queryByText(/a été ajouté/)).not.toBeInTheDocument();
  });

  it("double clic : une seule création, bouton désactivé pendant l'envoi", async () => {
    let done!: (v: string) => void;
    mocks.create.mockReturnValue(new Promise<string>((r) => { done = r; }));
    await open();
    fillValid();
    const submit = screen.getByRole("button", { name: "Ajouter le produit" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(await screen.findByRole("button", { name: "Enregistrement…" })).toBeDisabled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    done("x");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});

describe("modification d'un produit", () => {
  const openEdit = async () => {
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("button", { name: "Modifier Savon Mélisse 2 en 1" }));
    return screen.findByRole("dialog");
  };

  it("formulaire prérempli ; stock en lecture seule avec explication ; pas de champ « stock initial »", async () => {
    await openEdit();
    expect(screen.getByLabelText(/^Nom/)).toHaveValue("Savon Mélisse 2 en 1");
    expect(screen.getByLabelText(/^Référence/)).toHaveValue("DAL-SAV-MEL");
    expect(screen.getByLabelText("Stock actuel")).toHaveValue("20");
    expect(screen.getByLabelText("Stock actuel")).toHaveAttribute("readonly");
    expect(screen.getByText(/Le stock n'est pas modifiable ici/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Stock initial/)).not.toBeInTheDocument();
  });

  it("enregistrement : admin_update_product reçoit les champs de la fiche, sans photo ni stock ; la photo reste affichée après rechargement", async () => {
    await openEdit();
    fill(/^Prix de vente/, "6500");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    const [id, input] = mocks.update.mock.calls[0]!;
    expect(id).toBe("savon-melisse-2en1");
    expect(input).toMatchObject({ sku: "DAL-SAV-MEL", name: "Savon Mélisse 2 en 1", price: 6500, costPrice: null, features: ["Format pot"], active: true });
    expect(input).not.toHaveProperty("imageUrl");
    expect(input).not.toHaveProperty("initialQty");
    expect(input).not.toHaveProperty("stock");
    expect(mocks.create).not.toHaveBeenCalled();

    expect(await screen.findByText(/« Savon Mélisse 2 en 1 » a été modifié/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(row("Savon Mélisse 2 en 1").querySelector("img")).toHaveAttribute("src", SAVON.imageUrl);
  });

  it("coût d'achat vidé = coût inconnu (null) ; coût existant conservé s'il n'est pas touché", async () => {
    show();
    await screen.findByText("Mousse nettoyante");
    fireEvent.click(screen.getByRole("button", { name: "Modifier Mousse nettoyante" }));
    await screen.findByRole("dialog");
    expect(screen.getByLabelText(/^Coût d'achat/)).toHaveValue("2000");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0]![1]).toMatchObject({ costPrice: 2000 });
  });

  it("erreur métier : message de la base, aucune fausse réussite", async () => {
    mocks.update.mockRejectedValue(new ProductActionError("invalid_input", "Prix de vente invalide."));
    await openEdit();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Prix de vente invalide.")).toBeInTheDocument();
    expect(screen.queryByText(/a été modifié/)).not.toBeInTheDocument();
  });
});

describe("désactivation et réactivation (jamais de suppression)", () => {
  it("désactiver demande une confirmation ; « Annuler » n'appelle rien", async () => {
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("button", { name: "Désactiver Savon Mélisse 2 en 1" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Il n'est pas supprimé/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuler" }));
    expect(mocks.toggle).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByText("Savon Mélisse 2 en 1")).toBeInTheDocument();
  });

  it("confirmation : setProductActive(id, false), liste rechargée, produit toujours présent dans le tableau", async () => {
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("button", { name: "Désactiver Savon Mélisse 2 en 1" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Désactiver" }));

    await waitFor(() => expect(mocks.toggle).toHaveBeenCalledWith("savon-melisse-2en1", false));
    expect(await screen.findByText(/« Savon Mélisse 2 en 1 » est désactivé/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Savon Mélisse 2 en 1")).toBeInTheDocument();
  });

  it("réactiver est immédiat (pas de confirmation) : setProductActive(id, true)", async () => {
    show();
    await screen.findByText("Gel douche");
    fireEvent.click(screen.getByRole("button", { name: "Réactiver Gel douche" }));

    await waitFor(() => expect(mocks.toggle).toHaveBeenCalledWith("gel-douche", true));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(await screen.findByText(/« Gel douche » est réactivé/)).toBeInTheDocument();
  });

  it("échec : message d'erreur affiché, rien n'est présenté comme réussi", async () => {
    mocks.toggle.mockRejectedValue(new ProductActionError("not_found", "Produit introuvable."));
    show();
    await screen.findByText("Gel douche");
    fireEvent.click(screen.getByRole("button", { name: "Réactiver Gel douche" }));
    expect(await screen.findByText("Produit introuvable.")).toBeInTheDocument();
    expect(screen.queryByText(/est réactivé/)).not.toBeInTheDocument();
  });

  it("aucune action « Supprimer » n'existe sur la page", async () => {
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    expect(screen.queryByRole("button", { name: /supprimer/i })).not.toBeInTheDocument();
  });
});

describe("photo depuis la liste", () => {
  it("chaque produit a un bouton Photo ; le dialogue montre la photo actuelle et propose de la remplacer", async () => {
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("button", { name: "Photo de Savon Mélisse 2 en 1" }));

    expect(await screen.findByRole("button", { name: "Remplacer la photo" })).toBeInTheDocument();
    expect(screen.getByAltText("Aperçu : Savon Mélisse 2 en 1")).toHaveAttribute("src", SAVON.imageUrl);
    expect(screen.getByRole("button", { name: "Supprimer la photo" })).toBeInTheDocument();
  });
});
