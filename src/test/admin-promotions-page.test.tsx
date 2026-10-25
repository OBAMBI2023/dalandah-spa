import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), create: vi.fn(), update: vi.fn(), setPub: vi.fn(), del: vi.fn(), services: vi.fn(), products: vi.fn(),
  upload: vi.fn(), removeImg: vi.fn(), mobile: { value: false },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  Link: ({ children, to }: { children?: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/components/app", () => ({ Img: ({ src, alt }: { src?: string; alt?: string }) => <img src={src ?? ""} alt={alt ?? ""} /> }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mocks.mobile.value }));
vi.mock("@/lib/admin-api", async (orig) => ({ ...(await orig<typeof import("@/lib/admin-api")>()), listAdminServices: mocks.services }));
vi.mock("@/lib/admin-products", async (orig) => ({ ...(await orig<typeof import("@/lib/admin-products")>()), listAdminProducts: mocks.products }));
vi.mock("@/lib/admin-promotions", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-promotions")>()),
  listAdminPromotions: mocks.list, createAdminPromotion: mocks.create, updateAdminPromotion: mocks.update,
  setPromotionPublication: mocks.setPub, deleteAdminPromotion: mocks.del, newPromotionId: () => "11111111-1111-4111-8111-111111111111",
}));
vi.mock("@/lib/admin-images", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-images")>()),
  uploadPromotionImage: mocks.upload, removePromotionImage: mocks.removeImg,
}));

import { AdminError } from "@/lib/admin-api";
import { PromotionActionError, PromotionsNotInstalledError } from "@/lib/admin-promotions";
import { abidjanToday } from "@/lib/bookings";
import { fromRow, PROMO_NOTICE, type Promotion, type PromotionRow } from "@/lib/promotions";
import { Route } from "@/routes/admin.promotions";

const day = (n: number) => abidjanToday(new Date(Date.now() + n * 864e5));
const mk = (o: Partial<PromotionRow> & Pick<PromotionRow, "id" | "title">): Promotion => fromRow({
  description: null, image_url: null, kind: "announcement", original_price_fcfa: null, promo_price_fcfa: null, percent_off: null, starts_on: null, ends_on: null,
  status: "published", service_id: null, product_id: null, deleted_at: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...o,
});
const PHOTO = "https://x.supabase.co/storage/v1/object/public/catalog-images/promotions/active/1.webp";
const CATALOGUE: Promotion[] = [
  mk({ id: "active", title: "Massage duo", kind: "price", original_price_fcfa: 20000, promo_price_fcfa: 15000, starts_on: day(-2), ends_on: day(5), service_id: "massage-relaxant", image_url: PHOTO }),
  mk({ id: "open", title: "Soins sans limite", description: "Toujours là", kind: "percent", percent_off: 20 }),
  mk({ id: "scheduled", title: "Fête des mères", starts_on: day(10), ends_on: day(20) }),
  mk({ id: "expired", title: "Rentrée", kind: "percent", percent_off: 10, starts_on: day(-30), ends_on: day(-10) }),
  mk({ id: "draft", title: "Idée de brouillon", status: "draft" }),
  mk({ id: "disabled", title: "Ancienne promo", status: "disabled" }),
];

const Page = (Route as unknown as { component: () => ReactElement }).component;
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Page /></QueryClientProvider>);
}
const fill = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const row = (title: string) => (screen.getByText(title, { selector: "p" }).closest("tr") ?? screen.getByText(title, { selector: "p" }).closest("li"))!;
const titles = () => [...document.querySelectorAll("p.ap-product-name")].map((e) => e.textContent);

