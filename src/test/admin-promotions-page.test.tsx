import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), create: vi.fn(), update: vi.fn(), setPub: vi.fn(), del: vi.fn(), services: vi.fn(), products: vi.fn(),
  upload: vi.fn(), removeImg: vi.fn(), stats: vi.fn(), attributed: vi.fn(), mobile: { value: false },
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
vi.mock("@/lib/admin-promotion-tracking", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-promotion-tracking")>()),
  getPromotionStats: mocks.stats, listPromotionBookings: mocks.attributed,
}));
vi.mock("@/lib/admin-images", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-images")>()),
  uploadPromotionImage: mocks.upload, removePromotionImage: mocks.removeImg,
}));

import { AdminError } from "@/lib/admin-api";
import { TrackingNotInstalledError, type PromotionStats } from "@/lib/admin-promotion-tracking";
import { PromotionActionError, PromotionsNotInstalledError } from "@/lib/admin-promotions";
import { abidjanToday } from "@/lib/bookings";
import { fromRow, KIND_DESCRIPTIONS, PROMO_NOTICE, type Promotion, type PromotionKind, type PromotionRow } from "@/lib/promotions";
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

const stat = (o: Partial<PromotionStats> & { promotionId: string }): PromotionStats => ({ impressions: 0, clicks: 0, bookingStarted: 0, bookingsCreated: 0, bookingsConfirmed: 0, bookingsCancelled: 0, ...o });
const STATS: Record<string, PromotionStats> = {
  active: stat({ promotionId: "active", impressions: 1240, clicks: 80, bookingStarted: 30, bookingsCreated: 8, bookingsConfirmed: 6, bookingsCancelled: 2 }),
  open: stat({ promotionId: "open", impressions: 10 }),
};

