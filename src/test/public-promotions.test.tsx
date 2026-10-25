import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pages publiques des promotions : /promotions, section de l'accueil mobile, onglet de navigation, redirection de /offres.
// Les promotions sont INFORMATIVES : les prix affichés sont ceux saisis dans la promotion, la mention d'information est toujours visible.
const h = vi.hoisted(() => ({ reply: { data: [] as unknown, error: null as null | { code?: string; message?: string; status?: number } }, search: {} as Record<string, unknown> }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  redirect: (o: unknown) => ({ redirectTo: o }),
  Link: ({ children, to, params, search, className }: { children?: ReactNode; to: string; params?: Record<string, string>; search?: Record<string, string>; className?: string }) => {
    let href = params ? Object.entries(params).reduce((acc, [k, v]) => acc.replace(`$${k}`, v), to) : to;
    if (search) href += "?" + Object.entries(search).map(([k, v]) => `${k}=${v}`).join("&");
    return <a href={href} className={className}>{children}</a>;
  },
  useRouter: () => ({ history: { back: () => {} } }),
}));
vi.mock("@/components/app", async () => ({
  Img: ({ src, alt }: { src?: string; alt?: string }) => <img src={src ?? ""} alt={alt ?? ""} />,
  AppBar: ({ title }: { title: string }) => <h1>{title}</h1>,
  Screen: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  LogoMark: () => <span>logo</span>,
}));
vi.mock("@/lib/supabase", () => ({
  adminSupabase: null,
  supabase: { from: () => ({ select: () => ({ order: () => Promise.resolve(h.reply) }) }) },
}));
vi.mock("@/lib/catalogue", () => ({ useCatalogue: () => ({ services: [], categories: [], timeSlots: [], rules: {}, source: "local", loaded: true, isError: false, refetch: () => {} }) }));
vi.mock("sonner", () => ({ toast: vi.fn() }));

import { MobileHome } from "@/components/mobile-home";
import { abidjanToday } from "@/lib/bookings";
import { PROMO_NOTICE, type PromotionRow } from "@/lib/promotions";
import { Route as OffresRoute } from "@/routes/offres";
import { Route as PromotionsRoute } from "@/routes/promotions";

const day = (n: number) => abidjanToday(new Date(Date.now() + n * 864e5));
const r = (o: Partial<PromotionRow> & Pick<PromotionRow, "id" | "title">): PromotionRow => ({
  description: null, image_url: null, kind: "announcement", original_price_fcfa: null, promo_price_fcfa: null, percent_off: null, starts_on: null, ends_on: null,
  status: "published", service_id: null, product_id: null, deleted_at: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", ...o,
});
const setRows = (rows: PromotionRow[]) => { h.reply = { data: rows, error: null }; };
const wrap = (ui: ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};
const Page = (PromotionsRoute as unknown as { component: () => ReactElement }).component;
const cards = () => screen.queryAllByTestId("promotion");

beforeEach(() => { h.reply = { data: [], error: null }; });
afterEach(cleanup);

