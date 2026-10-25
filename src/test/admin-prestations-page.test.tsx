import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), create: vi.fn(), update: vi.fn(), toggle: vi.fn(), upcoming: vi.fn(), upload: vi.fn(), removeImg: vi.fn(), listCats: vi.fn(), createCat: vi.fn(), mobile: { value: false },
}));

vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (opts: Record<string, unknown>) => opts }));
vi.mock("@/components/app", () => ({ Img: ({ src, alt }: { src?: string; alt?: string }) => <img src={src ?? ""} alt={alt ?? ""} /> }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mocks.mobile.value }));
vi.mock("@/lib/admin-api", async (orig) => ({ ...(await orig<typeof import("@/lib/admin-api")>()), listAdminServices: mocks.list }));
vi.mock("@/lib/admin-services", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-services")>()),
  createAdminService: mocks.create, updateAdminService: mocks.update, setServiceActive: mocks.toggle, upcomingBookingsByService: mocks.upcoming,
}));
vi.mock("@/lib/admin-service-categories", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-service-categories")>()),
  listAdminServiceCategories: mocks.listCats, createAdminServiceCategory: mocks.createCat,
}));
vi.mock("@/lib/admin-images", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-images")>()),
  uploadServiceImage: mocks.upload, removeServiceImage: mocks.removeImg,
}));

import { AdminError, type AdminService } from "@/lib/admin-api";
import { ServiceCategoriesNotInstalledError } from "@/lib/admin-service-categories";
import { ServiceActionError } from "@/lib/admin-services";
import { buildCategories } from "@/lib/service-categories";
import { Route } from "@/routes/admin.prestations";

const svc = (o: Partial<AdminService> & Pick<AdminService, "id" | "name" | "category">): AdminService => ({
  description: "", durationLabel: "60 min", durationMin: 60, price: 10000, active: true, isDemo: true, imageUrl: null, ...o,
});
const PHOTO = "https://x.supabase.co/storage/v1/object/public/catalog-images/services/soin-visage-eclat/1.webp";
const CATALOGUE: AdminService[] = [
  svc({ id: "soin-visage-eclat", name: "Soin du visage éclat", category: "visage", description: "Nettoyage, vapeur et masque pour une peau fraîche.", price: 15000, imageUrl: PHOTO }),
  svc({ id: "nettoyage-profond", name: "Nettoyage de peau en profondeur", category: "visage", description: "Un soin complet pour purifier la peau du visage.", durationMin: 75, durationLabel: "75 min", price: 20000 }),
  svc({ id: "massage-relaxant", name: "Massage relaxant", category: "massage", description: "Massage du corps aux gestes enveloppants.", price: 20000 }),
  svc({ id: "massage-dos", name: "Massage dos et nuque", category: "massage", description: "Ciblé sur les zones de tension du haut du corps.", durationMin: 30, durationLabel: "30 min", price: 10000 }),
  svc({ id: "soin-corps-complet", name: "Soin corps complet", category: "corps", description: "Gommage et enveloppement.", price: 25000 }),
  svc({ id: "pedicure", name: "Pédicure soin", category: "onglerie", description: "Soin des pieds et des ongles, en douceur.", durationMin: 45, durationLabel: "45 min", price: 8000 }),
  svc({ id: "manucure", name: "Manucure soin", category: "onglerie", description: "Soin des mains et des ongles.", durationMin: 40, durationLabel: "40 min", price: 7000, active: false }),
  svc({ id: "shampoing-soin", name: "Shampoing et soin capillaire", category: "coiffure", description: "Lavage et soin pour des cheveux nourris.", durationMin: 45, durationLabel: "45 min", price: 7000 }),
  svc({ id: "nattes", name: "Nattes et tresses", category: "coiffure", description: "Nattes collées, tresses et coiffures protectrices.", durationMin: 180, durationLabel: "2 h et +", price: 15000 }),
  svc({ id: "rituel-spa", name: "Rituel spa complet", category: "spa", description: "Massage, soin du visage et soin des pieds réunis.", durationMin: 120, durationLabel: "2 h", price: 40000 }),
];

const Page = (Route as unknown as { component: () => ReactElement }).component;
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Page /></QueryClientProvider>);
}
const fill = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const row = (name: string) => (screen.getByText(name, { selector: "p" }).closest("tr") ?? screen.getByText(name, { selector: "p" }).closest("li"))!;
const tab = (re: RegExp) => screen.getByRole("tab", { name: re });
const optionsOf = (el: HTMLElement) => [...(el as HTMLSelectElement).options].map((o) => o.textContent);

