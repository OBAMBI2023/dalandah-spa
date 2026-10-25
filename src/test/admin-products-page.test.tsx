import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), toggle: vi.fn(), upload: vi.fn(), removeImg: vi.fn(), listCats: vi.fn(), createCat: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
}));
vi.mock("@/components/app", () => ({
  Img: ({ src, alt }: { src: string; alt?: string }) => <img src={src} alt={alt ?? ""} />,
}));
vi.mock("@/lib/admin-products", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-products")>()),
  listAdminProducts: mocks.list,
  createProductAuto: mocks.create,
  updateAdminProduct: mocks.update,
  setProductActive: mocks.toggle,
}));

vi.mock("@/lib/admin-images", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-images")>()),
  uploadProductImage: mocks.upload,
  removeProductImage: mocks.removeImg,
}));

vi.mock("@/lib/admin-categories", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-categories")>()),
  listAdminCategories: mocks.listCats,
  createAdminCategory: mocks.createCat,
}));

import { AdminError } from "@/lib/admin-api";
import { CategoriesNotInstalledError } from "@/lib/admin-categories";
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

const STATIC_CATS = ["Soins du visage", "Nettoyants", "Hydratation", "Sérums et soins ciblés", "Soins du corps", "Coffrets beauté", "Routines beauté"];