describe("page /promotions", () => {
  it("titre « Nos promotions » ; plus aucun libellé « offres »", async () => {
    setRows([r({ id: "a", title: "Duo massage" })]);
    wrap(<Page />);
    expect(await screen.findByRole("heading", { level: 1, name: "Nos promotions" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/offre/i);
  });

  it("promotion à prix : prix initial barré et prix promotionnel SAISIS, réduction calculée, période, mention d'information", async () => {
    setRows([r({ id: "a", title: "Massage duo", description: "Pour deux", kind: "price", original_price_fcfa: 20000, promo_price_fcfa: 15000, starts_on: day(-1), ends_on: day(4) })]);
    wrap(<Page />);
    const card = within(await screen.findByTestId("promotion"));
    expect(card.getByRole("heading", { name: "Massage duo" })).toBeInTheDocument();
    expect(card.getByText("Pour deux")).toBeInTheDocument();
    expect(card.getByText("20 000 FCFA").tagName).toBe("S");
    expect(card.getByText("15 000 FCFA")).toBeInTheDocument();
    expect(card.getByText("-25%")).toBeInTheDocument();
    expect(card.getByText(/^(Du|Jusqu)/)).toBeInTheDocument();
    expect(card.getByText(PROMO_NOTICE)).toBeInTheDocument();
  });

  it("promotion en pourcentage : réduction annoncée + mention d'information", async () => {
    setRows([r({ id: "a", title: "Soins visage", kind: "percent", percent_off: 20 })]);
    wrap(<Page />);
    const card = within(await screen.findByTestId("promotion"));
    expect(card.getByText("Réduction annoncée : -20%")).toBeInTheDocument();
    expect(card.getByText(PROMO_NOTICE)).toBeInTheDocument();
  });

  it("pourcentage avec prix de référence annoncé : pastille, prix de référence identifié comme annoncé, AUCUN prix promotionnel calculé", async () => {
    setRows([r({ id: "a", title: "Soins -15 %", kind: "percent", percent_off: 15, original_price_fcfa: 20000, service_id: "massage-relaxant" })]);
    wrap(<Page />);
    const card = within(await screen.findByTestId("promotion"));
    expect(card.getByText("-15%")).toBeInTheDocument();
    expect(card.getByText("Réduction annoncée : -15%")).toBeInTheDocument();
    expect(card.getByText(/Prix de référence annoncé/)).toBeInTheDocument();
    expect(card.getByText("20 000 FCFA").tagName).toBe("S");
    expect(card.queryByText(/17\s?000/)).not.toBeInTheDocument(); // 20 000 - 15 % : jamais calculé
    expect(card.getByText(PROMO_NOTICE)).toBeInTheDocument();
  });

  it("pourcentage sans prix de référence : pastille seule, aucun prix affiché", async () => {
    setRows([r({ id: "a", title: "Soins -15 %", kind: "percent", percent_off: 15 })]);
    wrap(<Page />);
    const card = within(await screen.findByTestId("promotion"));
    expect(card.getByText("-15%")).toBeInTheDocument();
    expect(card.queryByText(/Prix de référence/)).not.toBeInTheDocument();
    expect(card.queryByText(/FCFA/)).not.toBeInTheDocument();
  });

  it("type prix incohérent en base (promotionnel >= initial) : aucune réduction affichée", async () => {
    setRows([r({ id: "a", title: "Incohérente", kind: "price", original_price_fcfa: 1000, promo_price_fcfa: 1000 })]);
    wrap(<Page />);
    const card = within(await screen.findByTestId("promotion"));
    expect(card.queryByText(/%$/)).not.toBeInTheDocument();
  });

  it("simple annonce : aucun prix, aucune pastille, aucune mention de prix ; sans date, sans lien, sans bouton", async () => {
    setRows([r({ id: "a", title: "Soirée spa", description: "Samedi soir" })]);
    wrap(<Page />);
    const card = within(await screen.findByTestId("promotion"));
    expect(card.queryByText(PROMO_NOTICE)).not.toBeInTheDocument();
    expect(card.queryByText(/%/)).not.toBeInTheDocument();
    expect(card.queryByRole("link")).not.toBeInTheDocument();
  });

  it("les promotions programmées, expirées, brouillons, désactivées et supprimées ne sont JAMAIS affichées (même si la base les renvoie à un administrateur)", async () => {
    setRows([
      r({ id: "1", title: "Active" }), r({ id: "2", title: "Programmée", starts_on: day(2), ends_on: day(9) }), r({ id: "3", title: "Expirée", starts_on: day(-9), ends_on: day(-1) }),
      r({ id: "4", title: "Brouillon", status: "draft" }), r({ id: "5", title: "Désactivée", status: "disabled" }), r({ id: "6", title: "Supprimée", deleted_at: "2026-10-02T00:00:00Z" }),
    ]);
    wrap(<Page />);
    await screen.findByText("Active");
    expect(cards()).toHaveLength(1);
    for (const t of ["Programmée", "Expirée", "Brouillon", "Désactivée", "Supprimée"]) expect(screen.queryByText(t)).not.toBeInTheDocument();
  });

  it("bornes : commence aujourd'hui, finit aujourd'hui, sans dates -> affichées", async () => {
    setRows([r({ id: "1", title: "Commence ce jour", starts_on: day(0) }), r({ id: "2", title: "Finit ce jour", ends_on: day(0) }), r({ id: "3", title: "Sans dates" })]);
    wrap(<Page />);
    await screen.findByText("Sans dates");
    expect(cards()).toHaveLength(3);
  });

  it("bouton vers une prestation : fiche de la prestation et réservation existante, sans remise appliquée", async () => {
    setRows([r({ id: "a", title: "Massage duo", kind: "price", original_price_fcfa: 20000, promo_price_fcfa: 15000, service_id: "massage-relaxant" })]);
    wrap(<Page />);
    const card = within(await screen.findByTestId("promotion"));
    expect(card.getByRole("link", { name: "Voir la prestation" })).toHaveAttribute("href", "/prestations/massage-relaxant?promo=a");
    expect(card.getByRole("link", { name: "Réserver" })).toHaveAttribute("href", "/reservation?service=massage-relaxant&promo=a");
    // L'identifiant de la promotion suit la navigation (suivi) ; aucun paramètre de prix ni de remise dans les liens
    for (const a of card.getAllByRole("link")) expect(a.getAttribute("href")).not.toMatch(/prix|price|remise|discount|percent|amount/i);
  });

  it("bouton vers un produit", async () => {
    setRows([r({ id: "a", title: "Crème -20 %", kind: "percent", percent_off: 20, product_id: "creme-eclat" })]);
    wrap(<Page />);
    const card = within(await screen.findByTestId("promotion"));
    expect(card.getByRole("link", { name: "Voir le produit" })).toHaveAttribute("href", "/boutique/creme-eclat?promo=a");
  });

  it("promotion la plus récente d'abord : l'ordre de la base est conservé", async () => {
    setRows([r({ id: "1", title: "Récente" }), r({ id: "2", title: "Ancienne" })]);
    wrap(<Page />);
    await screen.findByText("Récente");
    expect(screen.getAllByRole("heading", { level: 2 }).map((x) => x.textContent)).toEqual(["Récente", "Ancienne"]);
  });

  it("aucune promotion : état vide explicite", async () => {
    wrap(<Page />);
    expect(await screen.findByText("Aucune promotion en ce moment")).toBeInTheDocument();
  });

  it("migration non appliquée (table absente) : état vide, pas d'erreur", async () => {
    h.reply = { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.promotions' in the schema cache" } };
    wrap(<Page />);
    expect(await screen.findByText("Aucune promotion en ce moment")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("erreur de lecture : message et bouton « Réessayer »", async () => {
    h.reply = { data: null, error: { code: "XX000", message: "boom" } };
    wrap(<Page />);
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent("Les promotions n'ont pas pu être chargées");
    setRows([r({ id: "a", title: "Duo massage" })]);
    fireEvent.click(screen.getByRole("button", { name: /Réessayer/ }));
    expect(await screen.findByText("Duo massage")).toBeInTheDocument();
  });
});

describe("/offres : compatibilité", () => {
  it("l'ancienne adresse redirige vers /promotions (remplacement de l'historique)", async () => {
    const before = (OffresRoute as unknown as { beforeLoad: () => void }).beforeLoad;
    try { before(); throw new Error("pas de redirection"); } catch (e) {
      expect(e).toEqual({ redirectTo: { to: "/promotions", replace: true } });
    }
  });
});

describe("accueil mobile", () => {
  it("tuile « Nos promotions » vers /promotions ; plus de « Nos offres »", async () => {
    wrap(<MobileHome />);
    expect(screen.getByRole("link", { name: "Nos promotions" })).toHaveAttribute("href", "/promotions");
    expect(screen.queryByText(/offres/i)).not.toBeInTheDocument();
  });

  it("section « Promotions en cours » : seulement les promotions actives, prix saisis, mention d'information", async () => {
    setRows([
      r({ id: "1", title: "Massage duo", kind: "price", original_price_fcfa: 20000, promo_price_fcfa: 15000, service_id: "massage-relaxant" }),
      r({ id: "2", title: "Cachée", status: "draft" }), r({ id: "3", title: "Plus tard", starts_on: day(5) }),
    ]);
    wrap(<MobileHome />);
    const section = within(await screen.findByRole("region", { name: "Promotions en cours" }));
    expect(section.getByText("Massage duo")).toBeInTheDocument();
    expect(section.getByText("15 000 FCFA")).toBeInTheDocument();
    expect(section.getByText("-25%")).toBeInTheDocument();
    expect(section.queryByText("Cachée")).not.toBeInTheDocument();
    expect(section.queryByText("Plus tard")).not.toBeInTheDocument();
    expect(section.getByText(PROMO_NOTICE)).toBeInTheDocument();
    expect(section.getByRole("link", { name: /Massage duo/ })).toHaveAttribute("href", "/prestations/massage-relaxant?promo=1");
  });

  it("section masquée tant qu'il n'y a aucune promotion ou si la lecture échoue", async () => {
    wrap(<MobileHome />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Nos promotions" })).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "Promotions en cours" })).not.toBeInTheDocument();
    cleanup();
    h.reply = { data: null, error: { code: "XX000", message: "boom" } };
    wrap(<MobileHome />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Nos promotions" })).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "Promotions en cours" })).not.toBeInTheDocument();
  });

  it("une annonce sans lien mène à la page des promotions", async () => {
    setRows([r({ id: "1", title: "Soirée spa", description: "Samedi" })]);
    wrap(<MobileHome />);
    const section = within(await screen.findByRole("region", { name: "Promotions en cours" }));
    expect(section.getByRole("link", { name: /Soirée spa/ })).toHaveAttribute("href", "/promotions");
    expect(section.queryByText(PROMO_NOTICE)).not.toBeInTheDocument();
  });
});
