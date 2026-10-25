import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Suivi anonyme des promotions : session, déduplication (une fois par promotion, événement, session et jour), impression réellement visible,
// clics, aucune donnée personnelle, aucun envoi depuis l'aperçu administrateur.
const h = vi.hoisted(() => ({ rpc: vi.fn(), remote: { value: true } }));

vi.mock("@/lib/supabase", () => ({
  get supabase() { return h.remote.value ? { rpc: h.rpc } : null; },
  adminSupabase: null,
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ ...opts, useSearch: () => ({}) }),
  Link: ({ children, to, params, search, onClick, className }: { children?: ReactNode; to: string; params?: Record<string, string>; search?: Record<string, string>; onClick?: () => void; className?: string }) => (
    <a href={(params ? Object.entries(params).reduce((acc, [k, v]) => acc.replace("$" + k, v), to) : to) + (search ? "?" + new URLSearchParams(search).toString() : "")} onClick={(e) => { e.preventDefault(); onClick?.(); }} className={className}>{children}</a>
  ),
}));
vi.mock("@/components/app", () => ({ Img: ({ src }: { src?: string }) => <img src={src ?? ""} alt="" /> }));

import { PromotionCard } from "@/components/promotion-card";
import {
  IMPRESSION_MS, isVisibleEnough, parsePromoParam, resetPromotionTracking, sessionKey, trackPromotion, usePromotionImpression, utcDay,
} from "@/lib/promotion-tracking";
import { fromRow, type Promotion } from "@/lib/promotions";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DAY = "2026-10-25";
const promo = (o: Partial<Promotion> = {}): Promotion => ({
  ...fromRow({ id: ID, title: "Massage duo", description: null, image_url: null, kind: "announcement", original_price_fcfa: null, promo_price_fcfa: null, percent_off: null, starts_on: null, ends_on: null, status: "published", service_id: null, product_id: null, deleted_at: null, created_at: "", updated_at: "" }),
  ...o,
});

// --- Faux IntersectionObserver contrôlable
type Entry = { isIntersecting: boolean; intersectionRatio: number };
const observers: { cb: (e: Entry[]) => void; disconnected: boolean }[] = [];
class FakeObserver {
  disconnected = false;
  constructor(readonly cb: (e: Entry[]) => void) { observers.push(this); }
  observe() {}
  unobserve() {}
  disconnect() { this.disconnected = true; }
}
const see = (ratio: number) => act(() => { for (const o of observers.filter((x) => !x.disconnected)) o.cb([{ isIntersecting: ratio > 0, intersectionRatio: ratio }]); });

const calls = () => h.rpc.mock.calls.map((c) => c[1] as { p_promotion_id: string; p_event: string; p_session: string });