beforeEach(() => {
  mocks.mobile.value = false;
  mocks.list.mockReset().mockResolvedValue(CATALOGUE);
  mocks.create.mockReset().mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
  mocks.update.mockReset().mockResolvedValue(undefined);
  mocks.setPub.mockReset().mockResolvedValue(undefined);
  mocks.del.mockReset().mockResolvedValue(undefined);
  mocks.services.mockReset().mockResolvedValue([{ id: "massage-relaxant", name: "Massage relaxant" }, { id: "pedicure", name: "Pédicure soin" }]);
  mocks.products.mockReset().mockResolvedValue([{ id: "creme", name: "Crème éclat" }]);
  mocks.upload.mockReset().mockResolvedValue("https://x/new.webp");
  mocks.removeImg.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:apercu"), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("liste", () => {
  it("titre « Promotions », mention « informatives » et bouton de création", async () => {
    show();
    expect(await screen.findByRole("heading", { level: 1, name: "Promotions" })).toBeInTheDocument();
    expect(screen.getByText(/informatives : aucun tarif n'est modifié/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nouvelle promotion/ })).toBeInTheDocument();
    expect(screen.queryByText(/Offres/)).not.toBeInTheDocument();
  });

  it("colonnes : visuel, promotion, prix annoncés, réduction, période, statut, actions", async () => {
    show();
    await screen.findByText("Massage duo");
    for (const h of ["Promotion", "Prix annoncés", "Réduction", "Période", "Statut", "Actions"]) expect(screen.getByRole("columnheader", { name: h })).toBeInTheDocument();
    expect(titles()).toHaveLength(6);
  });

  it("prix initial barré, prix promotionnel et réduction calculée automatiquement (25 %)", async () => {
    show();
    await screen.findByText("Massage duo");
    const r = within(row("Massage duo") as HTMLElement);
    expect(r.getByText("20 000 FCFA")).toBeInTheDocument();
    expect(r.getByText("15 000 FCFA")).toBeInTheDocument();
    expect(r.getByText("-25%")).toBeInTheDocument();
    expect(within(row("Soins sans limite") as HTMLElement).getByText("-20%")).toBeInTheDocument();
  });

  it("statuts calculés à partir des dates : active, programmée, expirée, brouillon, désactivée", async () => {
    show();
    await screen.findByText("Massage duo");
    const status = (t: string) => within(row(t) as HTMLElement).getByText(/^(Active|Programmée|Expirée|Brouillon|Désactivée)$/).textContent;
    expect(status("Massage duo")).toBe("Active");
    expect(status("Soins sans limite")).toBe("Active");
    expect(status("Fête des mères")).toBe("Programmée");
    expect(status("Rentrée")).toBe("Expirée");
    expect(status("Idée de brouillon")).toBe("Brouillon");
    expect(status("Ancienne promo")).toBe("Désactivée");
  });

  it("une promotion sans date est gérée : « Sans limite de dates »", async () => {
    show();
    await screen.findByText("Soins sans limite");
    expect(within(row("Soins sans limite") as HTMLElement).getByText("Sans limite de dates")).toBeInTheDocument();
  });

  it("recherche par titre ou description, insensible à la casse et aux accents", async () => {
    show();
    await screen.findByText("Massage duo");
    fireEvent.change(screen.getByLabelText("Rechercher une promotion"), { target: { value: "FETE" } });
    expect(titles()).toEqual(["Fête des mères"]);
    fireEvent.change(screen.getByLabelText("Rechercher une promotion"), { target: { value: "toujours" } });
    expect(titles()).toEqual(["Soins sans limite"]);
    fireEvent.change(screen.getByLabelText("Rechercher une promotion"), { target: { value: "zzz" } });
    expect(await screen.findByText("Aucun résultat")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Réinitialiser les filtres" })[0]!);
    expect(titles()).toHaveLength(6);
  });

  it("filtre par statut", async () => {
    show();
    await screen.findByText("Massage duo");
    const f = screen.getByLabelText("Filtrer par statut");
    fireEvent.change(f, { target: { value: "scheduled" } });
    expect(titles()).toEqual(["Fête des mères"]);
    fireEvent.change(f, { target: { value: "expired" } });
    expect(titles()).toEqual(["Rentrée"]);
    fireEvent.change(f, { target: { value: "active" } });
    expect(titles().sort()).toEqual(["Massage duo", "Soins sans limite"]);
    fireEvent.change(f, { target: { value: "draft" } });
    expect(titles()).toEqual(["Idée de brouillon"]);
    fireEvent.change(f, { target: { value: "disabled" } });
    expect(titles()).toEqual(["Ancienne promo"]);
  });

  it("filtre par période de validité (d'après les dates)", async () => {
    show();
    await screen.findByText("Massage duo");
    const f = screen.getByLabelText("Filtrer par période");
    fireEvent.change(f, { target: { value: "current" } });
    expect(titles()).toEqual(["Massage duo"]);
    fireEvent.change(f, { target: { value: "upcoming" } });
    expect(titles()).toEqual(["Fête des mères"]);
    fireEvent.change(f, { target: { value: "past" } });
    expect(titles()).toEqual(["Rentrée"]);
    fireEvent.change(f, { target: { value: "none" } });
    expect(titles().sort()).toEqual(["Ancienne promo", "Idée de brouillon", "Soins sans limite"]);
  });

  it("états : chargement, erreur avec « Réessayer », vide, migration non appliquée", async () => {
    mocks.list.mockReturnValue(new Promise(() => {}));
    show();
    expect(await screen.findByLabelText("Chargement")).toBeInTheDocument();
    cleanup();
    mocks.list.mockReset().mockRejectedValueOnce(new AdminError("network", "x")).mockResolvedValue(CATALOGUE);
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Réessayer/ }));
    expect(await screen.findByText("Massage duo")).toBeInTheDocument();
    cleanup();
    mocks.list.mockReset().mockResolvedValue([]);
    show();
    expect(await screen.findByText("Aucune promotion")).toBeInTheDocument();
    cleanup();
    mocks.list.mockReset().mockRejectedValue(new PromotionsNotInstalledError());
    show();
    expect(await screen.findByText("Promotions non installées")).toBeInTheDocument();
    expect(screen.getByText(/20261029000000_promotions\.sql/)).toBeInTheDocument();
  });

  it("mobile : cartes avec les mêmes informations et actions", async () => {
    mocks.mobile.value = true;
    show();
    await screen.findByText("Massage duo");
    const r = within(row("Massage duo") as HTMLElement);
    expect(r.getByText("15 000 FCFA")).toBeInTheDocument();
    expect(r.getByRole("button", { name: "Modifier Massage duo" })).toBeInTheDocument();
    expect(r.getByRole("button", { name: "Supprimer Massage duo" })).toBeInTheDocument();
  });
});