beforeEach(() => {
  mocks.mobile.value = false;
  mocks.list.mockReset().mockResolvedValue(CATALOGUE);
  mocks.create.mockReset().mockResolvedValue({ id: "nouvelle-prestation" });
  mocks.update.mockReset().mockResolvedValue(undefined);
  mocks.toggle.mockReset().mockResolvedValue(undefined);
  mocks.upcoming.mockReset().mockResolvedValue({});
  mocks.upload.mockReset().mockResolvedValue("https://x/new.webp");
  mocks.removeImg.mockReset().mockResolvedValue(undefined);
  mocks.listCats.mockReset().mockResolvedValue(buildCategories([]));
  mocks.createCat.mockReset().mockResolvedValue({ id: "sauna", label: "Sauna" });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:apercu"), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("en-tête et catalogue", () => {
  it("titre, sous-titre et bouton principal ; plus de bandeau provisoire « démonstration »", async () => {
    show();
    expect(await screen.findByRole("heading", { level: 1, name: "Prestations" })).toBeInTheDocument();
    expect(screen.getByText("Catalogue des soins, services et tarifs proposés aux clientes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nouvelle prestation/ })).toBeInTheDocument();
    await screen.findByText("Massage relaxant");
    expect(screen.queryByText(/Tarifs et durées de démonstration/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pas encore modifiable/)).not.toBeInTheDocument();
  });

  it("colonnes Photo, Prestation, Catégorie, Durée, Prix, Statut, Actions", async () => {
    show();
    await screen.findByText("Massage relaxant");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Photo", "Prestation", "Catégorie", "Durée", "Prix", "Statut", "Actions"]);
  });

  it("chaque ligne : miniature, nom, description, catégorie lisible, durée, prix au format français, statut, actions", async () => {
    show();
    await screen.findByText("Soin du visage éclat");
    const r = within(row("Soin du visage éclat"));
    expect(row("Soin du visage éclat").querySelector("img")).toHaveAttribute("src", PHOTO);
    expect(r.getByText("Nettoyage, vapeur et masque pour une peau fraîche.")).toBeInTheDocument();
    expect(r.getByText("Visage")).toBeInTheDocument();
    expect(r.getByText("60 min")).toBeInTheDocument();
    expect(r.getByText(/15 000 FCFA/)).toBeInTheDocument();
    expect(r.getByText("Active")).toBeInTheDocument();
    expect(r.getByRole("button", { name: "Modifier Soin du visage éclat" })).toBeInTheDocument();
    expect(r.getByRole("button", { name: "Désactiver Soin du visage éclat" })).toBeInTheDocument();
  });

  it("données existantes affichées telles quelles : durées (« 2 h et + », « 2 h »), prix, catégories", async () => {
    show();
    await screen.findByText("Nattes et tresses");
    expect(within(row("Nattes et tresses")).getByText("2 h et +")).toBeInTheDocument();
    expect(within(row("Rituel spa complet")).getByText("2 h")).toBeInTheDocument();
    expect(within(row("Rituel spa complet")).getByText(/40 000 FCFA/)).toBeInTheDocument();
    expect(within(row("Soin corps complet")).getByText("Corps")).toBeInTheDocument();
    expect(within(row("Pédicure soin")).getByText("Onglerie")).toBeInTheDocument();
    expect(within(row("Shampoing et soin capillaire")).getByText("Coiffure")).toBeInTheDocument();
    expect(within(row("Rituel spa complet")).getByText("Spa")).toBeInTheDocument();
  });

  it("prestation inactive : pastille « Inactive » et action « Réactiver »", async () => {
    show();
    await screen.findByText("Manucure soin");
    expect(within(row("Manucure soin")).getByText("Inactive")).toBeInTheDocument();
    expect(within(row("Manucure soin")).getByRole("button", { name: "Réactiver Manucure soin" })).toBeInTheDocument();
  });

  it("tarifs de démonstration signalés ligne par ligne (« Tarif à confirmer »), jamais présentés comme officiels", async () => {
    mocks.list.mockResolvedValue([svc({ id: "a-officielle", name: "Prestation officielle", category: "spa", isDemo: false }), svc({ id: "b-demo", name: "Prestation de démo", category: "spa", isDemo: true })]);
    show();
    await screen.findByText("Prestation de démo");
    expect(within(row("Prestation de démo")).getByText("Tarif à confirmer")).toBeInTheDocument();
    expect(within(row("Prestation officielle")).queryByText("Tarif à confirmer")).not.toBeInTheDocument();
  });

  it("aucune action de suppression nulle part", async () => {
    show();
    await screen.findByText("Massage relaxant");
    expect(screen.queryByRole("button", { name: /supprimer/i })).not.toBeInTheDocument();
  });
});

describe("barre d'outils : recherche, filtres, compteur", () => {
  it("compteur de prestations et onglets Toutes / Actives / Inactives avec effectifs", async () => {
    show();
    await screen.findByText("Massage relaxant");
    expect(screen.getByText("10 prestations")).toBeInTheDocument();
    expect(tab(/^Toutes/)).toHaveTextContent("Toutes10");
    expect(tab(/^Actives/)).toHaveTextContent("Actives9");
    expect(tab(/^Inactives/)).toHaveTextContent("Inactives1");
  });

  it("recherche par nom et par description, sans tenir compte des accents ni de la casse", async () => {
    show();
    await screen.findByText("Massage relaxant");
    const search = screen.getByLabelText("Rechercher une prestation");
    fireEvent.change(search, { target: { value: "PEDICURE" } });
    expect(screen.getByText("Pédicure soin")).toBeInTheDocument();
    expect(screen.queryByText("Massage relaxant")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "tension" } }); // dans la description
    expect(screen.getByText("Massage dos et nuque")).toBeInTheDocument();
    expect(screen.queryByText("Pédicure soin")).not.toBeInTheDocument();
  });

  it("filtre par catégorie (« Toutes les catégories » conservé) et par statut", async () => {
    show();
    await screen.findByText("Massage relaxant");
    const cat = screen.getByLabelText("Filtrer par catégorie");
    expect(optionsOf(cat)).toEqual(["Toutes les catégories", "Visage", "Massage", "Corps", "Onglerie", "Coiffure", "Spa"]);
    fireEvent.change(cat, { target: { value: "massage" } });
    expect(screen.getByText("Massage relaxant")).toBeInTheDocument();
    expect(screen.queryByText("Soin corps complet")).not.toBeInTheDocument();
    fireEvent.change(cat, { target: { value: "all" } });

    fireEvent.click(tab(/^Inactives/));
    expect(screen.getByText("Manucure soin")).toBeInTheDocument();
    expect(screen.queryByText("Massage relaxant")).not.toBeInTheDocument();
    fireEvent.click(tab(/^Actives/));
    expect(screen.queryByText("Manucure soin")).not.toBeInTheDocument();
    expect(screen.getByText("Massage relaxant")).toBeInTheDocument();
  });

  it("filtres actifs : compteur « N sur M » et bouton de réinitialisation, qui rétablit tout", async () => {
    show();
    await screen.findByText("Massage relaxant");
    expect(screen.queryByRole("button", { name: "Réinitialiser les filtres" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrer par catégorie"), { target: { value: "onglerie" } });
    fireEvent.click(tab(/^Actives/));
    expect(screen.getByText("1 sur 10 prestations")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Réinitialiser les filtres" }));
    expect(screen.getByText("10 prestations")).toBeInTheDocument();
    expect(screen.getByLabelText("Filtrer par catégorie")).toHaveValue("all");
    expect(tab(/^Toutes/)).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Réinitialiser les filtres" })).not.toBeInTheDocument();
  });

  it("aucun résultat : message dédié avec réinitialisation", async () => {
    show();
    await screen.findByText("Massage relaxant");
    fireEvent.change(screen.getByLabelText("Rechercher une prestation"), { target: { value: "zzz" } });
    expect(screen.getByText("Aucun résultat")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Réinitialiser les filtres" })[0]!);
    expect(screen.getByText("Massage relaxant")).toBeInTheDocument();
  });
});

describe("états : chargement, vide, erreur", () => {
  it("chargement : squelette visible, ni liste ni compteur", () => {
    mocks.list.mockReturnValue(new Promise(() => {}));
    show();
    expect(screen.getByLabelText("Chargement")).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ prestations?$/)).not.toBeInTheDocument();
  });
  it("catalogue vide : invitation utile avec le bouton de création", async () => {
    mocks.list.mockResolvedValue([]);
    show();
    expect(await screen.findByText("Aucune prestation")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Nouvelle prestation/ })).toHaveLength(2);
  });
  it("erreur : message et « Réessayer », jamais présentée comme un catalogue vide", async () => {
    mocks.list.mockRejectedValueOnce(new AdminError("server", "Lecture des prestations impossible."));
    show();
    expect(await screen.findByText("Chargement impossible")).toBeInTheDocument();
    expect(screen.queryByText("Aucune prestation")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Massage relaxant")).toBeInTheDocument();
  });
  it("refus d'autorisation : « Accès refusé »", async () => {
    mocks.list.mockRejectedValue(new AdminError("forbidden", "Accès refusé."));
    show();
    expect(await screen.findByText("Accès refusé")).toBeInTheDocument();
  });
});

describe("affichage mobile : cartes compactes", () => {
  it("cartes à la place du tableau, avec les mêmes informations et actions", async () => {
    mocks.mobile.value = true;
    show();
    await screen.findByText("Soin du visage éclat");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Prestations" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    const card = within(row("Nattes et tresses"));
    expect(card.getByText("Coiffure")).toBeInTheDocument();
    expect(card.getByText("2 h et +")).toBeInTheDocument();
    expect(card.getByText(/15 000 FCFA/)).toBeInTheDocument();
    expect(card.getByText("Active")).toBeInTheDocument();
    expect(card.getByText("Tarif à confirmer")).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Modifier Nattes et tresses" })).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Désactiver Nattes et tresses" })).toBeInTheDocument();
  });
  it("les filtres fonctionnent aussi sur mobile", async () => {
    mocks.mobile.value = true;
    show();
    await screen.findByText("Soin du visage éclat");
    fireEvent.click(tab(/^Inactives/));
    expect(within(screen.getByRole("list", { name: "Prestations" })).getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("création d'une prestation", () => {
  const open = async () => {
    show();
    await screen.findByText("Massage relaxant");
    fireEvent.click(screen.getByRole("button", { name: /Nouvelle prestation/ }));
    return screen.findByRole("dialog");
  };
  const fillValid = () => {
    fill(/^Nom de la prestation/, "Soin éclat hydratant");
    fill(/^Catégorie/, "visage");
    fill(/^Durée \(minutes\)/, "90");
    fill(/^Prix de vente/, "18 000");
  };
  const submitName = "Créer la prestation";

  it("modale : titre, sous-titre, sections et boutons", async () => {
    const d = await open();
    expect(within(d).getByRole("heading", { name: "Nouvelle prestation" })).toBeInTheDocument();
    expect(within(d).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Photo", "Informations", "Durée et tarif", "Visibilité"]);
    expect(within(d).getByRole("button", { name: "Annuler" })).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: submitName })).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Ajouter une photo" })).toBeInTheDocument();
    expect(within(d).getByRole("switch", { name: /Prestation active/ })).toBeChecked();
    expect(within(d).queryByLabelText(/Tarif et durée confirmés/)).not.toBeInTheDocument(); // seulement pour une prestation de démonstration existante
  });

  it("catégories proposées : celles du catalogue (Visage, Massage, Corps, Onglerie, Coiffure, Spa)", async () => {
    await open();
    expect(optionsOf(screen.getByLabelText(/^Catégorie/))).toEqual(["Choisir…", "Visage", "Massage", "Corps", "Onglerie", "Coiffure", "Spa"]);
  });

  it("formulaire vide : erreurs sous les champs, aucun appel à la base", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText(/Indiquez le nom de la prestation/)).toBeInTheDocument();
    expect(screen.getByText("Choisissez une catégorie.")).toBeInTheDocument();
    expect(screen.getByText("Durée (minutes) : indiquez une valeur.")).toBeInTheDocument();
    expect(screen.getByText("Prix de vente : indiquez une valeur.")).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("durée hors limites et prix invalides : refusés", async () => {
    await open();
    fillValid();
    for (const [duration, expected] of [["4", /5 au minimum/], ["721", /720 au maximum/], ["45,5", /nombre entier positif/], ["abc", /nombre entier positif/]] as const) {
      fill(/^Durée \(minutes\)/, duration);
      fireEvent.click(screen.getByRole("button", { name: submitName }));
      expect(await screen.findByText(expected, { selector: "p[role=alert]" })).toBeInTheDocument();
    }
    fill(/^Durée \(minutes\)/, "60");
    for (const price of ["-5", "12,5", "abc", "999999999"]) {
      fill(/^Prix de vente/, price);
      fireEvent.click(screen.getByRole("button", { name: submitName }));
      expect(await screen.findByText(/Prix de vente : /, { selector: "p[role=alert]" })).toBeInTheDocument();
    }
    expect(mocks.create).not.toHaveBeenCalled();
  }, 20_000); // 8 soumissions de formulaire : ~2 s seul, plus de 5 s quand les fichiers de test tournent en parallèle

  it("libellé de durée généré à partir de la durée, et personnalisation conservée", async () => {
    await open();
    const label = screen.getByLabelText("Durée affichée aux clientes");
    fill(/^Durée \(minutes\)/, "90");
    expect(label).toHaveValue("90 min");
    fill(/^Durée \(minutes\)/, "120");
    expect(label).toHaveValue("2 h");
    fill("Durée affichée aux clientes", "2 h et +"); // personnalisé
    fill(/^Durée \(minutes\)/, "150");
    expect(label).toHaveValue("2 h et +");
  });

  it("création : valeurs envoyées, identifiants existants transmis, catalogue rechargé, notification avec le nom, fenêtre fermée", async () => {
    await open();
    fillValid();
    fill(/^Description/, "Un soin hydratant");
    fireEvent.click(screen.getByRole("button", { name: submitName }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const [input, existing] = mocks.create.mock.calls[0]!;
    expect(input).toEqual({ name: "Soin éclat hydratant", category: "visage", description: "Un soin hydratant", durationMin: 90, durationLabel: "90 min", price: 18000, active: true });
    expect(existing).toEqual(CATALOGUE.map((s) => s.id));
    expect(await screen.findByText(/« Soin éclat hydratant » a été ajoutée au catalogue/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2)); // catalogue actualisé
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("prestation créée inactive : l'interrupteur est respecté", async () => {
    await open();
    fillValid();
    fireEvent.click(screen.getByRole("switch", { name: /Prestation active/ }));
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({ active: false });
  });

  it("annulation : rien n'est enregistré", async () => {
    await open();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("échec réseau : message clair, saisies conservées, bouton de nouveau disponible, rien de rechargé", async () => {
    mocks.create.mockRejectedValue(new AdminError("network", "Connexion impossible. Vérifiez votre réseau et réessayez."));
    await open();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText("Connexion impossible. Vérifiez votre réseau et réessayez.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nom de la prestation/)).toHaveValue("Soin éclat hydratant");
    expect(screen.getByLabelText(/^Prix de vente/)).toHaveValue("18 000");
    expect(screen.getByRole("button", { name: submitName })).toBeEnabled();
    expect(screen.queryByText(/a été ajoutée/)).not.toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("refus d'autorisation et refus de validation : messages exacts conservés", async () => {
    mocks.create.mockRejectedValueOnce(new AdminError("forbidden", "Accès refusé."));
    await open();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText("Accès refusé.")).toBeInTheDocument();
    mocks.create.mockRejectedValueOnce(new ServiceActionError("invalid_input", "Valeurs refusées par la base (durée de 5 à 720 minutes)."));
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText(/Valeurs refusées par la base/)).toBeInTheDocument();
  });

  it("double clic : une seule création, bouton désactivé pendant l'envoi", async () => {
    let done!: (v: { id: string }) => void;
    mocks.create.mockReturnValue(new Promise<{ id: string }>((r) => { done = r; }));
    await open();
    fillValid();
    const submit = screen.getByRole("button", { name: submitName });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(await screen.findByRole("button", { name: "Création…" })).toBeDisabled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    done({ id: "soin-eclat-hydratant" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  const lost = async (_input: unknown, _ids: unknown, opts?: { onAttempt?: (a: { id: string }) => void }) => {
    opts?.onAttempt?.({ id: "soin-eclat-hydratant" });
    throw new AdminError("network", "Connexion impossible. Vérifiez votre réseau et réessayez.");
  };

  it("réponse perdue puis nouvelle validation : si la prestation a bien été créée, elle est ADOPTÉE (aucune seconde création)", async () => {
    mocks.create.mockReset().mockImplementationOnce(lost);
    await open();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await screen.findByText("Connexion impossible. Vérifiez votre réseau et réessayez.");
    expect(mocks.list).toHaveBeenCalledTimes(1);

    mocks.list.mockResolvedValueOnce([...CATALOGUE, svc({ id: "soin-eclat-hydratant", name: "Soin éclat hydratant", category: "visage" })]);
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText(/« Soin éclat hydratant » a été ajoutée au catalogue/)).toBeInTheDocument();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("réponse perdue, produit absent à la relecture : nouvelle création avec le catalogue à jour ; relecture impossible : rien n'est créé", async () => {
    mocks.create.mockReset().mockImplementationOnce(lost).mockResolvedValueOnce({ id: "soin-eclat-hydratant" });
    await open();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await screen.findByText("Connexion impossible. Vérifiez votre réseau et réessayez.");

    mocks.list.mockRejectedValueOnce(new AdminError("network", "Connexion impossible. Vérifiez votre réseau et réessayez."));
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: submitName })).toBeEnabled();

    mocks.list.mockResolvedValueOnce([...CATALOGUE, svc({ id: "soin-eclat-hydratant", name: "Une autre prestation", category: "spa" })]);
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1]![1]).toEqual([...CATALOGUE.map((s) => s.id), "soin-eclat-hydratant"]);
  });
});

describe("photo dans le formulaire", () => {
  const photo = (name = "p.jpg", type = "image/jpeg") => new File([new Uint8Array(2000)], name, { type });
  const choose = (f: File) => fireEvent.change(screen.getByLabelText("Choisir une photo"), { target: { files: [f] } });
  const openEdit = async (name: string) => {
    show();
    await screen.findByText(name);
    fireEvent.click(screen.getByRole("button", { name: `Modifier ${name}` }));
    await screen.findByRole("dialog");
  };

  it("prestation avec photo : aperçu, « Remplacer » et « Retirer » ; sans photo : « Ajouter une photo »", async () => {
    await openEdit("Soin du visage éclat");
    expect(screen.getByAltText(/Aperçu de la photo/)).toHaveAttribute("src", PHOTO);
    expect(screen.getByText("Photo actuelle de la prestation.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remplacer la photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retirer la photo" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Modifier Massage relaxant" }));
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: "Ajouter une photo" })).toBeInTheDocument();
    expect(screen.getByText(/Aucune photo : l'image par défaut/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retirer la photo" })).not.toBeInTheDocument();
  });

  it("modification sans toucher à la photo : ni envoi ni suppression", async () => {
    await openEdit("Soin du visage éclat");
    fill(/^Prix de vente/, "16000");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.removeImg).not.toHaveBeenCalled();
  });

  it("nouvelle photo : aperçu immédiat, rien d'envoyé avant l'enregistrement, puis fiche PUIS photo avec la photo actuelle", async () => {
    await openEdit("Soin du visage éclat");
    const f = photo();
    choose(f);
    expect(screen.getByAltText(/Aperçu de la photo/)).toHaveAttribute("src", "blob:apercu");
    expect(screen.getByText(/Nouvelle photo : elle sera enregistrée avec la prestation/)).toBeInTheDocument();
    expect(mocks.upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith("soin-visage-eclat", f, PHOTO));
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.upload.mock.invocationCallOrder[0]!);
    expect(await screen.findByText(/« Soin du visage éclat » a été modifiée/)).toBeInTheDocument();
  });

  it("retrait de la photo : marqué dans le formulaire, effectif à l'enregistrement, annulable avant", async () => {
    await openEdit("Soin du visage éclat");
    fireEvent.click(screen.getByRole("button", { name: "Retirer la photo" }));
    expect(screen.getByText("La photo sera retirée à l'enregistrement.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Annuler le retrait" }));
    expect(screen.getByText("Photo actuelle de la prestation.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retirer la photo" }));
    expect(mocks.removeImg).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    await waitFor(() => expect(mocks.removeImg).toHaveBeenCalledWith("soin-visage-eclat", PHOTO));
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.removeImg.mock.invocationCallOrder[0]!);
  });

  it("format refusé : message clair, aucune photo en attente", async () => {
    await openEdit("Soin du visage éclat");
    choose(photo("doc.pdf", "application/pdf"));
    expect(await screen.findByText(/JPEG, PNG ou WebP/, { selector: "p[role=alert]" })).toBeInTheDocument();
    expect(screen.getByText("Photo actuelle de la prestation.")).toBeInTheDocument();
  });

  it("la fiche échoue : la photo n'est pas envoyée", async () => {
    mocks.update.mockRejectedValue(new ServiceActionError("not_found", "Prestation introuvable ou accès refusé : rien n'a été modifié."));
    await openEdit("Soin du visage éclat");
    choose(photo());
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    expect(await screen.findByText(/rien n'a été modifié/)).toBeInTheDocument();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("la photo échoue après une fiche enregistrée : la fenêtre reste ouverte avec un message précis", async () => {
    mocks.upload.mockRejectedValue(new Error("Image trop lourde pour le serveur (5 Mo maximum)."));
    await openEdit("Soin du visage éclat");
    choose(photo());
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    expect(await screen.findByText(/Les informations sont enregistrées, mais la photo ne l'est pas : Image trop lourde/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });

  it("création avec photo : prestation créée, puis photo envoyée avec son identifiant ; sans photo : aucun envoi", async () => {
    show();
    await screen.findByText("Massage relaxant");
    fireEvent.click(screen.getByRole("button", { name: /Nouvelle prestation/ }));
    await screen.findByRole("dialog");
    fill(/^Nom de la prestation/, "Soin éclat hydratant");
    fill(/^Catégorie/, "visage");
    fill(/^Durée \(minutes\)/, "90");
    fill(/^Prix de vente/, "18000");
    const f = photo();
    choose(f);
    fireEvent.click(screen.getByRole("button", { name: "Créer la prestation" }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith("nouvelle-prestation", f, null));
    expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.upload.mock.invocationCallOrder[0]!);
  });

  it("création : photo refusée, prestation tout de même créée et signalée", async () => {
    mocks.upload.mockRejectedValue(new Error("Accès refusé : ce compte n'est pas autorisé à modifier les photos."));
    show();
    await screen.findByText("Massage relaxant");
    fireEvent.click(screen.getByRole("button", { name: /Nouvelle prestation/ }));
    await screen.findByRole("dialog");
    fill(/^Nom de la prestation/, "Soin éclat hydratant");
    fill(/^Catégorie/, "visage");
    fill(/^Durée \(minutes\)/, "90");
    fill(/^Prix de vente/, "18000");
    choose(photo());
    fireEvent.click(screen.getByRole("button", { name: "Créer la prestation" }));
    expect(await screen.findByText(/a été ajoutée, mais sa photo n'a pas pu être enregistrée : Accès refusé/)).toBeInTheDocument();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});

describe("modification d'une prestation", () => {
  const openEdit = async (name: string) => {
    show();
    await screen.findByText(name);
    fireEvent.click(screen.getByRole("button", { name: `Modifier ${name}` }));
    await screen.findByRole("dialog");
  };

  it("formulaire prérempli (durée, libellé personnalisé, prix, statut) ; identifiant non modifiable", async () => {
    await openEdit("Nattes et tresses");
    expect(screen.getByLabelText(/^Nom de la prestation/)).toHaveValue("Nattes et tresses");
    expect(screen.getByLabelText(/^Catégorie/)).toHaveValue("coiffure");
    expect(screen.getByLabelText(/^Durée \(minutes\)/)).toHaveValue("180");
    expect(screen.getByLabelText("Durée affichée aux clientes")).toHaveValue("2 h et +");
    expect(screen.getByLabelText(/^Prix de vente/)).toHaveValue("15000");
    expect(screen.getByRole("switch", { name: /Prestation active/ })).toBeChecked();
    expect(screen.getByText(/Identifiant : nattes \(non modifiable/)).toBeInTheDocument();
  });

  it("le libellé personnalisé « 2 h et + » est conservé tant qu'on ne le modifie pas, même si la durée change", async () => {
    await openEdit("Nattes et tresses");
    fill(/^Durée \(minutes\)/, "210");
    expect(screen.getByLabelText("Durée affichée aux clientes")).toHaveValue("2 h et +");
  });

  it("modification du prix et de la durée : update avec les nouvelles valeurs, l'identifiant d'origine, notification, catalogue public actualisé", async () => {
    await openEdit("Massage relaxant");
    fill(/^Prix de vente/, "22 000");
    fill(/^Durée \(minutes\)/, "75");
    expect(screen.getByLabelText("Durée affichée aux clientes")).toHaveValue("75 min"); // libellé généré, car non personnalisé
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    const [id, input, opts] = mocks.update.mock.calls[0]!;
    expect(id).toBe("massage-relaxant");
    expect(input).toEqual({ name: "Massage relaxant", category: "massage", description: "Massage du corps aux gestes enveloppants.", durationMin: 75, durationLabel: "75 min", price: 22000, active: true });
    expect(opts).toEqual({ confirmTariff: false });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(await screen.findByText(/« Massage relaxant » a été modifiée/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });

  it("tarif de démonstration : la case de confirmation est proposée et décochée par défaut (rien n'est validé en silence)", async () => {
    await openEdit("Massage relaxant");
    const confirm = screen.getByLabelText(/Tarif et durée confirmés/);
    expect(confirm).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0]![2]).toEqual({ confirmTariff: false });
  });

  it("confirmation explicite du tarif : transmise à l'enregistrement", async () => {
    await openEdit("Massage relaxant");
    fireEvent.click(screen.getByLabelText(/Tarif et durée confirmés/));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0]![2]).toEqual({ confirmTariff: true });
  });

  it("prestation déjà officielle : pas de case de confirmation", async () => {
    mocks.list.mockResolvedValue([svc({ id: "officielle", name: "Prestation officielle", category: "spa", isDemo: false })]);
    await openEdit("Prestation officielle");
    expect(screen.queryByLabelText(/Tarif et durée confirmés/)).not.toBeInTheDocument();
  });

  it("désactivation depuis le formulaire (interrupteur) : active=false envoyé", async () => {
    await openEdit("Massage relaxant");
    fireEvent.click(screen.getByRole("switch", { name: /Prestation active/ }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0]![1]).toMatchObject({ active: false });
  });

  it("erreur à l'enregistrement : message conservé, saisies conservées, aucune notification de réussite", async () => {
    mocks.update.mockRejectedValue(new AdminError("forbidden", "Accès refusé."));
    await openEdit("Massage relaxant");
    fill(/^Prix de vente/, "22000");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    expect(await screen.findByText("Accès refusé.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Prix de vente/)).toHaveValue("22000");
    expect(screen.queryByText(/a été modifiée/)).not.toBeInTheDocument();
  });
});

describe("désactivation et réactivation (jamais de suppression)", () => {
  it("confirmation avec vérification des réservations à venir ; « Annuler » n'appelle rien", async () => {
    show();
    await screen.findByText("Pédicure soin");
    fireEvent.click(screen.getByRole("button", { name: "Désactiver Pédicure soin" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Elle n'est pas supprimée/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuler" }));
    expect(mocks.toggle).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("réservations à venir : nombre indiqué (1, plusieurs), conservées ; aucune : mention dédiée", async () => {
    mocks.upcoming.mockResolvedValue({ pedicure: 1, nattes: 3 });
    show();
    await screen.findByText("Pédicure soin");
    fireEvent.click(screen.getByRole("button", { name: "Désactiver Pédicure soin" }));
    expect(await screen.findByText(/1 réservation à venir utilise cette prestation : elle est conservée/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Désactiver Nattes et tresses" }));
    expect(await screen.findByText(/3 réservations à venir utilisent cette prestation : elles sont conservées/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Désactiver Massage relaxant" }));
    expect(await screen.findByText("Aucune réservation à venir ne concerne cette prestation.")).toBeInTheDocument();
  });

  it("vérification impossible : signalée, la désactivation reste possible", async () => {
    mocks.upcoming.mockRejectedValue(new AdminError("network", "Connexion impossible."));
    show();
    await screen.findByText("Pédicure soin");
    fireEvent.click(screen.getByRole("button", { name: "Désactiver Pédicure soin" }));
    expect(await screen.findByText("Les réservations à venir n'ont pas pu être vérifiées.")).toBeInTheDocument();
    expect(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Désactiver" })).toBeEnabled();
  });

  it("confirmation : setServiceActive(id, false), catalogue rechargé, la prestation reste dans la liste (Inactive)", async () => {
    show();
    await screen.findByText("Pédicure soin");
    fireEvent.click(screen.getByRole("button", { name: "Désactiver Pédicure soin" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Désactiver" }));
    await waitFor(() => expect(mocks.toggle).toHaveBeenCalledWith("pedicure", false));
    expect(await screen.findByText(/« Pédicure soin » est désactivée/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Pédicure soin", { selector: "p" })).toBeInTheDocument();
  });

  it("réactiver est immédiat (sans confirmation) : setServiceActive(id, true)", async () => {
    show();
    await screen.findByText("Manucure soin");
    fireEvent.click(screen.getByRole("button", { name: "Réactiver Manucure soin" }));
    await waitFor(() => expect(mocks.toggle).toHaveBeenCalledWith("manucure", true));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(await screen.findByText(/« Manucure soin » est réactivée/)).toBeInTheDocument();
  });

  it("échec : message d'erreur, rien n'est présenté comme réussi", async () => {
    mocks.toggle.mockRejectedValue(new ServiceActionError("not_found", "Prestation introuvable ou accès refusé : rien n'a été modifié."));
    show();
    await screen.findByText("Manucure soin");
    fireEvent.click(screen.getByRole("button", { name: "Réactiver Manucure soin" }));
    expect(await screen.findByText(/rien n'a été modifié/)).toBeInTheDocument();
    expect(screen.queryByText(/est réactivée/)).not.toBeInTheDocument();
  });
});

describe("création d'une catégorie depuis le formulaire prestation", () => {
  const SAUNA = [{ id: "sauna", label: "Sauna", title: "Sauna", description: "", image_url: null, sort_order: 70 }];
  const ORIGINAL = ["Visage", "Massage", "Corps", "Onglerie", "Coiffure", "Spa"];
  const openForm = async () => {
    show();
    await screen.findByText("Massage relaxant");
    fireEvent.click(screen.getByRole("button", { name: /Nouvelle prestation/ }));
    await screen.findByRole("dialog");
  };
  const categoryDialog = () => screen.getByRole("dialog", { name: /Créer une catégorie/ });
  const typeCategory = (value: string) => fireEvent.change(screen.getByLabelText(/Nom de la catégorie/), { target: { value } });
  const select = () => screen.getByLabelText(/^Catégorie/) as HTMLSelectElement;
  const submitCategory = () => fireEvent.click(within(categoryDialog()).getByRole("button", { name: "Créer la catégorie" }));
  const optionLabels = (el: HTMLSelectElement) => [...el.options].map((o) => o.textContent);

  it("action discrète « Créer une catégorie » sous le champ Catégorie ; les 6 catégories d'origine restent dans leur ordre", async () => {
    await openForm();
    expect(await screen.findByRole("button", { name: /Créer une catégorie/ })).toBeInTheDocument();
    expect(optionLabels(select())).toEqual(["Choisir…", ...ORIGINAL]);
  });

  it("migration non appliquée : l'action n'est pas proposée, la liste du code reste utilisable, aucune erreur affichée", async () => {
    mocks.listCats.mockRejectedValue(new ServiceCategoriesNotInstalledError());
    await openForm();
    await waitFor(() => expect(mocks.listCats).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Créer une catégorie/ })).not.toBeInTheDocument();
    expect(optionLabels(select())).toEqual(["Choisir…", ...ORIGINAL]);
    expect(screen.queryByText(/n'ont pas pu être chargées/)).not.toBeInTheDocument();
  });

  it("autre erreur de lecture (réseau) : signalée dans le formulaire avec « Réessayer », sans action de création", async () => {
    mocks.listCats.mockRejectedValue(new AdminError("network", "Connexion impossible. Vérifiez votre réseau et réessayez."));
    await openForm();
    expect(await screen.findByText(/n'ont pas pu être chargées/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Créer une catégorie/ })).not.toBeInTheDocument();
    mocks.listCats.mockResolvedValue(buildCategories(SAUNA));
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByRole("button", { name: /Créer une catégorie/ })).toBeInTheDocument();
    expect(optionLabels(select())).toContain("Sauna");
  });

  it("création : nom normalisé envoyé, liste actualisée, catégorie sélectionnée, brouillon conservé, prestation non créée", async () => {
    mocks.listCats.mockResolvedValueOnce(buildCategories([])).mockResolvedValue(buildCategories(SAUNA));
    await openForm();
    fill(/^Nom de la prestation/, "Sauna vapeur");
    fill(/^Prix/, "5000");
    fireEvent.click(await screen.findByRole("button", { name: /Créer une catégorie/ }));
    typeCategory("  Sauna  ");
    submitCategory();

    await waitFor(() => expect(mocks.createCat).toHaveBeenCalledTimes(1));
    expect(mocks.createCat).toHaveBeenCalledWith("Sauna");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Créer une catégorie/ })).not.toBeInTheDocument());
    await waitFor(() => expect(select()).toHaveValue("sauna"));
    expect(optionLabels(select())).toEqual(["Choisir…", ...ORIGINAL, "Sauna"]);
    expect(screen.getByLabelText(/^Nom de la prestation/)).toHaveValue("Sauna vapeur");
    expect(screen.getByLabelText(/^Prix/)).toHaveValue("5000");
    expect(mocks.create).not.toHaveBeenCalled(); // la petite fenêtre n'a pas envoyé le formulaire prestation
  });

  it("on peut poursuivre : la prestation est créée dans la nouvelle catégorie", async () => {
    mocks.listCats.mockResolvedValueOnce(buildCategories([])).mockResolvedValue(buildCategories(SAUNA));
    await openForm();
    fireEvent.click(await screen.findByRole("button", { name: /Créer une catégorie/ }));
    typeCategory("Sauna");
    submitCategory();
    await waitFor(() => expect(select()).toHaveValue("sauna"));
    fill(/^Nom de la prestation/, "Sauna vapeur");
    fill(/^Durée .minutes/, "30");
    fill(/^Prix/, "5000");
    fireEvent.click(screen.getByRole("button", { name: /^(Créer|Ajouter) la prestation/ }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0]![0]).toMatchObject({ name: "Sauna vapeur", category: "sauna", durationMin: 30, price: 5000 });
  });

  it("la nouvelle catégorie apparaît aussi dans le filtre de la page", async () => {
    mocks.listCats.mockResolvedValueOnce(buildCategories([])).mockResolvedValue(buildCategories(SAUNA));
    await openForm();
    const filter = () => screen.getByLabelText("Filtrer par catégorie") as HTMLSelectElement;
    expect(optionLabels(filter())).not.toContain("Sauna");
    fireEvent.click(await screen.findByRole("button", { name: /Créer une catégorie/ }));
    typeCategory("Sauna");
    submitCategory();
    await waitFor(() => expect(select()).toHaveValue("sauna"));
    await waitFor(() => expect(optionLabels(filter())).toContain("Sauna"));
  });

  it("doublons refusés avant tout appel : casse, accents, espaces", async () => {
    await openForm();
    fireEvent.click(await screen.findByRole("button", { name: /Créer une catégorie/ }));
    for (const value of ["visage", "VISAGE", "Vísage", "  Visage  ", "Mas sage".replace(" ", "")]) {
      typeCategory(value);
      submitCategory();
      expect(await within(categoryDialog()).findByText(/Une catégorie « .+ » existe déjà\./)).toBeInTheDocument();
    }
    expect(mocks.createCat).not.toHaveBeenCalled();
  });

  it("noms invalides refusés avant tout appel (vide, trop court, trop long)", async () => {
    await openForm();
    fireEvent.click(await screen.findByRole("button", { name: /Créer une catégorie/ }));
    for (const [value, msg] of [["", "Indiquez le nom de la catégorie."], ["a", /de 2 à 60 caractères/], ["x".repeat(61), /de 2 à 60 caractères/]] as const) {
      typeCategory(value);
      submitCategory();
      expect(await within(categoryDialog()).findByText(msg)).toBeInTheDocument();
    }
    expect(mocks.createCat).not.toHaveBeenCalled();
  });

  it("refus de la base (doublon créé entre-temps) : message affiché, nom conservé, brouillon intact", async () => {
    mocks.createCat.mockRejectedValue(new ServiceActionError("category_exists", "Cette catégorie existe déjà."));
    await openForm();
    fill(/^Nom de la prestation/, "Sauna vapeur");
    fireEvent.click(await screen.findByRole("button", { name: /Créer une catégorie/ }));
    typeCategory("Sauna");
    submitCategory();
    expect(await within(categoryDialog()).findByText("Cette catégorie existe déjà.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Nom de la catégorie/)).toHaveValue("Sauna");
    expect(within(categoryDialog()).getByRole("button", { name: "Créer la catégorie" })).toBeEnabled();
    fireEvent.click(within(categoryDialog()).getByRole("button", { name: "Annuler" }));
    expect(screen.getByLabelText(/^Nom de la prestation/)).toHaveValue("Sauna vapeur");
    expect(select()).toHaveValue("");
  });

  it("échec réseau : message clair, rien de sélectionné, brouillon conservé", async () => {
    mocks.createCat.mockRejectedValue(new AdminError("network", "Connexion impossible. Vérifiez votre réseau et réessayez."));
    await openForm();
    fill(/^Nom de la prestation/, "Sauna vapeur");
    fireEvent.click(await screen.findByRole("button", { name: /Créer une catégorie/ }));
    typeCategory("Sauna");
    submitCategory();
    expect(await within(categoryDialog()).findByText(/Connexion impossible/)).toBeInTheDocument();
    expect(select()).toHaveValue("");
    expect(screen.getByLabelText(/^Nom de la prestation/)).toHaveValue("Sauna vapeur");
  });

  it("accès refusé : message clair, rien de sélectionné", async () => {
    mocks.createCat.mockRejectedValue(new AdminError("forbidden", "Accès refusé."));
    await openForm();
    fireEvent.click(await screen.findByRole("button", { name: /Créer une catégorie/ }));
    typeCategory("Sauna");
    submitCategory();
    expect(await within(categoryDialog()).findByText("Accès refusé.")).toBeInTheDocument();
    expect(select()).toHaveValue("");
  });

  it("annuler la petite fenêtre : aucune création, brouillon conservé", async () => {
    await openForm();
    fill(/^Nom de la prestation/, "Sauna vapeur");
    fireEvent.click(await screen.findByRole("button", { name: /Créer une catégorie/ }));
    typeCategory("Sauna");
    fireEvent.click(within(categoryDialog()).getByRole("button", { name: "Annuler" }));
    expect(mocks.createCat).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Nom de la prestation/)).toHaveValue("Sauna vapeur");
  });

  it("double clic : une seule création, bouton désactivé pendant l'envoi", async () => {
    let done!: (v: { id: string; label: string }) => void;
    mocks.createCat.mockReturnValue(new Promise((r) => { done = r; }));
    await openForm();
    fireEvent.click(await screen.findByRole("button", { name: /Créer une catégorie/ }));
    typeCategory("Sauna");
    const submit = within(categoryDialog()).getByRole("button", { name: "Créer la catégorie" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(await within(categoryDialog()).findByRole("button", { name: "Création…" })).toBeDisabled();
    expect(mocks.createCat).toHaveBeenCalledTimes(1);
    done({ id: "sauna", label: "Sauna" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Créer une catégorie/ })).not.toBeInTheDocument());
    expect(mocks.createCat).toHaveBeenCalledTimes(1);
  });

  it("touche Entrée dans la petite fenêtre : crée la catégorie, sans envoyer le formulaire prestation", async () => {
    await openForm();
    fill(/^Nom de la prestation/, "Sauna vapeur");
    fireEvent.click(await screen.findByRole("button", { name: /Créer une catégorie/ }));
    typeCategory("Sauna");
    fireEvent.submit(screen.getByLabelText(/Nom de la catégorie/).closest("form")!);
    await waitFor(() => expect(mocks.createCat).toHaveBeenCalledTimes(1));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("modification : la même action est disponible, la catégorie de la prestation reste sélectionnée, y compris une catégorie créée", async () => {
    mocks.list.mockResolvedValue([...CATALOGUE, svc({ id: "sauna-vapeur", name: "Sauna vapeur", category: "sauna" })]);
    mocks.listCats.mockResolvedValue(buildCategories(SAUNA));
    show();
    await screen.findByText("Sauna vapeur");
    expect(within(row("Sauna vapeur")).getByText("Sauna")).toBeInTheDocument(); // libellé, pas l'identifiant
    fireEvent.click(screen.getByRole("button", { name: "Modifier Sauna vapeur" }));
    await screen.findByRole("dialog");
    expect(await screen.findByRole("button", { name: /Créer une catégorie/ })).toBeInTheDocument();
    expect(select()).toHaveValue("sauna");
  });

  it("migration non appliquée : une prestation dont la catégorie n'est pas dans la liste du code la garde dans le formulaire", async () => {
    mocks.listCats.mockRejectedValue(new ServiceCategoriesNotInstalledError());
    mocks.list.mockResolvedValue([svc({ id: "sauna-vapeur", name: "Sauna vapeur", category: "sauna" })]);
    show();
    await screen.findByText("Sauna vapeur");
    fireEvent.click(screen.getByRole("button", { name: "Modifier Sauna vapeur" }));
    await screen.findByRole("dialog");
    expect(select()).toHaveValue("sauna");
  });
});