const KIND_NAME: Record<PromotionKind, RegExp> = { price: /^Prix promotionnel/, percent: /^Pourcentage de réduction/, announcement: /^Simple annonce/ };
const pick = (k: PromotionKind) => fireEvent.click(screen.getByRole("radio", { name: KIND_NAME[k] }));
const confirmKind = async () => fireEvent.click(await screen.findByRole("button", { name: "Changer le type" }));

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
  mocks.services.mockReset().mockResolvedValue([{ id: "massage-relaxant", name: "Massage relaxant", price: 20000 }, { id: "pedicure", name: "Pédicure soin", price: 8000 }]);
  mocks.products.mockReset().mockResolvedValue([{ id: "creme", name: "Crème éclat", price: 9000 }]);
  mocks.stats.mockReset().mockResolvedValue(STATS);
  mocks.attributed.mockReset().mockResolvedValue([]);
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
    for (const l of [/^Titre de la promotion/, /^Description/, /^Concerne/, /^Date de début/, /^Date de fin/, /^Statut/]) expect(screen.getByLabelText(l)).toBeInTheDocument();
    expect(screen.getByLabelText("Choisir un visuel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajouter un visuel" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Prix initial/)).not.toBeInTheDocument();
    pick("price");
    expect(screen.getByLabelText(/^Prix initial annoncé/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Prix promotionnel annoncé/)).toBeInTheDocument();
    expect(screen.getByText(PROMO_NOTICE)).toBeInTheDocument();
    pick("percent");
    expect(screen.getByLabelText(/^Pourcentage de réduction annoncé/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Prix de référence annoncé/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Prix initial/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Prix promotionnel annoncé/)).not.toBeInTheDocument();
    pick("announcement");
    expect(screen.queryByText(PROMO_NOTICE)).not.toBeInTheDocument();
  });

  it("annonce simple : titre seul, créée en brouillon sans lien ni date", async () => {
    await open();
    pick("announcement");
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
    pick("price");
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
    pick("percent");
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
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText("Choisissez un type de promotion.")).toBeInTheDocument();
    pick("price");
    fill(/^Prix initial annoncé/, "100");
    fill(/^Prix promotionnel annoncé/, "200");
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText("Le prix promotionnel doit être inférieur au prix initial.")).toBeInTheDocument();
    pick("percent");
    await confirmKind();
    fill(/^Pourcentage de réduction annoncé/, "100");
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText("Pourcentage de réduction : de 1 à 99.")).toBeInTheDocument();
    pick("announcement");
    await confirmKind();
    fill(/^Date de début/, "2026-11-30");
    fill(/^Date de fin/, "2026-11-01");
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText("La date de fin ne peut pas précéder la date de début.")).toBeInTheDocument();
    fill(/^Concerne/, "service");
    fireEvent.click(screen.getByRole("button", { name: submitName }));
    expect(await screen.findByText("Choisissez la prestation concernée.")).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  }, 20_000); // longue séquence de saisies : plus de 5 s quand la machine est chargée

  it("refus de la base : message affiché, formulaire conservé, rien présenté comme créé", async () => {
    mocks.create.mockRejectedValue(new PromotionActionError("invalid_input", "Valeurs refusées par la base (type, prix, pourcentage, dates ou lien incohérents)."));
    await open();
    pick("announcement");
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
    pick("announcement");
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
    pick("announcement");
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
    pick("announcement");
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
    expect(screen.getByRole("radio", { name: KIND_NAME.price })).toBeChecked();
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
    pick("announcement");
    await confirmKind();
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

describe("type explicite, réduction et prix annoncés", () => {
  const open = async () => {
    show();
    await screen.findByText("Massage duo");
    fireEvent.click(screen.getByRole("button", { name: /Nouvelle promotion/ }));
    await screen.findByRole("dialog");
  };
  const submit = () => fireEvent.click(screen.getByRole("button", { name: "Créer la promotion" }));

  it("aucun type préselectionné : trois choix, chacun avec sa description, aucun champ de prix", async () => {
    await open();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    for (const r of radios) expect(r).not.toBeChecked();
    for (const k of ["price", "percent", "announcement"] as const) expect(screen.getByText(KIND_DESCRIPTIONS[k])).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Prix initial/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Pourcentage de réduction annoncé/)).not.toBeInTheDocument();
  });

  it("enregistrer sans avoir choisi de type est impossible (c'était la cause de « la réduction ne s'affiche pas »)", async () => {
    await open();
    fill(/^Titre de la promotion/, "Promo");
    fill(/^Concerne/, "service");
    fill(/^Prestation/, "massage-relaxant");
    submit();
    expect(await screen.findByText("Choisissez un type de promotion.")).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("choisir une prestation ou un produit ne masque pas les champs de réduction", async () => {
    await open();
    pick("price");
    fill(/^Concerne/, "service");
    fill(/^Prestation/, "massage-relaxant");
    expect(screen.getByLabelText(/^Prix initial annoncé/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Prix promotionnel annoncé/)).toBeInTheDocument();
    pick("percent");
    fill(/^Concerne/, "product");
    fill(/^Produit/, "creme");
    expect(screen.getByLabelText(/^Pourcentage de réduction annoncé/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Prix de référence annoncé/)).toBeInTheDocument();
  });

  it("type prix lié à une prestation : les prix SAISIS sont enregistrés, pas le tarif du catalogue", async () => {
    await open();
    pick("price");
    fill(/^Titre de la promotion/, "Massage duo");
    fill(/^Concerne/, "service");
    fill(/^Prestation/, "massage-relaxant");
    fill(/^Prix initial annoncé/, "25000");
    fill(/^Prix promotionnel annoncé/, "18000");
    expect(screen.getByText("Réduction calculée : -28%.")).toBeInTheDocument();
    submit();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0]![1]).toMatchObject({ kind: "price", originalPrice: 25000, promoPrice: 18000, serviceId: "massage-relaxant" });
  });

  it("type pourcentage avec prix de référence annoncé : enregistré, sans prix promotionnel", async () => {
    await open();
    pick("percent");
    fill(/^Titre de la promotion/, "Soins -15 %");
    fill(/^Pourcentage de réduction annoncé/, "15");
    fill(/^Prix de référence annoncé/, "20 000");
    submit();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0]![1]).toMatchObject({ kind: "percent", percentOff: 15, originalPrice: 20000, promoPrice: null });
  });

  it("type pourcentage sans prix de référence : aucun prix enregistré", async () => {
    await open();
    pick("percent");
    fill(/^Titre de la promotion/, "Soins -15 %");
    fill(/^Pourcentage de réduction annoncé/, "15");
    submit();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0]![1]).toMatchObject({ kind: "percent", percentOff: 15, originalPrice: null, promoPrice: null });
  });

  it("prix de référence invalide : refusé", async () => {
    await open();
    pick("percent");
    fill(/^Titre de la promotion/, "Soins -15 %");
    fill(/^Pourcentage de réduction annoncé/, "15");
    fill(/^Prix de référence annoncé/, "abc");
    submit();
    expect(await screen.findByText("Prix de référence annoncé : nombre entier positif uniquement.")).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("aucun prix promotionnel n'est calculé pour le type pourcentage", async () => {
    await open();
    pick("percent");
    fill(/^Pourcentage de réduction annoncé/, "20");
    fill(/^Prix de référence annoncé/, "10000");
    expect(screen.queryByText(/Réduction calculée/)).not.toBeInTheDocument();
    expect(screen.queryByText(/8\s?000/)).not.toBeInTheDocument();
  });

  it("simple annonce : ni prix ni réduction imposés, enregistrée sans valeurs de prix", async () => {
    await open();
    pick("announcement");
    fill(/^Titre de la promotion/, "Soirée spa");
    fill(/^Concerne/, "service");
    fill(/^Prestation/, "pedicure");
    expect(screen.queryByLabelText(/^(Prix initial|Prix promotionnel annoncé|Prix de référence|Pourcentage de réduction annoncé)/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reprendre le tarif du catalogue" })).not.toBeInTheDocument();
    submit();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0]![1]).toMatchObject({ kind: "announcement", originalPrice: null, promoPrice: null, percentOff: null, serviceId: "pedicure" });
  });

  describe("« Reprendre le tarif du catalogue »", () => {
    it("absent sans cible choisie", async () => {
      await open();
      pick("price");
      expect(screen.queryByRole("button", { name: "Reprendre le tarif du catalogue" })).not.toBeInTheDocument();
    });

    it("copie le tarif actuel de la prestation dans le prix initial annoncé ; explicite, modifiable, enregistré comme prix annoncé", async () => {
      await open();
      pick("price");
      fill(/^Titre de la promotion/, "Massage duo");
      fill(/^Concerne/, "service");
      fill(/^Prestation/, "massage-relaxant");
      const b = screen.getByRole("button", { name: "Reprendre le tarif du catalogue" });
      expect(screen.getByText(/20 000 FCFA.*valeur de départ, modifiable : elle ne suit pas le tarif réel/)).toBeInTheDocument();
      expect(screen.getByLabelText(/^Prix initial annoncé/)).toHaveValue("");
      fireEvent.click(b);
      expect(screen.getByLabelText(/^Prix initial annoncé/)).toHaveValue("20000");
      fill(/^Prix initial annoncé/, "22000"); // modifiable
      fill(/^Prix promotionnel annoncé/, "17000");
      submit();
      await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
      expect(mocks.create.mock.calls[0]![1]).toMatchObject({ kind: "price", originalPrice: 22000, promoPrice: 17000 });
    });

    it("pour un produit et pour le type pourcentage : copie dans le prix de référence annoncé", async () => {
      await open();
      pick("percent");
      fill(/^Concerne/, "product");
      fill(/^Produit/, "creme");
      fireEvent.click(screen.getByRole("button", { name: "Reprendre le tarif du catalogue" }));
      expect(screen.getByLabelText(/^Prix de référence annoncé/)).toHaveValue("9000");
    });

    it("n'écrit rien tant qu'on ne clique pas, et n'appelle aucune écriture dans les prestations ou produits", async () => {
      await open();
      pick("price");
      fill(/^Concerne/, "service");
      fill(/^Prestation/, "massage-relaxant");
      expect(screen.getByLabelText(/^Prix initial annoncé/)).toHaveValue("");
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it("absent quand la cible n'a pas de tarif exploitable", async () => {
      mocks.services.mockResolvedValue([{ id: "massage-relaxant", name: "Massage relaxant", price: 0 }]);
      await open();
      pick("price");
      fill(/^Concerne/, "service");
      fill(/^Prestation/, "massage-relaxant");
      expect(screen.queryByRole("button", { name: "Reprendre le tarif du catalogue" })).not.toBeInTheDocument();
    });
  });

  describe("confirmation avant de perdre des valeurs", () => {
    it("changer de type avec des valeurs qui seraient perdues demande confirmation ; « Garder » ne change rien", async () => {
      await open();
      pick("price");
      fill(/^Prix initial annoncé/, "20000");
      fill(/^Prix promotionnel annoncé/, "15000");
      pick("announcement");
      const d = await screen.findByRole("alertdialog");
      expect(within(d).getByText(/prix initial \/ de référence annoncé, le prix promotionnel annoncé/)).toBeInTheDocument();
      fireEvent.click(within(d).getByRole("button", { name: "Garder le type actuel" }));
      expect(screen.getByRole("radio", { name: KIND_NAME.price })).toBeChecked();
      expect(screen.getByLabelText(/^Prix initial annoncé/)).toHaveValue("20000");
      expect(screen.getByLabelText(/^Prix promotionnel annoncé/)).toHaveValue("15000");
    });

    it("confirmer efface les valeurs concernées et change le type", async () => {
      await open();
      pick("price");
      fill(/^Prix initial annoncé/, "20000");
      fill(/^Prix promotionnel annoncé/, "15000");
      pick("announcement");
      await confirmKind();
      expect(screen.getByRole("radio", { name: KIND_NAME.announcement })).toBeChecked();
      pick("price");
      expect(screen.getByLabelText(/^Prix initial annoncé/)).toHaveValue("");
      expect(screen.getByLabelText(/^Prix promotionnel annoncé/)).toHaveValue("");
    });

    it("aucune confirmation quand rien n'est perdu : premier choix, formulaire vide, ou valeur conservée (prix initial -> référence)", async () => {
      await open();
      pick("price");
      pick("percent");
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      fill(/^Prix de référence annoncé/, "20000");
      pick("price");
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(screen.getByLabelText(/^Prix initial annoncé/)).toHaveValue("20000");
    });
  });

  it("modification d'un pourcentage avec prix de référence : valeurs relues et réenregistrées", async () => {
    mocks.list.mockResolvedValue([mk({ id: "p", title: "Soins -15 %", kind: "percent", percent_off: 15, original_price_fcfa: 20000 })]);
    show();
    await screen.findByText("Soins -15 %");
    fireEvent.click(screen.getByRole("button", { name: "Modifier Soins -15 %" }));
    await screen.findByRole("dialog");
    expect(screen.getByRole("radio", { name: KIND_NAME.percent })).toBeChecked();
    expect(screen.getByLabelText(/^Pourcentage de réduction annoncé/)).toHaveValue("15");
    expect(screen.getByLabelText(/^Prix de référence annoncé/)).toHaveValue("20000");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0]![1]).toMatchObject({ kind: "percent", percentOff: 15, originalPrice: 20000, promoPrice: null });
  });

  it("liste : un pourcentage avec prix de référence l'affiche comme « Réf. annoncée » et la pastille", async () => {
    mocks.list.mockResolvedValue([mk({ id: "p", title: "Soins -15 %", kind: "percent", percent_off: 15, original_price_fcfa: 20000 })]);
    show();
    await screen.findByText("Soins -15 %");
    const r = within(row("Soins -15 %") as HTMLElement);
    expect(r.getByText("20 000 FCFA")).toBeInTheDocument();
    expect(r.getByText(/Réf\. annoncée/)).toBeInTheDocument();
    expect(r.getByText("-15%")).toBeInTheDocument();
  });
});