describe("consulter", () => {
  it("aperçu tel que vu sur le site, avec la mention d'information ; aucun bouton d'action", async () => {
    show();
    await screen.findByText("Massage duo");
    fireEvent.click(screen.getByRole("button", { name: "Consulter Massage duo" }));
    const d = await screen.findByRole("dialog");
    expect(within(d).getByText("-25%")).toBeInTheDocument();
    expect(within(d).getByText(PROMO_NOTICE)).toBeInTheDocument();
    expect(within(d).queryByRole("link")).not.toBeInTheDocument();
    expect(within(d).getByText(/Prestation : Massage relaxant/)).toBeInTheDocument();
  });
});

describe("activer / désactiver", () => {
  it("désactiver une promotion publiée : setPromotionPublication(id, 'disabled')", async () => {
    show();
    await screen.findByText("Massage duo");
    fireEvent.click(screen.getByRole("button", { name: "Désactiver Massage duo" }));
    await waitFor(() => expect(mocks.setPub).toHaveBeenCalledWith("active", "disabled"));
    expect(await screen.findByText(/« Massage duo » est désactivée/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });

  it("activer un brouillon dans sa période : publiée et visible", async () => {
    show();
    await screen.findByText("Idée de brouillon");
    fireEvent.click(screen.getByRole("button", { name: "Activer Idée de brouillon" }));
    await waitFor(() => expect(mocks.setPub).toHaveBeenCalledWith("draft", "published"));
    expect(await screen.findByText(/« Idée de brouillon » est activée : elle apparaît sur le site/)).toBeInTheDocument();
  });

  it("activer une promotion programmée : prévient qu'elle n'apparaîtra qu'à partir de sa date", async () => {
    mocks.list.mockResolvedValue([mk({ id: "s", title: "Future", status: "draft", starts_on: day(10), ends_on: day(20) })]);
    show();
    await screen.findByText("Future");
    fireEvent.click(screen.getByRole("button", { name: "Activer Future" }));
    expect(await screen.findByText(/publiée mais programmée/)).toBeInTheDocument();
  });

  it("activer une promotion dont la période est terminée : prévient qu'elle n'apparaît pas", async () => {
    mocks.list.mockResolvedValue([mk({ id: "e", title: "Passée", status: "disabled", starts_on: day(-20), ends_on: day(-5) })]);
    show();
    await screen.findByText("Passée");
    fireEvent.click(screen.getByRole("button", { name: "Activer Passée" }));
    expect(await screen.findByText(/sa période est terminée : elle n'apparaît pas sur le site/)).toBeInTheDocument();
  });

  it("échec : message d'erreur, rien de présenté comme réussi", async () => {
    mocks.setPub.mockRejectedValue(new PromotionActionError("not_found", "Promotion introuvable ou accès refusé : rien n'a été modifié."));
    show();
    await screen.findByText("Massage duo");
    fireEvent.click(screen.getByRole("button", { name: "Désactiver Massage duo" }));
    expect(await screen.findByText(/rien n'a été modifié/)).toBeInTheDocument();
    expect(screen.queryByText(/est désactivée/)).not.toBeInTheDocument();
  });
});

describe("suppression (logique) avec confirmation", () => {
  it("demande confirmation ; annuler ne supprime rien", async () => {
    show();
    await screen.findByText("Massage duo");
    fireEvent.click(screen.getByRole("button", { name: "Supprimer Massage duo" }));
    const d = await screen.findByRole("alertdialog");
    expect(within(d).getByText(/Les prestations et produits concernés ne sont pas modifiés/)).toBeInTheDocument();
    fireEvent.click(within(d).getByRole("button", { name: "Annuler" }));
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("confirmer : deleteAdminPromotion(id), liste rechargée, message", async () => {
    show();
    await screen.findByText("Massage duo");
    fireEvent.click(screen.getByRole("button", { name: "Supprimer Massage duo" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(mocks.del).toHaveBeenCalledWith("active"));
    expect(await screen.findByText(/« Massage duo » est supprimée/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });

  it("double clic sur « Supprimer » : une seule suppression", async () => {
    let done!: () => void;
    mocks.del.mockReturnValue(new Promise<void>((r) => { done = r; }));
    show();
    await screen.findByText("Massage duo");
    fireEvent.click(screen.getByRole("button", { name: "Supprimer Massage duo" }));
    const b = within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Supprimer" });
    fireEvent.click(b); fireEvent.click(b);
    await waitFor(() => expect(mocks.del).toHaveBeenCalledTimes(1));
    done();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(mocks.del).toHaveBeenCalledTimes(1);
  });

  it("échec : message d'erreur", async () => {
    mocks.del.mockRejectedValue(new AdminError("forbidden", "Accès refusé."));
    show();
    await screen.findByText("Massage duo");
    fireEvent.click(screen.getByRole("button", { name: "Supprimer Massage duo" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Supprimer" }));
    expect(await screen.findByText("Accès refusé.")).toBeInTheDocument();
  });
});

describe("création", () => {
  const open = async () => {
    show();
    await screen.findByText("Massage duo");
    fireEvent.click(screen.getByRole("button", { name: /Nouvelle promotion/ }));
    await screen.findByRole("dialog");
  };
  const submitName = "Créer la promotion";

  it("formulaire : visuel, titre, description, type, prix selon le type, lien, dates, statut", async () => {
    await open();
    for (const l of [/^Titre de la promotion/, /^Description/, /^Type de promotion/, /^Concerne/, /^Date de début/, /^Date de fin/, /^Statut/]) expect(screen.getByLabelText(l)).toBeInTheDocument();
    expect(screen.getByLabelText("Choisir un visuel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajouter un visuel" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Prix initial/)).not.toBeInTheDocument();
    fill(/^Type de promotion/, "price");
    expect(screen.getByLabelText(/^Prix initial annoncé/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Prix promotionnel annoncé/)).toBeInTheDocument();
    expect(screen.getByText(PROMO_NOTICE)).toBeInTheDocument();
    fill(/^Type de promotion/, "percent");
    expect(screen.getByLabelText(/^Pourcentage de réduction annoncé/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Prix initial/)).not.toBeInTheDocument();
    fill(/^Type de promotion/, "announcement");
    expect(screen.queryByText(PROMO_NOTICE)).not.toBeInTheDocument();
  });

  it("annonce simple : titre seul, créée en brouillon sans lien ni date", async () => {
    await open();
    fill(/^Titre de la promotion/, "  Soirée spa  ");
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", {
      title: "Soirée spa", description: "", kind: "announcement", originalPrice: null, promoPrice: null, percentOff: null,
      startsOn: null, endsOn: null, publication: "draft", serviceId: null, productId: null,
    });
    expect(await screen.findByText(/« Soirée spa » a été créée/)).toBeInTheDocument();
  });

  it("type prix : réduction calculée en direct, enregistrement des deux prix saisis, lien vers une prestation, dates, publiée", async () => {
    await open();
    fill(/^Titre de la promotion/, "Massage duo");
    fill(/^Type de promotion/, "price");
    fill(/^Prix initial annoncé/, "20 000");
    fill(/^Prix promotionnel annoncé/, "15000");
    expect(screen.getByText("Réduction calculée : -25%.")).toBeInTheDocument();
    fill(/^Concerne/, "service");
    fill(/^Prestation/, "massage-relaxant");
    fill(/^Date de début/, "2026-11-01");
    fill(/^Date de fin/, "2026-11-30");
    fill(/^Statut/, "published");
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0]![1]).toMatchObject({
      kind: "price", originalPrice: 20000, promoPrice: 15000, percentOff: null, startsOn: "2026-11-01", endsOn: "2026-11-30",
      publication: "published", serviceId: "massage-relaxant", productId: null,
    });
  });

  it("type pourcentage + produit", async () => {
    await open();
    fill(/^Titre de la promotion/, "Crème -20 %");
    fill(/^Type de promotion/, "percent");
    fill(/^Pourcentage de réduction annoncé/, "20");
    fill(/^Concerne/, "product");
    fill(/^Produit/, "creme");
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0]![1]).toMatchObject({ kind: "percent", percentOff: 20, originalPrice: null, promoPrice: null, productId: "creme", serviceId: null });
  });

  it("changer le type de lien vide l'élément choisi", async () => {
    await open();
    fill(/^Concerne/, "service");
    fill(/^Prestation/, "pedicure");
    fill(/^Concerne/, "product");
    expect(screen.getByLabelText(/^Produit/)).toHaveValue("");
  });

  it("validation : rien n'est envoyé tant que le formulaire est invalide, messages affichés", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText(/Indiquez le titre de la promotion/)).toBeInTheDocument();
    fill(/^Titre de la promotion/, "Test");
    fill(/^Type de promotion/, "price");
    fill(/^Prix initial annoncé/, "100");
    fill(/^Prix promotionnel annoncé/, "200");
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText("Le prix promotionnel doit être inférieur au prix initial.")).toBeInTheDocument();
    fill(/^Type de promotion/, "percent");
    fill(/^Pourcentage de réduction annoncé/, "100");
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText("Pourcentage de réduction : de 1 à 99.")).toBeInTheDocument();
    fill(/^Type de promotion/, "announcement");
    fill(/^Date de début/, "2026-11-30");
    fill(/^Date de fin/, "2026-11-01");
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText("La date de fin ne peut pas précéder la date de début.")).toBeInTheDocument();
    fill(/^Concerne/, "service");
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText("Choisissez la prestation concernée.")).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refus de la base : message affiché, formulaire conservé, rien présenté comme créé", async () => {
    mocks.create.mockRejectedValue(new PromotionActionError("invalid_input", "Valeurs refusées par la base (type, prix, pourcentage, dates ou lien incohérents)."));
    await open();
    fill(/^Titre de la promotion/, "Soirée spa");
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText(/Valeurs refusées par la base/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Titre de la promotion/)).toHaveValue("Soirée spa");
    expect(screen.queryByText(/a été créée/)).not.toBeInTheDocument();
  });

  it("double clic : une seule création, bouton désactivé pendant l'envoi", async () => {
    let done!: (v: { id: string }) => void;
    mocks.create.mockReturnValue(new Promise((r) => { done = r; }));
    await open();
    fill(/^Titre de la promotion/, "Soirée spa");
    const b = screen.getByRole("button", { name: submitName });
    fireEvent.click(b); fireEvent.click(b);
    expect(await screen.findByRole("button", { name: "Création…" })).toBeDisabled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    done({ id: "x" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("visuel : envoyé après la création, sous l'identifiant de la promotion, avec aperçu", async () => {
    await open();
    fill(/^Titre de la promotion/, "Soirée spa");
    const file = new File(["x"], "affiche.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Choisir un visuel"), { target: { files: [file] } });
    expect(screen.getByText(/Nouveau visuel : il sera enregistré avec la promotion/)).toBeInTheDocument();
    expect(screen.getByAltText(/Aperçu du visuel : Soirée spa/)).toHaveAttribute("src", "blob:apercu");
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    expect(mocks.upload).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", file, null);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("visuel refusé (format) : message, rien n'est envoyé", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Choisir un visuel"), { target: { files: [new File(["x"], "a.gif", { type: "image/gif" })] } });
    expect(await screen.findByText(/Format non pris en charge/)).toBeInTheDocument();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("visuel en échec après la création : la promotion est créée, l'échec est expliqué, le réessai ne crée pas de doublon", async () => {
    mocks.upload.mockRejectedValueOnce(new AdminError("server", "Image trop lourde"));
    await open();
    fill(/^Titre de la promotion/, "Soirée spa");
    fireEvent.change(screen.getByLabelText("Choisir un visuel"), { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText(/a été créée, mais son visuel n'a pas pu être enregistré/)).toBeInTheDocument();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});

describe("modification", () => {
  const edit = async (title: string) => {
    show();
    await screen.findByText(title);
    fireEvent.click(screen.getByRole("button", { name: `Modifier ${title}` }));
    await screen.findByRole("dialog");
  };

  it("formulaire prérempli (prix, dates, lien, statut) ; visuel actuel affiché avec « Remplacer le visuel »", async () => {
    await edit("Massage duo");
    expect(screen.getByLabelText(/^Titre de la promotion/)).toHaveValue("Massage duo");
    expect(screen.getByLabelText(/^Type de promotion/)).toHaveValue("price");
    expect(screen.getByLabelText(/^Prix initial annoncé/)).toHaveValue("20000");
    expect(screen.getByLabelText(/^Prix promotionnel annoncé/)).toHaveValue("15000");
    expect(screen.getByLabelText(/^Concerne/)).toHaveValue("service");
    expect(screen.getByLabelText(/^Prestation/)).toHaveValue("massage-relaxant");
    expect(screen.getByLabelText(/^Date de début/)).toHaveValue(CATALOGUE[0]!.startsOn);
    expect(screen.getByLabelText(/^Statut/)).toHaveValue("published");
    expect(screen.getByRole("button", { name: "Remplacer le visuel" })).toBeInTheDocument();
    expect(screen.getByAltText(/Aperçu du visuel/)).toHaveAttribute("src", PHOTO);
  });

  it("enregistrer : updateAdminPromotion(id, données) ; aucune création", async () => {
    await edit("Massage duo");
    fill(/^Prix promotionnel annoncé/, "14000");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0]![0]).toBe("active");
    expect(mocks.update.mock.calls[0]![1]).toMatchObject({ originalPrice: 20000, promoPrice: 14000, serviceId: "massage-relaxant", publication: "published" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(await screen.findByText(/« Massage duo » a été modifiée/)).toBeInTheDocument();
  });

  it("changer de type vide les champs de l'ancien type dans les données envoyées", async () => {
    await edit("Massage duo");
    fill(/^Type de promotion/, "announcement");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0]![1]).toMatchObject({ kind: "announcement", originalPrice: null, promoPrice: null, percentOff: null });
  });

  it("remplacer le visuel : uploadPromotionImage(id, fichier, ancienne URL)", async () => {
    await edit("Massage duo");
    const file = new File(["x"], "n.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Choisir un visuel"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith("active", file, PHOTO));
  });

  it("retirer le visuel : removePromotionImage(id, ancienne URL) à l'enregistrement seulement", async () => {
    await edit("Massage duo");
    fireEvent.click(screen.getByRole("button", { name: "Retirer le visuel" }));
    expect(mocks.removeImg).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    await waitFor(() => expect(mocks.removeImg).toHaveBeenCalledWith("active", PHOTO));
  });

  it("sans action sur le visuel, il n'est jamais touché", async () => {
    await edit("Massage duo");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.removeImg).not.toHaveBeenCalled();
  });

  it("une promotion désactivée le reste après modification, sauf si on choisit « Publiée »", async () => {
    await edit("Ancienne promo");
    expect(screen.getByRole("option", { name: "Désactivée (non publiée)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0]![1]).toMatchObject({ publication: "disabled" });
  });

  it("promotion liée à une prestation absente de la liste : le lien reste sélectionné", async () => {
    mocks.list.mockResolvedValue([mk({ id: "z", title: "Orpheline", service_id: "disparue" })]);
    await edit("Orpheline");
    expect(screen.getByLabelText(/^Prestation/)).toHaveValue("disparue");
  });
});
