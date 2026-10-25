import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pages publiques (accueil, mobile, Prestations, Soins) : les catégories viennent du catalogue ; les 6 d'origine gardent libellés, textes,
// images et ordre ; une catégorie créée apparaît dès qu'elle a une prestation ; les adresses ?categorie= continuent de fonctionner.
const h = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  catalogue: null as unknown,
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ ...opts, useSearch: () => h.search }),
  Link: ({ children, to, search, params, className }: { children?: ReactNode; to: string; search?: Record<string, unknown>; params?: Record<string, string>; className?: string }) => (
    <a href={`${params ? to.replace("$serviceId", params["serviceId"] ?? "") : to}${search && Object.keys(search).length ? "?categorie=" + String(search["categorie"]) : ""}`} className={className}>{children}</a>
  ),
  useNavigate: () => h.navigate,
}));
vi.mock("@/components/app", () => ({
  Img: ({ src, alt }: { src?: string; alt?: string }) => <img src={src ?? ""} alt={alt ?? ""} />,
  LogoMark: () => <span>logo</span>,
  Screen: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/layout", () => ({ PageTitle: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/components/cards", () => ({
  ServiceCard: ({ s }: { s: { id: string; name: string } }) => <article data-testid="service">{s.name}</article>,
  ProductCard: () => null,
}));
vi.mock("@/components/mobile-home", async (orig) => ({ ...(await orig<typeof import("@/components/mobile-home")>()) }));
vi.mock("@/lib/shop-products", () => ({ useShopProducts: () => ({ products: [] }) }));
vi.mock("@/lib/catalogue", () => ({ useCatalogue: () => h.catalogue }));
vi.mock("sonner", () => ({ toast: vi.fn() }));

import { defaultCategoryImage, serviceCategories, services as localServices, type Service } from "@/data/services";
import { MobileHome } from "@/components/mobile-home";
import { buildCategories } from "@/lib/service-categories";
import { Route as HomeRoute } from "@/routes/index";
import { Route as PrestationsRoute } from "@/routes/prestations.index";
import { Route as SoinsRoute } from "@/routes/soins";

const comp = (r: unknown) => (r as { component: () => ReactElement }).component;
const validate = (r: unknown, s: Record<string, unknown>) => (r as { validateSearch: (s: Record<string, unknown>) => Record<string, unknown> }).validateSearch(s);

const svc = (id: string, category: string, name = id): Service => ({ id, name, category, description: `Description ${name}`, duration: "30 min", price: 5000, image: "" });
const SAUNA_ROW = { id: "sauna", label: "Sauna", title: "Sauna", description: "", image_url: null, sort_order: 70 };
const VIDE_ROW = { id: "vide", label: "Vide", title: "Vide", description: "", image_url: null, sort_order: 80 };
const setCatalogue = (services: Service[], rows: unknown[] = [SAUNA_ROW, VIDE_ROW]) => {
  h.catalogue = { services, categories: buildCategories(rows, services.map((s) => s.category)), timeSlots: [], rules: {}, source: "supabase", loaded: true, isError: false, refetch: vi.fn() };
};

beforeEach(() => { h.search = {}; h.navigate.mockReset(); setCatalogue([...localServices, svc("sauna-vapeur", "sauna", "Sauna vapeur")]); });
afterEach(cleanup);

describe("adresses ?categorie=", () => {
  it("Prestations et Soins : les identifiants d'origine, les nouveaux identifiants et leur format sont acceptés ; le reste est ignoré", () => {
    for (const r of [PrestationsRoute, SoinsRoute]) {
      for (const id of ["visage", "massage", "corps", "onglerie", "coiffure", "spa", "sauna", "soins-du-dos"]) expect(validate(r, { categorie: id })).toEqual({ categorie: id });
      for (const bad of ["", "Visage", "x y", "<b>", 3, undefined]) expect(validate(r, { categorie: bad })).toEqual({});
      expect(validate(r, {})).toEqual({});
    }
  });
});

describe("page Prestations", () => {
  const chips = () => screen.getAllByRole("tab").map((t) => t.textContent);
  const Page = comp(PrestationsRoute);

  it("onglets : Tous + les 6 catégories d'origine dans l'ordre actuel, puis la nouvelle catégorie ; une catégorie sans prestation est masquée", () => {
    render(<Page />);
    expect(chips()).toEqual(["Tous", "Visage", "Massage", "Corps", "Onglerie", "Coiffure", "Spa", "Sauna"]);
    expect(chips()).not.toContain("Vide");
  });

  it("une catégorie d'origine sans prestation active n'est pas proposée", () => {
    setCatalogue(localServices.filter((s) => s.category !== "spa"));
    render(<Page />);
    expect(chips()).toEqual(["Tous", "Visage", "Massage", "Corps", "Onglerie", "Coiffure"]);
  });

  it("une nouvelle catégorie n'apparaît qu'avec sa première prestation", () => {
    setCatalogue(localServices);
    render(<Page />);
    expect(chips()).not.toContain("Sauna");
    cleanup();
    setCatalogue([...localServices, svc("sauna-vapeur", "sauna")]);
    render(<Page />);
    expect(chips()).toContain("Sauna");
  });

  it("filtre par la nouvelle catégorie : seules ses prestations sont listées", () => {
    h.search = { categorie: "sauna" };
    render(<Page />);
    expect(screen.getByRole("tab", { name: "Sauna" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Sauna vapeur")).toBeInTheDocument();
    expect(screen.queryByText("Massage relaxant")).not.toBeInTheDocument();
  });

  it("filtre d'une catégorie d'origine inchangé", () => {
    h.search = { categorie: "massage" };
    render(<Page />);
    expect(screen.getByText("Massage relaxant")).toBeInTheDocument();
    expect(screen.queryByText("Pédicure soin")).not.toBeInTheDocument();
    expect(screen.queryByText("Sauna vapeur")).not.toBeInTheDocument();
  });

  it("catégorie inconnue dans l'adresse : toutes les prestations, onglet « Tous » actif", () => {
    h.search = { categorie: "inexistante" };
    render(<Page />);
    expect(screen.getByRole("tab", { name: "Tous" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Sauna vapeur")).toBeInTheDocument();
    expect(screen.getByText("Massage relaxant")).toBeInTheDocument();
  });

  it("cliquer sur l'onglet de la nouvelle catégorie met à jour l'adresse", () => {
    render(<Page />);
    fireEvent.click(screen.getByRole("tab", { name: "Sauna" }));
    expect(h.navigate).toHaveBeenCalledWith({ search: { categorie: "sauna" } });
  });
});

describe("page Soins (ordinateur)", () => {
  const Page = comp(SoinsRoute);
  const filters = () => screen.getAllByRole("link").map((a) => a.textContent);

  it("filtres : Tous les soins + 6 catégories d'origine dans l'ordre, puis la nouvelle ; liens vers ?categorie=", () => {
    render(<Page />);
    expect(filters()).toEqual(["Tous les soins", "Visage", "Massage", "Corps", "Onglerie", "Coiffure", "Spa", "Sauna"]);
    expect(screen.getByRole("link", { name: "Sauna" })).toHaveAttribute("href", "/soins?categorie=sauna");
    expect(screen.getByRole("link", { name: "Visage" })).toHaveAttribute("href", "/soins?categorie=visage");
  });

  it("catégorie sans prestation masquée", () => {
    setCatalogue(localServices, [SAUNA_ROW]);
    render(<Page />);
    expect(filters()).not.toContain("Sauna");
  });

  it("filtre sur la nouvelle catégorie", () => {
    h.search = { categorie: "sauna" };
    render(<Page />);
    expect(screen.getAllByTestId("service").map((e) => e.textContent)).toEqual(["Sauna vapeur"]);
  });

  it("sans filtre : toutes les prestations, y compris celles d'une nouvelle catégorie", () => {
    render(<Page />);
    expect(screen.getAllByTestId("service")).toHaveLength(localServices.length + 1);
  });
});

describe("accueil (ordinateur)", () => {
  const Page = comp(HomeRoute);
  const cards = () => screen.getAllByRole("heading", { level: 3 }).filter((x) => x.closest("article")?.querySelector("a[href*='/soins']")).map((x) => x.textContent);

  it("cartes : les 6 catégories d'origine avec leurs titres, textes et images actuels, dans l'ordre, puis la nouvelle", () => {
    render(<Page />);
    expect(cards()).toEqual([...serviceCategories.map((c) => c.title), "Sauna"]);
    for (const c of serviceCategories) {
      const card = screen.getByRole("heading", { level: 3, name: c.title }).closest("article")!;
      expect(within(card).getByText(c.description)).toBeInTheDocument();
      expect(within(card).getByRole("img")).toHaveAttribute("src", c.image);
      expect(within(card).getByRole("link", { name: /Découvrir/ })).toHaveAttribute("href", `/soins?categorie=${c.id}`);
    }
  });

  it("la nouvelle catégorie reçoit l'image par défaut et un lien vers son filtre", () => {
    render(<Page />);
    const card = screen.getByRole("heading", { level: 3, name: "Sauna" }).closest("article")!;
    expect(within(card).getByRole("img")).toHaveAttribute("src", defaultCategoryImage);
    expect(within(card).getByRole("link", { name: /Découvrir/ })).toHaveAttribute("href", "/soins?categorie=sauna");
  });

  it("catégorie sans prestation active : aucune carte", () => {
    render(<Page />);
    expect(cards()).not.toContain("Vide");
  });

  it("une catégorie d'origine sans prestation active n'a plus de carte", () => {
    setCatalogue(localServices.filter((s) => s.category !== "spa"), []);
    render(<Page />);
    expect(cards()).not.toContain("Rituels beauté et spa");
  });
});

describe("accueil mobile", () => {
  it("les 5 raccourcis d'origine sont inchangés ; une nouvelle catégorie active s'y ajoute", () => {
    render(<MobileHome />);
    for (const [label, id] of [["Soins visage", "visage"], ["Soins corps", "corps"], ["Coiffure", "coiffure"], ["Massages", "massage"], ["Onglerie", "onglerie"]] as const) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", `/prestations?categorie=${id}`);
    }
    expect(screen.getByRole("link", { name: "Sauna" })).toHaveAttribute("href", "/prestations?categorie=sauna");
    expect(screen.queryByRole("link", { name: "Vide" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nos offres" })).toBeInTheDocument();
  });

  it("sans nouvelle catégorie : rien n'est ajouté", () => {
    setCatalogue(localServices, []);
    render(<MobileHome />);
    expect(screen.queryByRole("link", { name: "Sauna" })).not.toBeInTheDocument();
  });
});