beforeEach(() => {
  mocks.listCats.mockReset().mockResolvedValue(STATIC_CATS);
  mocks.createCat.mockReset().mockResolvedValue("Parfums d'ambiance");
  mocks.list.mockReset().mockResolvedValue([SAVON, MOUSSE, GEL]);
  mocks.create.mockReset().mockResolvedValue({ id: "creme-hydratante", sku: "DAL-CREME-HYDRATANTE" });
  mocks.update.mockReset().mockResolvedValue(undefined);
  mocks.toggle.mockReset().mockResolvedValue(undefined);
  mocks.upload.mockReset().mockResolvedValue("https://x/new.webp");
  mocks.removeImg.mockReset().mockResolvedValue(undefined);
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

    fireEvent.click(screen.getByRole("tab", { name: /Inactifs/ }));
    expect(screen.getByText("Gel douche")).toBeInTheDocument();
    expect(screen.queryByText("Savon Mélisse 2 en 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Actifs/ }));
    expect(screen.queryByText("Gel douche")).not.toBeInTheDocument();
    expect(screen.getByText("Mousse nettoyante")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Actifs/ })).toHaveAttribute("aria-selected", "true");
  });

  it("onglets de statut : effectifs réels (tous, actifs, inactifs)", async () => {
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    expect(screen.getByRole("tab", { name: "Tous 3" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Actifs 2" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Inactifs 1" })).toBeInTheDocument();
  });

  it("la référence est affichée sous le nom, le coût inconnu dans sa propre colonne", async () => {
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    const savon = within(row("Savon Mélisse 2 en 1"));
    expect(savon.getByText("DAL-SAV-MEL")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Coût d'achat" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Référence/ })).not.toBeInTheDocument();
  });

  it("aucun résultat de recherche : message dédié et réinitialisation des filtres", async () => {
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("tab", { name: /Inactifs/ }));
    fireEvent.change(screen.getByLabelText("Rechercher un produit"), { target: { value: "zzz" } });
    expect(screen.getByText("Aucun résultat")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Réinitialiser les filtres" }));
    expect(screen.getByLabelText("Rechercher un produit")).toHaveValue("");
    expect(screen.getByRole("tab", { name: /Tous/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Savon Mélisse 2 en 1")).toBeInTheDocument();
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
    expect(screen.getAllByRole("button", { name: /Ajouter un produit/ })).toHaveLength(2); // en-tête + invitation de l'état vide
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
    fill(/^Catégorie/, "Hydratation");
    fill(/^Prix de vente/, "7 500");
    fill(/^Stock initial/, "0");
  };
  const submitName = "Créer le produit";

  it("formulaire simplifié : titre, sous-titre, sections Photo / Informations / Prix et stock, boutons Annuler et Créer le produit", async () => {
    const d = await open();
    expect(within(d).getByRole("heading", { name: "Ajouter un produit" })).toBeInTheDocument();
    expect(within(d).getByText("Renseignez les informations essentielles de votre produit.")).toBeInTheDocument();
    expect(within(d).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Photo", "Informations", "Prix et stock", "Visibilité"]);
    expect(within(d).getByRole("button", { name: "Annuler" })).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: submitName })).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Ajouter une photo" })).toBeInTheDocument();
  });

  it("champs retirés : plus de résumé, caractéristiques, contenance ni conseils d'utilisation", async () => {
    await open();
    for (const label of [/Résumé/, /Caractéristiques/, /Contenance/, /Conseils/]) expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Nom du produit \*/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Description/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Coût d'achat/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Seuil d'alerte/)).toBeInTheDocument();
  });

  it("référence : non saisissable, « Générée après saisie du nom » tant que le nom est vide", async () => {
    await open();
    const ref = screen.getByLabelText("Référence produit");
    expect(ref).toHaveAttribute("readonly");
    expect(ref).toHaveValue("");
    expect(ref).toHaveAttribute("placeholder", "Générée après saisie du nom");
    expect(screen.getByText("Générée automatiquement à partir du nom du produit.")).toBeInTheDocument();
    fireEvent.change(ref, { target: { value: "SAISIE-MANUELLE" } });
    expect(ref).toHaveValue("");
  });

  it("référence : se met à jour à chaque modification du nom (accents, espaces, caractères spéciaux)", async () => {
    await open();
    const ref = screen.getByLabelText("Référence produit");
    fill(/^Nom/, "Crème Hydratante");
    expect(ref).toHaveValue("DAL-CREME-HYDRATANTE");
    fill(/^Nom/, "Savon Mélisse 2 en 1");
    expect(ref).toHaveValue("DAL-SAVON-MELISSE-2-EN-1");
    fill(/^Nom/, "Huile d'argan & karité !");
    expect(ref).toHaveValue("DAL-HUILE-D-ARGAN-KARITE");
    fill(/^Nom/, "");
    expect(ref).toHaveValue("");
  });

  it("référence déjà utilisée : variante -2 proposée et expliquée", async () => {
    mocks.list.mockResolvedValue([SAVON, product({ id: "gel-douche", sku: "DAL-GEL-DOUCHE", name: "Gel douche" })]);
    await open();
    fill(/^Nom/, "Gel douche");
    expect(screen.getByLabelText("Référence produit")).toHaveValue("DAL-GEL-DOUCHE-2");
    expect(screen.getByText(/Variante attribuée : « DAL-GEL-DOUCHE » existe déjà/)).toBeInTheDocument();
  });

  it("formulaire vide : erreurs sous les champs concernés, aucun appel à la base, aucune erreur de référence", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: submitName }));

    expect(await screen.findByText(/Indiquez le nom du produit/)).toBeInTheDocument();
    expect(screen.getByText("Choisissez une catégorie.")).toBeInTheDocument();
    expect(screen.getByText("Prix de vente : indiquez une valeur.")).toBeInTheDocument();
    expect(screen.queryByText(/Référence invalide/)).not.toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("prix négatif, décimal, non numérique ou trop grand : refusés", async () => {
    await open();
    fillValid();
    for (const [value, expected] of [["-5", /nombre entier positif/], ["12,5", /nombre entier positif/], ["abc", /nombre entier positif/], ["999999999", /100 000 000 au maximum/]] as const) {
      fill(/^Prix de vente/, value);
      fireEvent.click(screen.getByRole("button", { name: submitName }));
      expect(await screen.findByText(expected, { selector: "p[role=alert]" })).toBeInTheDocument();
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("stock initial invalide (vide, négatif, décimal) : refusé ; 0 est accepté", async () => {
    await open();
    fillValid();
    for (const value of ["", "-1", "2,5", "abc"]) {
      fill(/^Stock initial/, value);
      fireEvent.click(screen.getByRole("button", { name: submitName }));
      expect(await screen.findByText(/Stock initial : /, { selector: "p[role=alert]" })).toBeInTheDocument();
    }
    expect(mocks.create).not.toHaveBeenCalled();
    fill(/^Stock initial/, "0");
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  });

  it("création : valeurs envoyées, références existantes transmises pour éviter les doublons, liste rechargée, confirmation avec la référence", async () => {
    await open();
    fillValid();
    fill(/^Coût d'achat/, "3 000");
    fireEvent.click(screen.getByRole("button", { name: submitName }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const [input, existing] = mocks.create.mock.calls[0]!;
    expect(input).toMatchObject({ name: "Crème Hydratante", category: "Hydratation", price: 7500, costPrice: 3000, initialQty: 0, lowStockThreshold: 0, active: true, shortDescription: "", features: [], usageTips: null, volume: null });
    expect(existing).toEqual({ ids: ["savon-melisse-2en1", "mousse-nettoyante", "gel-douche"], skus: ["DAL-SAV-MEL", "DAL-MOU-NET", "DAL-GEL-DOU"] });
    expect(await screen.findByText(/« Crème Hydratante » a été ajouté au catalogue \(référence DAL-CREME-HYDRATANTE\)/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2)); // invalidation après mutation
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("coût d'achat vide : reste inconnu (null), jamais inventé", async () => {
    await open();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({ costPrice: null });
  });

  it("nom modifié avant l'enregistrement : c'est le dernier nom qui est envoyé", async () => {
    await open();
    fillValid();
    fill(/^Nom/, "Brouillon");
    fill(/^Nom/, "Sérum Éclat");
    expect(screen.getByLabelText("Référence produit")).toHaveValue("DAL-SERUM-ECLAT");
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({ name: "Sérum Éclat" });
  });

  it("interrupteur « Produit actif » : actif par défaut, description claire, désactivable", async () => {
    await open();
    const sw = screen.getByRole("switch", { name: /Produit actif/ });
    expect(sw).toBeChecked();
    expect(screen.getByText("Visible dans la boutique lorsqu'il est disponible en stock.")).toBeInTheDocument();
    fillValid();
    fireEvent.click(sw);
    expect(sw).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({ active: false });
  });

  it("échec réseau pendant la création : message clair, formulaire conservé, bouton de nouveau disponible, rien de rechargé", async () => {
    mocks.create.mockRejectedValue(new AdminError("network", "Connexion impossible. Vérifiez votre réseau et réessayez."));
    await open();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: submitName }));

    expect(await screen.findByText("Connexion impossible. Vérifiez votre réseau et réessayez.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nom/)).toHaveValue("Crème Hydratante");
    expect(screen.getByRole("button", { name: submitName })).toBeEnabled();
    expect(screen.queryByText(/a été ajouté/)).not.toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("refus d'autorisation : message affiché dans le formulaire, jamais un succès", async () => {
    mocks.create.mockRejectedValue(new AdminError("forbidden", "Accès refusé."));
    await open();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText("Accès refusé.")).toBeInTheDocument();
    expect(screen.queryByText(/a été ajouté/)).not.toBeInTheDocument();
  });

  const lost = (id = "creme-hydratante", sku = "DAL-CREME-HYDRATANTE") => async (_input: unknown, _existing: unknown, opts?: { onAttempt?: (a: { id: string; sku: string }) => void }) => {
    opts?.onAttempt?.({ id, sku }); // l'essai part…
    throw new AdminError("network", "Connexion impossible. Vérifiez votre réseau et réessayez."); // … mais la réponse ne revient jamais
  };

  it("réponse perdue puis nouvelle validation : si le produit a bien été créé, il est ADOPTÉ (aucune seconde création), la confirmation indique sa référence", async () => {
    mocks.create.mockReset().mockImplementationOnce(lost());
    await open();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText("Connexion impossible. Vérifiez votre réseau et réessayez.")).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledTimes(1); // pas de relecture tant qu'aucun essai n'a échoué

    // le serveur avait en réalité enregistré le produit : la relecture le montre
    mocks.list.mockResolvedValueOnce([SAVON, product({ id: "creme-hydratante", sku: "DAL-CREME-HYDRATANTE", name: "Crème Hydratante" })]);
    fireEvent.click(screen.getByRole("button", { name: submitName }));

    expect(await screen.findByText(/« Crème Hydratante » a été ajouté au catalogue \(référence DAL-CREME-HYDRATANTE\)/)).toBeInTheDocument();
    expect(mocks.create).toHaveBeenCalledTimes(1); // jamais de deuxième produit
  });

  it("réponse perdue, mais produit absent à la relecture : nouvelle création avec la liste à jour", async () => {
    mocks.create.mockReset().mockImplementationOnce(lost()).mockResolvedValueOnce({ id: "creme-hydratante-2", sku: "DAL-CREME-HYDRATANTE-2" });
    await open();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await screen.findByText("Connexion impossible. Vérifiez votre réseau et réessayez.");

    mocks.list.mockResolvedValueOnce([SAVON, product({ id: "creme-hydratante", sku: "DAL-CREME-HYDRATANTE", name: "Une autre crème" })]); // un autre produit a pris cette adresse
    fireEvent.click(screen.getByRole("button", { name: submitName }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1]![1]).toEqual({ ids: ["savon-melisse-2en1", "creme-hydratante"], skus: ["DAL-SAV-MEL", "DAL-CREME-HYDRATANTE"] });
    expect(await screen.findByText(/référence DAL-CREME-HYDRATANTE-2/)).toBeInTheDocument();
  });

  it("réponse perdue puis relecture impossible : rien n'est créé, l'erreur est affichée (mieux vaut un échec qu'un doublon)", async () => {
    mocks.create.mockReset().mockImplementationOnce(lost());
    await open();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await screen.findByText("Connexion impossible. Vérifiez votre réseau et réessayez.");

    mocks.list.mockRejectedValueOnce(new AdminError("network", "Connexion impossible. Vérifiez votre réseau et réessayez."));
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: submitName })).toBeEnabled();
  });

  it("refus de validation (aucune écriture) puis correction : nouvelle création normale", async () => {
    mocks.create.mockReset()
      .mockRejectedValueOnce(new ProductActionError("invalid_input", "Prix de vente invalide."))
      .mockResolvedValueOnce({ id: "creme-hydratante", sku: "DAL-CREME-HYDRATANTE" });
    await open();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await screen.findByText("Prix de vente invalide.");
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/a été ajouté au catalogue/)).toBeInTheDocument();
  });

  it("référence impossible à rendre unique : message de la base conservé, formulaire ouvert", async () => {
    mocks.create.mockRejectedValue(new ProductActionError("sku_taken", "Impossible de générer une référence unique pour ce produit. Réessayez dans un instant."));
    await open();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText(/Impossible de générer une référence unique/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("double clic : une seule création, bouton désactivé pendant l'envoi", async () => {
    let done!: (v: { id: string; sku: string }) => void;
    mocks.create.mockReturnValue(new Promise<{ id: string; sku: string }>((r) => { done = r; }));
    await open();
    fillValid();
    const submit = screen.getByRole("button", { name: submitName });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(await screen.findByRole("button", { name: "Création…" })).toBeDisabled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    done({ id: "creme-hydratante", sku: "DAL-CREME-HYDRATANTE" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("création sans photo : aucun envoi d'image ; l'image par défaut reste affichée", async () => {
    await open();
    fillValid();
    expect(screen.getByText("Aucune photo : l'image par défaut est affichée.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.removeImg).not.toHaveBeenCalled();
  });
});

describe("modification d'un produit", () => {
  const openEdit = async () => {
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("button", { name: "Modifier Savon Mélisse 2 en 1" }));
    return screen.findByRole("dialog");
  };

  it("référence permanente : affichée en lecture seule, elle ne suit pas le nom modifié et n'est pas renvoyée modifiée", async () => {
    await openEdit();
    const ref = screen.getByLabelText("Référence produit");
    expect(ref).toHaveValue("DAL-SAV-MEL");
    expect(ref).toHaveAttribute("readonly");
    expect(screen.getByText("Permanente : elle ne change plus après la création.")).toBeInTheDocument();
    fill(/^Nom/, "Un tout autre nom");
    expect(ref).toHaveValue("DAL-SAV-MEL");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0]![1]).toMatchObject({ sku: "DAL-SAV-MEL", name: "Un tout autre nom" });
  });

  it("champs retirés du formulaire mais conservés : résumé, caractéristiques, contenance et conseils sont renvoyés tels quels", async () => {
    mocks.list.mockResolvedValue([product({ shortDescription: "Résumé d'origine", features: ["A", "B"], usageTips: "Matin et soir", volume: "200 ml" })]);
    await openEdit();
    for (const label of [/Résumé/, /Caractéristiques/, /Contenance/, /Conseils/]) expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0]![1]).toMatchObject({ shortDescription: "Résumé d'origine", features: ["A", "B"], usageTips: "Matin et soir", volume: "200 ml" });
  });

  it("formulaire prérempli ; stock en lecture seule avec explication ; pas de champ « stock initial »", async () => {
    await openEdit();
    expect(screen.getByLabelText(/^Nom/)).toHaveValue("Savon Mélisse 2 en 1");
    expect(screen.getByLabelText("Référence produit")).toHaveValue("DAL-SAV-MEL");
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

describe("photo dans le formulaire (pas de dialogue séparé)", () => {
  const photo = (name = "p.jpg", type = "image/jpeg") => new File([new Uint8Array(2000)], name, { type });
  const choose = (f: File) => fireEvent.change(screen.getByLabelText("Choisir une photo"), { target: { files: [f] } });
  const openEdit = async (name: string) => {
    show();
    await screen.findByText(name);
    fireEvent.click(screen.getByRole("button", { name: `Modifier ${name}` }));
    await screen.findByRole("dialog");
  };

  beforeEach(() => { vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:apercu"), revokeObjectURL: vi.fn() })); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("plus de bouton photo séparé dans la liste : la photo se gère dans « Modifier »", async () => {
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    expect(screen.queryByRole("button", { name: /^Photo de / })).not.toBeInTheDocument();
  });

  it("produit avec photo : aperçu de la photo actuelle, « Remplacer » et « Retirer » dans le modal", async () => {
    await openEdit("Savon Mélisse 2 en 1");
    expect(screen.getByAltText(/Aperçu de la photo/)).toHaveAttribute("src", SAVON.imageUrl);
    expect(screen.getByText("Photo actuelle du produit.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remplacer la photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retirer la photo" })).toBeInTheDocument();
  });

  it("produit sans photo : « Ajouter une photo », pas de bouton Retirer", async () => {
    await openEdit("Mousse nettoyante");
    expect(screen.getByRole("button", { name: "Ajouter une photo" })).toBeInTheDocument();
    expect(screen.getByText(/Aucune photo : l'image par défaut/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retirer la photo" })).not.toBeInTheDocument();
  });

  it("modification sans toucher à la photo : ni envoi ni suppression (la photo n'est jamais effacée par une simple modification)", async () => {
    await openEdit("Savon Mélisse 2 en 1");
    fill(/^Prix de vente/, "6500");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.removeImg).not.toHaveBeenCalled();
  });

  it("nouvelle photo : aperçu immédiat, rien d'envoyé avant « Enregistrer », puis fiche PUIS photo", async () => {
    await openEdit("Savon Mélisse 2 en 1");
    const f = photo();
    choose(f);
    expect(screen.getByAltText(/Aperçu de la photo/)).toHaveAttribute("src", "blob:apercu");
    expect(screen.getByText(/Nouvelle photo : elle sera enregistrée avec le produit/)).toBeInTheDocument();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    expect(mocks.upload).toHaveBeenCalledWith("savon-melisse-2en1", f, SAVON.imageUrl);
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.upload.mock.invocationCallOrder[0]!);
    expect(await screen.findByText(/« Savon Mélisse 2 en 1 » a été modifié/)).toBeInTheDocument();
  });

  it("« Annuler le changement » abandonne la photo choisie : rien n'est envoyé", async () => {
    await openEdit("Savon Mélisse 2 en 1");
    choose(photo());
    fireEvent.click(screen.getByRole("button", { name: "Annuler le changement" }));
    expect(screen.getByAltText(/Aperçu de la photo/)).toHaveAttribute("src", SAVON.imageUrl);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("retirer la photo : marqué dans le formulaire, effectif seulement à l'enregistrement (après la fiche)", async () => {
    await openEdit("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("button", { name: "Retirer la photo" }));
    expect(screen.getByText("La photo sera retirée à l'enregistrement.")).toBeInTheDocument();
    expect(mocks.removeImg).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(mocks.removeImg).toHaveBeenCalledWith("savon-melisse-2en1", SAVON.imageUrl));
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.removeImg.mock.invocationCallOrder[0]!);
  });

  it("retrait annulable avant l'enregistrement : la photo est conservée", async () => {
    await openEdit("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("button", { name: "Retirer la photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Annuler le retrait" }));
    expect(screen.getByText("Photo actuelle du produit.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.removeImg).not.toHaveBeenCalled();
  });

  it("format refusé : message clair, aucune photo en attente", async () => {
    await openEdit("Savon Mélisse 2 en 1");
    choose(photo("doc.pdf", "application/pdf"));
    expect(await screen.findByText(/JPEG, PNG ou WebP/, { selector: "p[role=alert]" })).toBeInTheDocument();
    expect(screen.getByText("Photo actuelle du produit.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("la fiche échoue : la photo n'est pas envoyée", async () => {
    mocks.update.mockRejectedValue(new ProductActionError("invalid_input", "Prix de vente invalide."));
    await openEdit("Savon Mélisse 2 en 1");
    choose(photo());
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Prix de vente invalide.")).toBeInTheDocument();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("la photo échoue après une fiche enregistrée : le modal reste ouvert avec un message précis", async () => {
    mocks.upload.mockRejectedValue(new Error("Image trop lourde pour le serveur (5 Mo maximum)."));
    await openEdit("Savon Mélisse 2 en 1");
    choose(photo());
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText(/Les informations sont enregistrées, mais la photo ne l'est pas : Image trop lourde/)).toBeInTheDocument();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText(/a été modifié/)).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2)); // la fiche enregistrée est rechargée
  });

  it("création avec photo : le produit est créé, puis la photo envoyée avec son identifiant", async () => {
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("button", { name: /Ajouter un produit/ }));
    await screen.findByRole("dialog");
    fill(/^Nom/, "Crème Hydratante");
    fill(/^Catégorie/, "Hydratation");
    fill(/^Prix de vente/, "7 500");
    fill(/^Stock initial/, "3");
    const f = photo();
    choose(f);
    expect(screen.getByRole("button", { name: "Remplacer la photo" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Créer le produit" }));

    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith("creme-hydratante", f, null));
    expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.upload.mock.invocationCallOrder[0]!);
    expect(await screen.findByText(/« Crème Hydratante » a été ajouté au catalogue/)).toBeInTheDocument();
  });

  it("création : photo refusée par le serveur, produit tout de même créé et signalé", async () => {
    mocks.upload.mockRejectedValue(new Error("Accès refusé : ce compte n'est pas autorisé à modifier les photos."));
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("button", { name: /Ajouter un produit/ }));
    await screen.findByRole("dialog");
    fill(/^Nom/, "Crème Hydratante");
    fill(/^Catégorie/, "Hydratation");
    fill(/^Prix de vente/, "7 500");
    choose(photo());
    fireEvent.click(screen.getByRole("button", { name: "Créer le produit" }));

    expect(await screen.findByText(/a été ajouté, mais sa photo n'a pas pu être enregistrée : Accès refusé/)).toBeInTheDocument();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("création d'une catégorie depuis le formulaire produit", () => {
  const openProductForm = async () => {
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("button", { name: /Ajouter un produit/ }));
    await screen.findByRole("dialog");
    return screen.findByRole("button", { name: /Créer une catégorie/ });
  };
  const categoryDialog = () => screen.getByRole("dialog", { name: /Créer une catégorie/ });
  const typeCategory = (value: string) => fireEvent.change(screen.getByLabelText(/Nom de la catégorie/), { target: { value } });
  const select = () => screen.getByLabelText(/^Catégorie/) as HTMLSelectElement;
  const optionsOf = (el: HTMLSelectElement) => [...el.options].map((o) => o.textContent);

  it("action « Créer une catégorie » visible sous la liste déroulante, qui garde les catégories existantes", async () => {
    const action = await openProductForm();
    expect(action).toBeInTheDocument();
    expect(optionsOf(select())).toEqual(["Choisir…", ...STATIC_CATS]);
  });

  it("migration non appliquée : l'action n'est pas proposée, la liste du code reste utilisable", async () => {
    mocks.listCats.mockRejectedValue(new CategoriesNotInstalledError());
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("button", { name: /Ajouter un produit/ }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: /Créer une catégorie/ })).not.toBeInTheDocument();
    expect(optionsOf(select())).toEqual(["Choisir…", ...STATIC_CATS]);
  });

  it("migration non appliquée : aucun message d'erreur (ce n'est pas une panne), juste pas d'action de création", async () => {
    mocks.listCats.mockRejectedValue(new CategoriesNotInstalledError());
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("button", { name: /Ajouter un produit/ }));
    await screen.findByRole("dialog");
    expect(screen.queryByText(/n'ont pas pu être chargées/)).not.toBeInTheDocument();
  });

  it("erreur INATTENDUE (réseau) : signalée dans le formulaire avec « Réessayer », jamais masquée ; la réussite fait apparaître l'action", async () => {
    mocks.listCats.mockRejectedValue(new AdminError("network", "Connexion impossible. Vérifiez votre réseau et réessayez."));
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("button", { name: /Ajouter un produit/ }));
    await screen.findByRole("dialog");
    expect(await screen.findByText(/Les catégories enregistrées n'ont pas pu être chargées : Connexion impossible/)).toBeInTheDocument();
    expect(screen.getByText(/La liste affichée peut être incomplète/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Créer une catégorie/ })).not.toBeInTheDocument();
    expect(optionsOf(select())).toEqual(["Choisir…", ...STATIC_CATS]); // le formulaire reste utilisable

    mocks.listCats.mockResolvedValue(STATIC_CATS);
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByRole("button", { name: /Créer une catégorie/ })).toBeInTheDocument();
    expect(screen.queryByText(/n'ont pas pu être chargées/)).not.toBeInTheDocument();
  });

  it("erreur d'autorisation sur la liste : signalée aussi (message d'accès refusé)", async () => {
    mocks.listCats.mockRejectedValue(new AdminError("forbidden", "Accès refusé."));
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("button", { name: /Ajouter un produit/ }));
    await screen.findByRole("dialog");
    expect(await screen.findByText(/n'ont pas pu être chargées : Accès refusé\./)).toBeInTheDocument();
  });

  it("après application de la migration : rouvrir le formulaire suffit pour voir apparaître l'action, sans recharger la page", async () => {
    mocks.listCats.mockRejectedValue(new CategoriesNotInstalledError());
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("button", { name: /Ajouter un produit/ }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: /Créer une catégorie/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    mocks.listCats.mockResolvedValue(STATIC_CATS); // la migration vient d'être appliquée
    fireEvent.click(screen.getByRole("button", { name: /Ajouter un produit/ }));
    expect(await screen.findByRole("button", { name: /Créer une catégorie/ })).toBeInTheDocument();
  });

  it("petite fenêtre : champ « Nom de la catégorie * », boutons Annuler et Créer la catégorie, pas de description", async () => {
    fireEvent.click(await openProductForm());
    const d = categoryDialog();
    expect(within(d).getByLabelText("Nom de la catégorie *")).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Annuler" })).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Créer la catégorie" })).toBeInTheDocument();
    expect(within(d).queryByLabelText(/Description/)).not.toBeInTheDocument();
  });

  it("annulation : la fenêtre se ferme, rien n'est créé et le brouillon du produit est intact", async () => {
    const action = await openProductForm();
    fill(/^Nom du produit/, "Brume d'oreiller");
    fill(/^Catégorie/, "Hydratation");
    fill(/^Prix de vente/, "4500");
    fill(/^Description/, "Brouillon de description");
    fireEvent.click(action);
    typeCategory("Parfums");
    fireEvent.click(within(categoryDialog()).getByRole("button", { name: "Annuler" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Créer une catégorie/ })).not.toBeInTheDocument());
    expect(mocks.createCat).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Ajouter un produit" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nom du produit/)).toHaveValue("Brume d'oreiller");
    expect(select()).toHaveValue("Hydratation");
    expect(screen.getByLabelText(/^Prix de vente/)).toHaveValue("4500");
    expect(screen.getByLabelText(/^Description/)).toHaveValue("Brouillon de description");
    expect(mocks.create).not.toHaveBeenCalled();
    // le nom saisi avant l'annulation n'est pas gardé pour la prochaine ouverture
    fireEvent.click(screen.getByRole("button", { name: /Créer une catégorie/ }));
    expect(screen.getByLabelText(/Nom de la catégorie/)).toHaveValue("");
  });

  it("création : nom normalisé envoyé, liste actualisée sans recharger, catégorie sélectionnée automatiquement, brouillon conservé, produit non créé", async () => {
    mocks.listCats.mockResolvedValueOnce(STATIC_CATS).mockResolvedValue([...STATIC_CATS, "Parfums d'ambiance"]);
    const action = await openProductForm();
    fill(/^Nom du produit/, "Brume d'oreiller");
    fill(/^Prix de vente/, "4500");
    fireEvent.click(action);
    typeCategory("  Parfums   d'ambiance ");
    fireEvent.click(within(categoryDialog()).getByRole("button", { name: "Créer la catégorie" }));

    await waitFor(() => expect(mocks.createCat).toHaveBeenCalledTimes(1));
    expect(mocks.createCat).toHaveBeenCalledWith("Parfums d'ambiance");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Créer une catégorie/ })).not.toBeInTheDocument());
    await waitFor(() => expect(select()).toHaveValue("Parfums d'ambiance"));
    expect(optionsOf(select())).toContain("Parfums d'ambiance");
    expect(screen.getByLabelText(/^Nom du produit/)).toHaveValue("Brume d'oreiller");
    expect(screen.getByLabelText(/^Prix de vente/)).toHaveValue("4500");
    expect(mocks.create).not.toHaveBeenCalled(); // la validation de la petite fenêtre n'a pas envoyé le formulaire produit
    await waitFor(() => expect(mocks.listCats).toHaveBeenCalledTimes(2)); // liste actualisée par invalidation
  });

  it("on peut poursuivre : le produit est créé dans la nouvelle catégorie", async () => {
    const action = await openProductForm();
    fireEvent.click(action);
    typeCategory("Parfums d'ambiance");
    fireEvent.click(within(categoryDialog()).getByRole("button", { name: "Créer la catégorie" }));
    await waitFor(() => expect(select()).toHaveValue("Parfums d'ambiance"));

    fill(/^Nom du produit/, "Brume d'oreiller");
    fill(/^Prix de vente/, "4500");
    fireEvent.click(screen.getByRole("button", { name: "Créer le produit" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({ name: "Brume d'oreiller", category: "Parfums d'ambiance", price: 4500 });
  });

  it("la nouvelle catégorie apparaît aussi dans le filtre de l'administration", async () => {
    mocks.listCats.mockResolvedValueOnce(STATIC_CATS).mockResolvedValue([...STATIC_CATS, "Parfums d'ambiance"]);
    const action = await openProductForm();
    expect(optionsOf(screen.getByLabelText("Filtrer par catégorie") as HTMLSelectElement)).not.toContain("Parfums d'ambiance");
    fireEvent.click(action);
    typeCategory("Parfums d'ambiance");
    fireEvent.click(within(categoryDialog()).getByRole("button", { name: "Créer la catégorie" }));
    await waitFor(() => expect(select()).toHaveValue("Parfums d'ambiance"));
    await waitFor(() => expect(optionsOf(screen.getByLabelText("Filtrer par catégorie") as HTMLSelectElement)).toContain("Parfums d'ambiance"));
  });

  it("les catégories enregistrées en base (hors liste du code) sont proposées dans le formulaire et le filtre", async () => {
    mocks.listCats.mockResolvedValue([...STATIC_CATS, "Accessoires", "Parfums"]);
    await openProductForm();
    expect(optionsOf(select())).toEqual(["Choisir…", ...STATIC_CATS, "Accessoires", "Parfums"]);
    expect(optionsOf(screen.getByLabelText("Filtrer par catégorie") as HTMLSelectElement)).toEqual(["Toutes les catégories", ...STATIC_CATS, "Accessoires", "Parfums"]);
  });

  it("nom vide ou d'espaces seulement : refusé avant tout appel, message sous le champ", async () => {
    fireEvent.click(await openProductForm());
    for (const value of ["", "     "]) {
      typeCategory(value);
      fireEvent.click(within(categoryDialog()).getByRole("button", { name: "Créer la catégorie" }));
      expect(await within(categoryDialog()).findByText("Indiquez le nom de la catégorie.")).toBeInTheDocument();
    }
    expect(mocks.createCat).not.toHaveBeenCalled();
  });

  it("doublon connu (casse, espaces, accents) : refusé avant tout appel, avec le nom existant, le nom saisi est conservé", async () => {
    fireEvent.click(await openProductForm());
    for (const value of ["hydratation", "  HYDRATATION  ", "serums et soins ciblés"]) {
      typeCategory(value);
      fireEvent.click(within(categoryDialog()).getByRole("button", { name: "Créer la catégorie" }));
      expect(await within(categoryDialog()).findByText(/Une catégorie « .+ » existe déjà\./)).toBeInTheDocument();
      expect(screen.getByLabelText(/Nom de la catégorie/)).toHaveValue(value);
    }
    expect(mocks.createCat).not.toHaveBeenCalled();
  });

  it("doublon découvert par la base (créé entre-temps par un autre administrateur) : message de la base, nom conservé, aucune sélection", async () => {
    mocks.createCat.mockRejectedValue(new ProductActionError("category_exists", "Cette catégorie existe déjà."));
    fireEvent.click(await openProductForm());
    typeCategory("Parfums");
    fireEvent.click(within(categoryDialog()).getByRole("button", { name: "Créer la catégorie" }));

    expect(await within(categoryDialog()).findByText("Cette catégorie existe déjà.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Nom de la catégorie/)).toHaveValue("Parfums");
    expect(select()).toHaveValue("");
    expect(optionsOf(select())).not.toContain("Parfums");
  });

  it("échec réseau : message clair, nom conservé, jamais présentée comme créée, bouton de nouveau disponible", async () => {
    mocks.createCat.mockRejectedValue(new AdminError("network", "Connexion impossible. Vérifiez votre réseau et réessayez."));
    fireEvent.click(await openProductForm());
    typeCategory("Parfums");
    fireEvent.click(within(categoryDialog()).getByRole("button", { name: "Créer la catégorie" }));

    expect(await within(categoryDialog()).findByText("Connexion impossible. Vérifiez votre réseau et réessayez.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Nom de la catégorie/)).toHaveValue("Parfums");
    expect(within(categoryDialog()).getByRole("button", { name: "Créer la catégorie" })).toBeEnabled();
    expect(optionsOf(select())).not.toContain("Parfums");
    expect(mocks.listCats).toHaveBeenCalledTimes(1); // aucun rechargement : rien n'a changé
  });

  it("droits insuffisants : message d'accès refusé, nom conservé", async () => {
    mocks.createCat.mockRejectedValue(new AdminError("forbidden", "Accès refusé."));
    fireEvent.click(await openProductForm());
    typeCategory("Parfums");
    fireEvent.click(within(categoryDialog()).getByRole("button", { name: "Créer la catégorie" }));
    expect(await within(categoryDialog()).findByText("Accès refusé.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Nom de la catégorie/)).toHaveValue("Parfums");
  });

  it("nom refusé par la base (invalid_input) : message de la base conservé", async () => {
    mocks.createCat.mockRejectedValue(new ProductActionError("invalid_input", "Le nom de la catégorie doit contenir de 2 à 60 caractères."));
    fireEvent.click(await openProductForm());
    typeCategory("Parfums");
    fireEvent.click(within(categoryDialog()).getByRole("button", { name: "Créer la catégorie" }));
    expect(await within(categoryDialog()).findByText(/de 2 à 60 caractères/)).toBeInTheDocument();
  });

  it("double clic : une seule création, bouton désactivé pendant l'envoi", async () => {
    let done!: (v: string) => void;
    mocks.createCat.mockReturnValue(new Promise<string>((r) => { done = r; }));
    fireEvent.click(await openProductForm());
    typeCategory("Parfums d'ambiance");
    const submit = within(categoryDialog()).getByRole("button", { name: "Créer la catégorie" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(await within(categoryDialog()).findByRole("button", { name: "Création…" })).toBeDisabled();
    expect(mocks.createCat).toHaveBeenCalledTimes(1);
    done("Parfums d'ambiance");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Créer une catégorie/ })).not.toBeInTheDocument());
    expect(mocks.createCat).toHaveBeenCalledTimes(1);
  });

  it("touche Entrée dans la petite fenêtre : crée la catégorie, sans envoyer le formulaire produit", async () => {
    const action = await openProductForm();
    fill(/^Nom du produit/, "Brume d'oreiller");
    fireEvent.click(action);
    typeCategory("Parfums d'ambiance");
    fireEvent.submit(screen.getByLabelText(/Nom de la catégorie/).closest("form")!);
    await waitFor(() => expect(mocks.createCat).toHaveBeenCalledTimes(1));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("modification d'un produit : la même action est disponible et la catégorie du produit reste sélectionnée", async () => {
    show();
    await screen.findByText("Savon Mélisse 2 en 1");
    fireEvent.click(screen.getByRole("button", { name: "Modifier Savon Mélisse 2 en 1" }));
    await screen.findByRole("dialog");
    expect(await screen.findByRole("button", { name: /Créer une catégorie/ })).toBeInTheDocument();
    expect(select()).toHaveValue("Nettoyants");
  });
});