describe("suivi : statistiques par promotion", () => {
  it("colonnes Impressions, Clics, Réservations et Conversion avec les chiffres de la base", async () => {
    show();
    await screen.findByText("Massage duo");
    for (const h of ["Impressions", "Clics", "Réservations", "Conversion"]) expect(screen.getByRole("columnheader", { name: h })).toBeInTheDocument();
    const r = within(row("Massage duo") as HTMLElement);
    expect(r.getByText("1 240")).toBeInTheDocument();
    expect(r.getByText("80")).toBeInTheDocument();
    expect(r.getByText(/\(6 conf\.\)/)).toBeInTheDocument();
    expect(r.getByText("10 %")).toBeInTheDocument(); // 8 / 80
  });

  it("conversion : tiret quand il n'y a aucun clic (jamais 0 % inventé) ; promotion sans suivi : zéros", async () => {
    show();
    await screen.findByText("Soins sans limite");
    const r = within(row("Soins sans limite") as HTMLElement);
    expect(r.getByText("10")).toBeInTheDocument();
    expect(r.queryByText(/^d+(,d)? %$/)).not.toBeInTheDocument(); // aucune conversion affichée
  });

  it("définitions et limites expliquées (dénominateur de la conversion, sessions, fenêtre de 30 minutes)", async () => {
    show();
    await screen.findByText("Massage duo");
    fireEvent.click(screen.getByText("Comment lire ces chiffres"));
    expect(screen.getByText(/Conversion = réservations créées attribuées ÷ clics uniques/)).toBeInTheDocument();
    expect(screen.getByText(/au moins 50 % de la bannière.*reste visible pendant 1 seconde, onglet au premier plan/)).toBeInTheDocument();
    expect(screen.getByText(/dans les 24 heures précédant la réservation, et si le rattachement est enregistré dans les 30 minutes suivant la création/)).toBeInTheDocument();
    expect(screen.getByText(/Statistiques indicatives : elles peuvent être faussées. Quelqu'un qui change d'adresse IP/)).toBeInTheDocument();
    expect(screen.getByText(/400 jours glissants/)).toBeInTheDocument();
    expect(screen.getByText(/lien partagé sans clic sur la bannière n'est pas attribué/)).toBeInTheDocument();
    expect(screen.getByText(/n'existent pas dans la base/)).toBeInTheDocument();
  });

  it("suivi non installé (migration non appliquée) : message d'information, tirets, la liste reste utilisable", async () => {
    mocks.stats.mockRejectedValue(new TrackingNotInstalledError());
    show();
    await screen.findByText("Massage duo");
    expect(await screen.findByText(/20261030000000_promotion_tracking\.sql/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modifier Massage duo" })).toBeInTheDocument();
    expect(screen.queryByText("1 240")).not.toBeInTheDocument();
  });

  it("autre erreur : message avec « Réessayer »", async () => {
    mocks.stats.mockRejectedValueOnce(new AdminError("network", "x")).mockResolvedValue(STATS);
    show();
    await screen.findByText("Massage duo");
    expect(await screen.findByText(/statistiques de suivi n'ont pas pu être chargées/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("1 240")).toBeInTheDocument();
  });

  it("vue détaillée : chiffres, conversion et réservations attribuées (client, téléphone, statut) réservées à l'administration", async () => {
    mocks.attributed.mockResolvedValue([
      { ref: "DLD-AAAAAAAAAA", name: "Aminata Koné", phone: "+225 07 07 07 07 07", serviceName: "Massage relaxant", date: "2026-11-02", slot: "10:30", status: "confirmed", price: 20000, createdAt: "2026-10-25T10:00:00Z", attributedAt: "2026-10-25T10:01:00Z" },
      { ref: "DLD-BBBBBBBBBB", name: "Awa Traoré", phone: "+225 05 05 05 05 05", serviceName: "Massage relaxant", date: "2026-11-03", slot: "09:00", status: "cancelled", price: 20000, createdAt: "2026-10-25T11:00:00Z", attributedAt: "2026-10-25T11:01:00Z" },
    ]);
    show();
    await screen.findByText("Massage duo");
    fireEvent.click(screen.getByRole("button", { name: "Consulter Massage duo" }));
    const d = await screen.findByRole("dialog");
    expect(await within(d).findByText(/Aminata Koné/)).toBeInTheDocument();
    expect(mocks.attributed).toHaveBeenCalledWith("active");
    expect(within(d).getByText(/\+225 07 07 07 07 07/)).toBeInTheDocument();
    expect(within(d).getByText("Confirmée")).toBeInTheDocument();
    expect(within(d).getByText("Annulée")).toBeInTheDocument();
    expect(within(d).getByText("DLD-AAAAAAAAAA")).toBeInTheDocument();
    expect(within(d).getByText(/Conversion \(8 réservation\(s\) ÷ 80 clic\(s\)\)/)).toBeInTheDocument();
    expect(within(d).getByText("10 %")).toBeInTheDocument();
    expect(within(d).getByText("Réservations démarrées").nextSibling).toHaveTextContent("30");
  });

  it("vue détaillée : aucune réservation attribuée, ou lecture en échec", async () => {
    show();
    await screen.findByText("Massage duo");
    fireEvent.click(screen.getByRole("button", { name: "Consulter Massage duo" }));
    expect(await within(await screen.findByRole("dialog")).findByText("Aucune réservation attribuée pour le moment.")).toBeInTheDocument();
    cleanup();
    mocks.attributed.mockRejectedValue(new AdminError("forbidden", "Accès refusé."));
    show();
    await screen.findByText("Massage duo");
    fireEvent.click(screen.getByRole("button", { name: "Consulter Massage duo" }));
    expect(await within(await screen.findByRole("dialog")).findByText(/n'ont pas pu être chargées/)).toBeInTheDocument();
  });

  it("l'aperçu de l'administration ne déclenche aucun suivi (pas d'impression ni de clic comptés)", async () => {
    show();
    await screen.findByText("Massage duo");
    fireEvent.click(screen.getByRole("button", { name: "Consulter Massage duo" }));
    const d = await screen.findByRole("dialog");
    expect(within(d).queryByRole("link")).not.toBeInTheDocument();
  });
});
