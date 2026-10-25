import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetch: vi.fn(), params: { productId: "" }, toast: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ ...opts, useParams: () => h.params }),
  Link: ({ children, to, params, className }: { children?: ReactNode; to: string; params?: Record<string, string>; className?: string }) => (
    <a href={params ? to.replace("$productId", params["productId"] ?? "") : to} className={className}>{children}</a>
  ),
  Outlet: () => null,
  useMatch: () => undefined,
}));
vi.mock("@/components/app", () => ({
  Img: ({ src, alt }: { src?: string; alt?: string }) => <img src={src ?? ""} alt={alt ?? ""} />,
}));
vi.mock("@/components/layout", () => ({ PageTitle: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("sonner", () => ({ toast: { success: h.toast } }));
vi.mock("@/lib/shop", async (orig) => ({
  ...(await orig<typeof import("@/lib/shop")>()),
  shopApi: { remote: true, fetchProducts: h.fetch },
}));

import { CartProvider, useCart } from "@/lib/cart";
import { toShopProduct, type ShopRow } from "@/lib/shop";
import { Route as ShopRoute } from "@/routes/boutique";
import { Route as ProductRoute } from "@/routes/boutique.$productId";
import { Route as CartRoute } from "@/routes/panier";

const row = (o: Partial<ShopRow>): ShopRow => ({
  id: "creme", name: "Crème éclat", category: "Hydratation", short_description: "Pour un teint lumineux", description: "Description de la crème",
  features: ["Texture légère"], usage_tips: "Matin et soir", volume: "50 ml", image_url: "https://x/creme.webp", sale_price: 9000, stock_qty: 7, ...o,
});
const CREME = toShopProduct(row({}));
const HUILE = toShopProduct(row({ id: "huile-caviar", name: "Huile Caviar", category: "Hydratation", sale_price: 8000, stock_qty: 10, image_url: null }));
const RUPTURE = toShopProduct(row({ id: "coffret-routine", name: "Coffret routine Dalanda", category: "Coffrets beauté", sale_price: 25000, stock_qty: 0, image_url: null }));
const INEDITE = toShopProduct(row({ id: "parfum", name: "Brume parfumée", category: "Parfums", sale_price: 3000, stock_qty: 2, image_url: null }));

const SLOW = { timeout: 4000 };
const comp = (r: unknown) => (r as { component: () => ReactElement }).component;
function mount(page: unknown, storedCart?: unknown[]) {
  localStorage.clear();
  if (storedCart) localStorage.setItem("dalanda-cart", JSON.stringify(storedCart));
  const Page = comp(page);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><CartProvider><Page /></CartProvider></QueryClientProvider>);
}

beforeEach(() => {
  h.fetch.mockReset().mockResolvedValue([CREME, HUILE, RUPTURE]);
  h.toast.mockReset();
  h.params.productId = "";
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe("boutique : liste lue dans le catalogue", () => {
  it("affiche les produits de la base (et non ceux du code), avec prix FCFA et indisponibilité", async () => {
    mount(ShopRoute);
    expect(await screen.findByText("Crème éclat")).toBeInTheDocument();
    expect(screen.getByText("9 000 FCFA")).toBeInTheDocument();
    expect(screen.getByText("Huile Caviar")).toBeInTheDocument();
    expect(screen.queryByText("Savon Mélisse 2 en 1")).not.toBeInTheDocument(); // produit du code, absent de la base simulée
    const rupture = screen.getByText("Coffret routine Dalanda").closest("article")!;
    expect(within(rupture).getByText("Indisponible")).toBeInTheDocument();
    expect(within(rupture).getByRole("button", { name: "Ajouter au panier" })).toBeDisabled();
  });

  it("chargement : squelette, aucun produit du code affiché en attendant", () => {
    h.fetch.mockReturnValue(new Promise(() => {}));
    mount(ShopRoute);
    expect(screen.getByLabelText("Chargement des produits")).toBeInTheDocument();
    expect(screen.queryByText("Savon Mélisse 2 en 1")).not.toBeInTheDocument();
  });

  it("erreur : message et « Réessayer », sans repli sur les produits du code", async () => {
    h.fetch.mockRejectedValue(new Error("catalogue indisponible")); // la requête réessaie une fois (1 s) avant d'afficher l'erreur
    mount(ShopRoute);
    expect(await screen.findByText(/Impossible de charger les produits/, {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByText("Savon Mélisse 2 en 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Aucun produit ne correspond à votre recherche.")).not.toBeInTheDocument();

    h.fetch.mockResolvedValue([CREME]);
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Crème éclat")).toBeInTheDocument();
  });

  it("catalogue vide : message dédié", async () => {
    h.fetch.mockResolvedValue([]);
    mount(ShopRoute);
    expect(await screen.findByText("Aucun produit n'est proposé pour le moment.")).toBeInTheDocument();
  });

  it("recherche, catégorie, « Disponibles » et tri par prix", async () => {
    mount(ShopRoute);
    await screen.findByText("Crème éclat");

    fireEvent.change(screen.getByLabelText("Rechercher"), { target: { value: "huile" } });
    expect(screen.getByText("Huile Caviar")).toBeInTheDocument();
    expect(screen.queryByText("Crème éclat")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Rechercher"), { target: { value: "zzz" } });
    expect(screen.getByText("Aucun produit ne correspond à votre recherche.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Rechercher"), { target: { value: "" } });

    fireEvent.change(screen.getByLabelText("Catégorie"), { target: { value: "Coffrets beauté" } });
    expect(screen.getByText("Coffret routine Dalanda")).toBeInTheDocument();
    expect(screen.queryByText("Huile Caviar")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Catégorie"), { target: { value: "" } });

    fireEvent.click(screen.getByLabelText("Disponibles"));
    expect(screen.queryByText("Coffret routine Dalanda")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Disponibles"));

    fireEvent.change(screen.getByLabelText("Trier"), { target: { value: "asc" } });
    const names = screen.getAllByRole("heading", { level: 3 }).map((e) => e.textContent);
    expect(names).toEqual(["Huile Caviar", "Crème éclat", "Coffret routine Dalanda"]);
  });

  it("catégories proposées : seulement celles du catalogue, y compris une catégorie inédite", async () => {
    h.fetch.mockResolvedValue([CREME, INEDITE]);
    mount(ShopRoute);
    await screen.findByText("Crème éclat");
    const options = within(screen.getByLabelText("Catégorie")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Toutes les catégories", "Hydratation", "Parfums"]);
    fireEvent.change(screen.getByLabelText("Catégorie"), { target: { value: "Parfums" } });
    expect(screen.getByText("Brume parfumée")).toBeInTheDocument();
    expect(screen.queryByText("Crème éclat")).not.toBeInTheDocument();
  });

  it("ajout au panier depuis la carte : prix de la base", async () => {
    function Probe() { const { lines } = useCart(); return <p data-testid="cart">{JSON.stringify(lines)}</p>; }
    localStorage.clear();
    const Page = comp(ShopRoute);
    render(<QueryClientProvider client={new QueryClient()}><CartProvider><Page /><Probe /></CartProvider></QueryClientProvider>);
    await screen.findByText("Crème éclat");
    fireEvent.click(within(screen.getByText("Crème éclat").closest("article")!).getByRole("button", { name: "Ajouter au panier" }));

    await waitFor(() => expect(JSON.parse(screen.getByTestId("cart").textContent!)).toEqual([{ id: "creme", name: "Crème éclat", price: 9000, qty: 1 }]));
    expect(h.toast).toHaveBeenCalledWith("Crème éclat ajouté au panier");
  });
});

describe("fiche produit", () => {
  it("affiche le produit du catalogue : prix, stock, description, caractéristiques, contenance, conseils", async () => {
    h.params.productId = "creme";
    mount(ProductRoute);
    expect(await screen.findByRole("heading", { level: 1, name: "Crème éclat" })).toBeInTheDocument();
    expect(screen.getByText("9 000 FCFA")).toBeInTheDocument();
    expect(screen.getByText(/Disponible · 7 en stock/)).toBeInTheDocument();
    expect(screen.getByText("Description de la crème")).toBeInTheDocument();
    expect(screen.getByText("Texture légère")).toBeInTheDocument();
    expect(screen.getByText("50 ml")).toBeInTheDocument();
    expect(screen.getByText("Matin et soir")).toBeInTheDocument();
    expect(screen.getByAltText("Crème éclat")).toHaveAttribute("src", "https://x/creme.webp");
    await waitFor(() => expect(document.title).toBe("Crème éclat | Dalanda Cosmétique"));
  });

  it("stock nul : « Momentanément indisponible », pas de bouton d'ajout", async () => {
    h.params.productId = "coffret-routine";
    mount(ProductRoute);
    expect(await screen.findByText("Momentanément indisponible")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajouter au panier" })).not.toBeInTheDocument();
  });

  it("quantité plafonnée au stock du catalogue", async () => {
    h.params.productId = "parfum";
    h.fetch.mockResolvedValue([INEDITE]);
    mount(ProductRoute);
    await screen.findByRole("heading", { level: 1, name: "Brume parfumée" });
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "Augmenter" }));
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("produit absent du catalogue (inactif ou inconnu) : « Produit introuvable » après la réponse du serveur", async () => {
    h.params.productId = "savon-melisse-2en1"; // existe dans le code, pas dans la base simulée
    mount(ProductRoute);
    expect(await screen.findByText("Produit introuvable")).toBeInTheDocument();
  });

  it("chargement puis erreur : ni « introuvable » ni produit du code", async () => {
    h.params.productId = "savon-melisse-2en1";
    h.fetch.mockRejectedValue(new Error("catalogue indisponible"));
    mount(ProductRoute);
    expect(screen.getByLabelText("Chargement du produit")).toBeInTheDocument();
    expect(await screen.findByText("Chargement impossible", {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByText("Produit introuvable")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });

  it("ajout au panier : quantité choisie, prix de la base", async () => {
    function Probe() { const { lines } = useCart(); return <p data-testid="cart">{JSON.stringify(lines)}</p>; }
    h.params.productId = "creme";
    localStorage.clear();
    const Page = comp(ProductRoute);
    render(<QueryClientProvider client={new QueryClient()}><CartProvider><Page /><Probe /></CartProvider></QueryClientProvider>);
    await screen.findByRole("heading", { level: 1, name: "Crème éclat" });
    fireEvent.click(screen.getByRole("button", { name: "Augmenter" }));
    fireEvent.click(screen.getByRole("button", { name: "Ajouter au panier" }));
    await waitFor(() => expect(JSON.parse(screen.getByTestId("cart").textContent!)).toEqual([{ id: "creme", name: "Crème éclat", price: 9000, qty: 2 }]));
  });
});

describe("panier synchronisé avec le catalogue", () => {
  it("prix mis à jour, quantité plafonnée au stock, article retiré de la vente signalé", async () => {
    const stored = [
      { id: "creme", name: "Crème éclat (ancien nom)", price: 1234, qty: 20 },
      { id: "produit-desactive", name: "Ancien produit", price: 4000, qty: 1 },
      { id: "coffret-routine", name: "Coffret routine Dalanda", price: 25000, qty: 1 },
    ];
    mount(CartRoute, stored);

    expect(await screen.findByRole("status")).toHaveTextContent(/ne sont plus disponibles/);
    expect(screen.getByRole("status")).toHaveTextContent("Ancien produit, Coffret routine Dalanda");
    const item = screen.getByText("Crème éclat").closest("li")!;
    expect(within(item).getByText("9 000 FCFA / unité")).toBeInTheDocument();
    expect(within(item).getByText("7")).toBeInTheDocument(); // plafonné au stock (7)
    expect(within(item).getByText("63 000 FCFA")).toBeInTheDocument();
    expect(screen.queryByText("Ancien produit", { selector: "a" })).not.toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem("dalanda-cart")!)).toEqual([{ id: "creme", name: "Crème éclat", price: 9000, qty: 7 }]));

    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("panier à jour : aucun message, aucune modification", async () => {
    mount(CartRoute, [{ id: "huile-caviar", name: "Huile Caviar", price: 8000, qty: 2 }]);
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());
    expect(await screen.findAllByText("16 000 FCFA")).not.toHaveLength(0);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("dalanda-cart")!)).toEqual([{ id: "huile-caviar", name: "Huile Caviar", price: 8000, qty: 2 }]);
  });

  it("tous les articles retirés : panier vide avec explication", async () => {
    mount(CartRoute, [{ id: "produit-desactive", name: "Ancien produit", price: 4000, qty: 1 }]);
    expect(await screen.findByText("Votre panier est vide")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Ancien produit");
  });

  it("catalogue injoignable : le panier enregistré est conservé tel quel (rien n'est supprimé par erreur)", async () => {
    h.fetch.mockRejectedValue(new Error("catalogue indisponible"));
    mount(CartRoute, [{ id: "huile-caviar", name: "Huile Caviar", price: 8000, qty: 2 }]);
    expect(await screen.findByText("Huile Caviar")).toBeInTheDocument();
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());
    expect(JSON.parse(localStorage.getItem("dalanda-cart")!)).toEqual([{ id: "huile-caviar", name: "Huile Caviar", price: 8000, qty: 2 }]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