beforeEach(() => {
  h.remote.value = true;
  h.rpc.mockReset().mockResolvedValue({ data: { ok: true, counted: true }, error: null });
  observers.length = 0;
  resetPromotionTracking();
  window.localStorage.clear();
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("identifiant de promotion dans l'adresse", () => {
  it("accepte un UUID (insensible à la casse), refuse le reste", () => {
    expect(parsePromoParam(ID)).toBe(ID);
    expect(parsePromoParam(ID.toUpperCase())).toBe(ID);
    for (const bad of ["", "abc", "11111111-1111-4111-8111", ID + "x", "<script>", `${ID}' or 1=1`, 3, null, undefined, [ID]]) expect(parsePromoParam(bad)).toBeUndefined();
  });
});

describe("session anonyme", () => {
  it("32 caractères hexadécimaux aléatoires, stables pendant la visite, régénérés après réinitialisation", () => {
    const a = sessionKey();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(sessionKey()).toBe(a);
    expect(window.sessionStorage.getItem("dalanda.promo.session")).toBe(a);
    resetPromotionTracking();
    expect(sessionKey()).not.toBe(a);
  });
  it("deux visites différentes ont deux sessions sans rapport (hasard, aucune donnée du client)", () => {
    const a = sessionKey(); resetPromotionTracking(); const b = sessionKey();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("trackPromotion : déduplication et contenu des envois", () => {
  it("envoie exactement trois paramètres : promotion, événement, session — rien d'autre", async () => {
    await trackPromotion("click", ID, DAY);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc.mock.calls[0]![0]).toBe("track_promotion_event");
    expect(Object.keys(calls()[0]!).sort()).toEqual(["p_event", "p_promotion_id", "p_session"]);
    expect(calls()[0]).toEqual({ p_promotion_id: ID, p_event: "click", p_session: sessionKey() });
  });

  it("même promotion, même événement, même jour : un seul envoi, quel que soit le nombre d'appels", async () => {
    await Promise.all([trackPromotion("click", ID, DAY), trackPromotion("click", ID, DAY), trackPromotion("click", ID, DAY)]);
    await trackPromotion("click", ID, DAY);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("événements différents, promotions différentes : envoyés séparément", async () => {
    await trackPromotion("impression", ID, DAY);
    await trackPromotion("click", ID, DAY);
    await trackPromotion("booking_started", ID, DAY);
    await trackPromotion("click", OTHER, DAY);
    expect(calls().map((c) => `${c.p_promotion_id.slice(0, 2)}:${c.p_event}`)).toEqual(["11:impression", "11:click", "11:booking_started", "22:click"]);
  });

  it("le lendemain, l'événement peut être compté de nouveau (règle « une fois par jour »)", async () => {
    await trackPromotion("impression", ID, "2026-10-25");
    await trackPromotion("impression", ID, "2026-10-26");
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });

  it("la déduplication survit à un rechargement de la page (sessionStorage) mais pas à une nouvelle session", async () => {
    await trackPromotion("click", ID, DAY);
    expect(window.sessionStorage.getItem("dalanda.promo.sent")).toContain(`${DAY}:${ID}:click`);
    // « rechargement » : la mémoire du module est perdue, le stockage de la visite reste
    (await import("@/lib/promotion-tracking")).resetPromotionTracking();
    window.sessionStorage.setItem("dalanda.promo.sent", JSON.stringify([`${DAY}:${ID}:click`]));
    await trackPromotion("click", ID, DAY);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("identifiant invalide : aucun envoi", async () => {
    expect(await trackPromotion("click", "pas-un-uuid", DAY)).toBe(false);
    expect(await trackPromotion("click", "", DAY)).toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("sans Supabase (mode local) : aucun envoi, aucune erreur", async () => {
    h.remote.value = false;
    expect(await trackPromotion("click", ID, DAY)).toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("navigateur où l'administrateur est connecté : jamais compté comme un visiteur", async () => {
    window.localStorage.setItem("dalanda.admin.auth", "{\"access_token\":\"x\"}");
    expect(await trackPromotion("impression", ID, DAY)).toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("erreur réseau, exception ou limitation de débit : on pourra réessayer ; refus définitif : on ne réessaie pas", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "réseau" } });
    await trackPromotion("click", ID, DAY);
    await trackPromotion("click", ID, DAY);
    expect(h.rpc).toHaveBeenCalledTimes(2);
    h.rpc.mockReset().mockRejectedValueOnce(new Error("boom"));
    await expect(trackPromotion("click", OTHER, DAY)).resolves.toBeTypeOf("boolean");
    await trackPromotion("click", OTHER, DAY);
    expect(h.rpc).toHaveBeenCalledTimes(2);
    h.rpc.mockReset().mockResolvedValue({ data: { ok: false, code: "rate_limited" }, error: null });
    await trackPromotion("booking_started", ID, DAY);
    await trackPromotion("booking_started", ID, DAY);
    expect(h.rpc).toHaveBeenCalledTimes(2);
    h.rpc.mockReset().mockResolvedValue({ data: { ok: false, code: "not_eligible" }, error: null });
    await trackPromotion("impression", OTHER, DAY);
    await trackPromotion("impression", OTHER, DAY);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("le suivi ne lève jamais d'erreur vers l'interface", async () => {
    h.rpc.mockImplementation(() => { throw new Error("sync"); });
    await expect(trackPromotion("click", ID, DAY)).resolves.toBeTypeOf("boolean");
  });
});

function Probe({ id = ID }: { id?: string }) {
  const ref = usePromotionImpression(id);
  const [n, setN] = useState(0);
  return <div ref={ref} data-testid="probe"><button onClick={() => setN(n + 1)}>rendu {n}</button></div>;
}

describe("impression : au moins 50 % visible pendant 1 seconde", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

  it("visible à 50 % pendant 1 s : UNE impression", () => {
    render(<Probe />);
    see(0.6);
    advance(IMPRESSION_MS - 1);
    expect(h.rpc).not.toHaveBeenCalled();
    advance(1);
    expect(calls()).toEqual([{ p_promotion_id: ID, p_event: "impression", p_session: sessionKey() }]);
  });

  it("jamais visible, ou moins de 50 % : aucune impression", () => {
    render(<Probe />);
    see(0);
    advance(5000);
    see(0.49);
    advance(5000);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("visible moins d'une seconde puis masquée : aucune impression ; le chronomètre repart à zéro au retour", () => {
    render(<Probe />);
    see(0.8);
    advance(900);
    see(0);
    advance(5000);
    expect(h.rpc).not.toHaveBeenCalled();
    see(0.8);
    advance(900);
    expect(h.rpc).not.toHaveBeenCalled();
    advance(100);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("de nombreux rendus React ne produisent qu'une seule impression", () => {
    render(<Probe />);
    see(1);
    for (let i = 0; i < 10; i++) fireEvent.click(screen.getByRole("button"));
    advance(IMPRESSION_MS);
    see(1);
    advance(IMPRESSION_MS * 3);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("démontage avant la fin de la seconde : aucune impression", () => {
    const { unmount } = render(<Probe />);
    see(1);
    advance(500);
    unmount();
    advance(5000);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("deux affichages de la même promotion dans la même session et le même jour : une seule impression", () => {
    const first = render(<Probe />);
    see(1);
    advance(IMPRESSION_MS);
    first.unmount();
    observers.length = 0;
    render(<Probe />);
    see(1);
    advance(IMPRESSION_MS);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("deux promotions différentes : une impression chacune", () => {
    render(<><Probe id={ID} /><Probe id={OTHER} /></>);
    see(1);
    advance(IMPRESSION_MS);
    expect(calls().map((c) => c.p_promotion_id).sort()).toEqual([ID, OTHER]);
  });

  it("navigateur sans IntersectionObserver : aucune impression présumée", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Probe />);
    advance(10_000);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("carte de promotion : clics et impressions", () => {
  const withService = () => promo({ serviceId: "massage-relaxant", kind: "price", originalPrice: 20000, promoPrice: 15000 });

  it("clic sur « Réserver » : un clic compté, l'identifiant suit dans le lien", async () => {
    render(<PromotionCard promotion={withService()} />);
    const link = screen.getByRole("link", { name: "Réserver" });
    expect(link).toHaveAttribute("href", `/reservation?service=massage-relaxant&promo=${ID}`);
    await act(async () => { fireEvent.click(link); });
    expect(calls().map((c) => c.p_event)).toEqual(["click"]);
  });

  it("clics répétés (bouton, image, titre, bouton) : un seul clic compté par jour et par session", async () => {
    render(<PromotionCard promotion={withService()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Réserver" }));
      fireEvent.click(screen.getByRole("link", { name: "Voir la prestation" }));
      fireEvent.click(screen.getByRole("link", { name: /Massage duo/ }));
    });
    expect(calls().filter((c) => c.p_event === "click")).toHaveLength(1);
  });

  it("la bannière (image + titre) est cliquable quand il y a une cible, avec ?promo=", () => {
    render(<PromotionCard promotion={withService()} />);
    expect(screen.getByRole("link", { name: /Massage duo/ })).toHaveAttribute("href", `/prestations/massage-relaxant?promo=${ID}`);
  });

  it("produit : bannière et bouton mènent à la fiche avec ?promo=", () => {
    render(<PromotionCard promotion={promo({ productId: "creme" })} />);
    for (const l of screen.getAllByRole("link")) expect(l.getAttribute("href")).toBe(`/boutique/creme?promo=${ID}`);
  });

  it("simple annonce sans lien : ni lien ni clic à suivre", () => {
    render(<PromotionCard promotion={promo()} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("impression de la carte : après 1 s à 50 % de visibilité, une seule fois", () => {
    vi.useFakeTimers();
    render(<PromotionCard promotion={withService()} />);
    see(0.7);
    act(() => { vi.advanceTimersByTime(IMPRESSION_MS); });
    expect(calls().map((c) => c.p_event)).toEqual(["impression"]);
  });

  it("aperçu de l'administration (actions désactivées) : ni observateur, ni impression, ni clic", () => {
    vi.useFakeTimers();
    render(<PromotionCard promotion={withService()} actions={false} />);
    expect(observers).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

// --- Visibilité de l'onglet, bannière trop haute, jour UTC, session sans stockage ---------------------------------

const setTab = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
};
const seeEntry = (e: { isIntersecting: boolean; intersectionRatio: number; intersectionRect?: { height: number }; rootBounds?: { height: number } | null }) =>
  act(() => { for (const o of observers.filter((x) => !x.disconnected)) o.cb([e] as never); });

describe("impression : onglet masqué et bannière très haute", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { setTab("visible"); });
  const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

  it("onglet masqué dès le départ : aucune impression ; elle est comptée 1 s après le retour au premier plan", () => {
    setTab("hidden");
    render(<Probe />);
    see(1);
    advance(5000);
    expect(h.rpc).not.toHaveBeenCalled();
    setTab("visible");
    advance(IMPRESSION_MS - 1);
    expect(h.rpc).not.toHaveBeenCalled();
    advance(1);
    expect(calls().map((c) => c.p_event)).toEqual(["impression"]);
  });

  it("onglet masqué pendant la seconde d'observation : le chronomètre est annulé, aucune impression", () => {
    render(<Probe />);
    see(1);
    advance(500);
    setTab("hidden");
    advance(5000);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("onglet masqué puis revenu : le chronomètre repart à zéro (une seconde complète est exigée)", () => {
    render(<Probe />);
    see(1);
    advance(600);
    setTab("hidden");
    setTab("visible");
    advance(900);
    expect(h.rpc).not.toHaveBeenCalled();
    advance(100);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("bannière plus haute que l'écran : comptée quand elle occupe au moins la moitié de la hauteur de l'écran, même sous 50 % d'elle-même", () => {
    render(<Probe />);
    seeEntry({ isIntersecting: true, intersectionRatio: 0.1, intersectionRect: { height: 500 }, rootBounds: { height: 800 } });
    advance(IMPRESSION_MS);
    expect(calls().map((c) => c.p_event)).toEqual(["impression"]);
  });

  it("bannière très haute mais qui n'occupe que 300 px sur un écran de 800 px : pas d'impression", () => {
    render(<Probe />);
    seeEntry({ isIntersecting: true, intersectionRatio: 0.1, intersectionRect: { height: 300 }, rootBounds: { height: 800 } });
    advance(5000);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("élément qui n'intersecte pas (même avec un grand rapport résiduel) : jamais compté", () => {
    render(<Probe />);
    seeEntry({ isIntersecting: false, intersectionRatio: 0.9, intersectionRect: { height: 900 }, rootBounds: { height: 800 } });
    advance(5000);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("isVisibleEnough : règle de visibilité", () => {
    expect(isVisibleEnough({ isIntersecting: true, intersectionRatio: 0.5 })).toBe(true);
    expect(isVisibleEnough({ isIntersecting: true, intersectionRatio: 0.49, intersectionRect: { height: 10 }, rootBounds: { height: 800 } })).toBe(false);
    expect(isVisibleEnough({ isIntersecting: true, intersectionRatio: 0.2, intersectionRect: { height: 400 }, rootBounds: { height: 800 } })).toBe(true);
    expect(isVisibleEnough({ isIntersecting: false, intersectionRatio: 1 })).toBe(false);
  });
});

describe("jour de comptage UTC, cohérent avec la base", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("utcDay : le jour UTC, quel que soit le fuseau de l'appareil", () => {
    expect(utcDay(new Date("2026-10-25T23:59:59Z"))).toBe("2026-10-25");
    expect(utcDay(new Date("2026-10-26T00:00:00Z"))).toBe("2026-10-26");
    expect(utcDay(new Date("2026-10-25T23:30:00-05:00"))).toBe("2026-10-26");   // 04:30 UTC le lendemain
    expect(utcDay(new Date("2026-10-26T01:00:00+03:00"))).toBe("2026-10-25");   // 22:00 UTC la veille
  });

  it("la déduplication par défaut suit le jour UTC : un événement par jour UTC, quelle que soit l'heure locale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T23:59:30Z"));
    await trackPromotion("click", ID);
    await trackPromotion("click", ID);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem("dalanda.promo.sent")).toContain(`2026-10-25:${ID}:click`);
    vi.setSystemTime(new Date("2026-10-26T00:00:30Z"));
    await trackPromotion("click", ID);
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(window.sessionStorage.getItem("dalanda.promo.sent")).toContain(`2026-10-26:${ID}:click`);
  });

  it("les marques des jours précédents sont oubliées", async () => {
    await trackPromotion("click", ID, "2026-10-25");
    await trackPromotion("click", OTHER, "2026-10-26");
    const kept = JSON.parse(window.sessionStorage.getItem("dalanda.promo.sent") ?? "[]") as string[];
    expect(kept.every((m) => m.startsWith("2026-10-26:"))).toBe(true);
  });
});

describe("session sans stockage de session", () => {
  it("l'identifiant reste STABLE pendant la page (sinon l'attribution ne retrouverait jamais le clic)", () => {
    const spy = vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new Error("stockage bloqué"); });
    try {
      const a = sessionKey();
      expect(a).toMatch(/^[0-9a-f]{32}$/);
      expect(sessionKey()).toBe(a);
      expect(sessionKey()).toBe(a);
    } finally { spy.mockRestore(); }
  });
});
