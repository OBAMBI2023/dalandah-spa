import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ lines: [] as { id: string; name: string; price: number; qty: number }[] }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  Link: ({ children, to, className }: { children?: ReactNode; to: string; className?: string }) => <a href={to} className={className}>{children}</a>,
}));
vi.mock("@/components/app", () => ({ Img: ({ src }: { src?: string }) => <img src={src ?? ""} alt="" /> }));
vi.mock("@/components/layout", () => ({ PageTitle: ({ title, text }: { title: string; text?: string }) => <><h1>{title}</h1><p>{text}</p></> }));
vi.mock("@/lib/shop-products", () => ({ useShopProducts: () => ({ products: [], loaded: true, isError: false, refetch: () => {} }) }));
vi.mock("@/lib/cart", () => ({ useCart: () => ({ lines: h.lines }) }));

import { Route } from "@/routes/commande";
import { isValidCIPhone, isValidPhone } from "@/lib/format";

const Checkout = (Route as unknown as { component: () => ReactNode }).component;
const HUILE = { id: "huile", name: "Huile Caviar", price: 8000, qty: 1 };
const SAVON = { id: "savon", name: "Savon Mélisse", price: 6000, qty: 2 };

const fill = (over: Partial<Record<string, string>> = {}) => {
  const v = { "Nom complet": "Awa Koné", "Téléphone": "07 00 71 71 00", "Adresse de livraison": "Rue des Jardins", "Commune ou quartier": "Cocody", ...over };
  for (const [label, value] of Object.entries(v)) fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
};
const send = () => fireEvent.click(screen.getByRole("button", { name: /Envoyer ma commande|Envoi en cours/ }));

let open: ReturnType<typeof vi.fn>;
beforeEach(() => { h.lines = [HUILE]; open = vi.fn(() => null); vi.stubGlobal("open", open); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("isValidCIPhone", () => {
  it("accepte les numéros ivoiriens et internationaux avec +", () => {
    for (const n of ["0700717100", "07 00 71 71 00", "+225 07 00 71 71 00", "00225 0700717100", "225 0700717100", "+33 6 12 34 56 78"]) expect(isValidCIPhone(n)).toBe(true);
  });
  it("refuse les numéros incomplets ou invalides", () => {
    for (const n of ["", "0700", "07007171", "12345678901", "abcdefghij", "+225 070071"]) expect(isValidCIPhone(n)).toBe(false);
  });
  it("laisse la validation des réservations inchangée", () => { expect(isValidPhone("07007171")).toBe(true); });
});

describe("page de commande", () => {
  it("affiche un panier vide sans formulaire", () => {
    h.lines = [];
    render(<Checkout />);
    expect(screen.getByText("Votre panier est vide")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Envoyer ma commande/ })).toBeNull();
  });

  it("présente titre, informations, mode de traitement et un seul bouton", () => {
    render(<Checkout />);
    expect(screen.getByRole("heading", { level: 1, name: "Commande" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Valider ma commande" })).toBeTruthy();
    expect(screen.getByText("Votre commande sera traitée après réception et confirmation par notre boutique.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Mode de traitement" })).toBeTruthy();
    expect(screen.getByText("Confirmation de commande par WhatsApp")).toBeTruthy();
    expect(screen.getByText("Paiement à convenir avec Dalanda Beauty")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByLabelText(/Instructions de livraison \(facultatif\)/)).toBeTruthy();
  });

  it("calcule le récapitulatif pour un seul produit, livraison à confirmer", () => {
    render(<Checkout />);
    expect(screen.getByText("Huile Caviar × 1")).toBeTruthy();
    expect(screen.getByText("8 000 FCFA / unité")).toBeTruthy();
    expect(screen.getByText("Livraison").nextSibling?.textContent).toBe("À confirmer");
    expect(screen.getByText("8 000 FCFA + livraison")).toBeTruthy();
  });

  it("calcule quantités et sous-total pour plusieurs produits, avec une seule adresse", () => {
    h.lines = [HUILE, SAVON];
    render(<Checkout />);
    expect(screen.getByText("Sous-total").nextSibling?.textContent).toBe("20 000 FCFA");
    expect(screen.getByText("12 000 FCFA")).toBeTruthy();
    expect(screen.getAllByLabelText(/Adresse de livraison/)).toHaveLength(1);
    fill();
    send();
    const url = decodeURIComponent(String(open.mock.calls[0]?.[0]));
    expect(open).toHaveBeenCalledTimes(1);
    expect(url).toContain("Huile Caviar × 1 — 8 000 FCFA = 8 000 FCFA");
    expect(url).toContain("Savon Mélisse × 2 — 6 000 FCFA = 12 000 FCFA");
    expect(url).toContain("Livraison : à confirmer");
    expect(url).toContain("Total : 20 000 FCFA + livraison (à confirmer)");
    expect(url).toContain("Adresse : Rue des Jardins, Cocody");
  });

  it("bloque l'envoi et affiche des erreurs en français près des champs", () => {
    render(<Checkout />);
    send();
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByText("Indiquez votre nom complet.")).toBeTruthy();
    expect(screen.getByText(/Indiquez un numéro valide/)).toBeTruthy();
    expect(screen.getByText("Indiquez l'adresse de livraison.")).toBeTruthy();
    expect(screen.getByText("Indiquez la commune ou le quartier.")).toBeTruthy();
  });

  it("refuse un téléphone invalide et conserve la saisie", () => {
    render(<Checkout />);
    fill({ "Téléphone": "0700" });
    send();
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByText(/Indiquez un numéro valide/)).toBeTruthy();
    expect((screen.getByLabelText(/^Nom complet/) as HTMLInputElement).value).toBe("Awa Koné");
    expect((screen.getByLabelText(/^Téléphone/) as HTMLInputElement).value).toBe("0700");
  });

  it("n'envoie qu'une fois malgré un double clic", () => {
    render(<Checkout />);
    fill();
    const btn = screen.getByRole("button", { name: "Envoyer ma commande" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.submit(btn.closest("form")!);
    expect(open).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/n'est confirmée qu'après réception et confirmation par la boutique/)).toBeTruthy();
  });

  it("conserve les données et permet de réessayer avec le même numéro si l'ouverture échoue", () => {
    open.mockImplementationOnce(() => { throw new Error("blocked"); });
    render(<Checkout />);
    fill();
    send();
    expect(screen.getByText(/n'a pas pu être préparée/)).toBeTruthy();
    expect(screen.queryByText(/Message de commande prêt/)).toBeNull();
    expect((screen.getByLabelText(/^Nom complet/) as HTMLInputElement).value).toBe("Awa Koné");
    send();
    expect(open).toHaveBeenCalledTimes(2);
    const id = (u: unknown) => /DB-[\dA-Z-]+/.exec(decodeURIComponent(String(u)))?.[0];
    expect(id(open.mock.calls[1]?.[0])).toBeTruthy();
    expect(screen.getByText("Message de commande prêt")).toBeTruthy();
  });
});
