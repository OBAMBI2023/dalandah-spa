import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Le formulaire mobile est testé avec un faux accès aux données : la couche SQL est couverte par booking-api.contract.test.ts.
const svc = { id: "massage-dos", name: "Massage dos et nuque", category: "massage", description: "", duration: "30 min", price: 10000, image: "" };
const mocks = vi.hoisted(() => ({
  createBooking: vi.fn(),
  getAvailability: vi.fn(),
  track: vi.fn(),
  remote: true,
}));

vi.mock("@/lib/api", () => ({
  api: {
    get remote() { return mocks.remote; },
    createBooking: mocks.createBooking,
    getAvailability: mocks.getAvailability,
  },
}));
vi.mock("@/lib/promotion-tracking", () => ({ trackPromotion: mocks.track }));
vi.mock("@/lib/catalogue", () => ({
  useCatalogue: () => ({
    services: [svc], timeSlots: ["09:00"], source: "supabase", loaded: true, isError: false, refetch: () => {},
    rules: { minNoticeHours: 2, cancelNoticeHours: 2, maxDaysAhead: 180, maxActivePerPhone: 3 },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/components/app", () => ({
  AppBar: ({ title }: { title: string }) => <h1>{title}</h1>,
  Screen: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Stepper: () => null,
  Img: () => null,
}));

import { MobileBooking } from "@/components/mobile-booking";

const booking = {
  ref: "DLD-ABCDEF1234", serviceId: svc.id, serviceName: svc.name, duration: svc.duration, price: svc.price,
  date: "2030-01-15", slot: "09:00", name: "Awa Koné", phone: "07 00 00 00 00", comment: "", status: "confirmed" as const,
  createdAt: "2030-01-01T00:00:00.000Z", ends: "09:30",
};

function setup(promotionId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MobileBooking promotionId={promotionId} /></QueryClientProvider>);
}

/** Parcourt les étapes 1 à 3 puis arrive sur le récapitulatif (étape 4). */
async function toSummary(opts: { name?: string; phone?: string } = {}) {
  fireEvent.click(screen.getByRole("radio", { name: /Massage dos et nuque/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
  const days = await screen.findAllByRole("gridcell");
  const enabled = days.map((c) => c.querySelector("button")).filter((b): b is HTMLButtonElement => !!b && !b.disabled);
  fireEvent.click(enabled[enabled.length - 1]!);
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
  fireEvent.click(await screen.findByRole("button", { name: "09:00" }));
  fireEvent.change(screen.getByLabelText(/Votre nom/), { target: { value: opts.name ?? "Awa Koné" } });
  fireEvent.change(screen.getByLabelText(/Téléphone/), { target: { value: opts.phone ?? "07 00 00 00 00" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuer" }));
}

const send = () => screen.getByRole("button", { name: "Confirmer la réservation" });
const CONFIRMED = "Votre réservation est confirmée !";

describe("formulaire de réservation : enregistrement serveur, sans WhatsApp", () => {
  let open: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mocks.remote = true;
    mocks.createBooking.mockReset();
    mocks.getAvailability.mockReset();
    mocks.getAvailability.mockResolvedValue([{ slot: "09:00", available: true }]);
    open = vi.fn(() => ({}));
    vi.stubGlobal("open", open);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("enregistre la réservation, affiche la vraie référence et n'ouvre pas WhatsApp", async () => {
    mocks.createBooking.mockResolvedValue({ ok: true, booking });
    setup();
    await toSummary();
    fireEvent.click(send());

    expect(await screen.findByText(CONFIRMED)).toBeInTheDocument();
    expect(screen.getByText("DLD-ABCDEF1234")).toBeInTheDocument();
    expect(mocks.createBooking).toHaveBeenCalledTimes(1);
    expect(mocks.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ service: svc, slot: "09:00", name: "Awa Koné", phone: "07 00 00 00 00" }),
    );
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByText(/WhatsApp/i)).not.toBeInTheDocument();
  });

  it("validation : nom trop court, aucun enregistrement", async () => {
    setup();
    await toSummary({ name: "A" });

    expect(await screen.findByText("Indiquez votre nom.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmer la réservation" })).not.toBeInTheDocument();
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  it("validation : téléphone invalide", async () => {
    setup();
    await toSummary({ phone: "123" });

    expect(await screen.findByText("Numéro de téléphone invalide.")).toBeInTheDocument();
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  it("créneau indisponible : erreur affichée, retour au choix de l'heure, pas de confirmation", async () => {
    mocks.createBooking.mockResolvedValue({
      ok: false,
      code: "slot_unavailable",
      error: "Ce créneau n'est plus disponible. Choisissez-en un autre.",
    });
    setup();
    await toSummary();
    fireEvent.click(send());

    expect(await screen.findByRole("alert")).toHaveTextContent("Ce créneau n'est plus disponible");
    expect(screen.getByText("Choisissez l'heure")).toBeInTheDocument();
    expect(screen.queryByText(CONFIRMED)).not.toBeInTheDocument();
  });

  it("échec Supabase : erreur explicite, jamais présentée comme confirmée, nouvel essai possible", async () => {
    mocks.createBooking.mockResolvedValue({
      ok: false,
      code: "network",
      error: "Connexion impossible. Vérifiez votre réseau et réessayez.",
    });
    setup();
    await toSummary();
    fireEvent.click(send());

    expect(await screen.findByRole("alert")).toHaveTextContent("Connexion impossible");
    expect(screen.queryByText(CONFIRMED)).not.toBeInTheDocument();
    expect(send()).toBeEnabled();
  });

  it("double clic : une seule réservation envoyée", async () => {
    let finish!: (v: unknown) => void;
    mocks.createBooking.mockReturnValue(
      new Promise((r) => {
        finish = r;
      }),
    );
    setup();
    await toSummary();
    const b = send();
    fireEvent.click(b);
    fireEvent.click(b);
    fireEvent.click(b);
    expect(mocks.createBooking).toHaveBeenCalledTimes(1);

    finish({ ok: true, booking });
    expect(await screen.findByText(CONFIRMED)).toBeInTheDocument();
    expect(mocks.createBooking).toHaveBeenCalledTimes(1);
  });

  it("mode local : un avertissement indique que la réservation reste sur l'appareil", async () => {
    mocks.remote = false;
    mocks.createBooking.mockResolvedValue({ ok: true, booking: { ...booking, ref: "DLD-LOCAL1" } });
    setup();
    await toSummary();
    fireEvent.click(send());

    expect(await screen.findByText(/Mode local/)).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });
});

describe("réservation depuis une promotion : suivi sans effet sur la réservation", () => {
  const PROMO = "11111111-1111-4111-8111-111111111111";
  beforeEach(() => {
    mocks.remote = true;
    mocks.createBooking.mockReset().mockResolvedValue({ ok: true, booking });
    mocks.getAvailability.mockReset().mockResolvedValue([{ slot: "09:00", available: true }]);
    mocks.track.mockReset().mockResolvedValue(true);
    vi.stubGlobal("open", vi.fn(() => ({})));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("arrivée avec ?promo= : « réservation démarrée » est suivie une seule fois, même après avoir parcouru toutes les étapes", async () => {
    setup(PROMO);
    expect(mocks.track).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith("booking_started", PROMO);
    await toSummary();
    expect(mocks.track).toHaveBeenCalledTimes(1);
  });

  it("l'identifiant de la promotion est conservé jusqu'à la création et transmis à la création de la réservation", async () => {
    setup(PROMO);
    await toSummary();
    fireEvent.click(send());
    expect(await screen.findByText(CONFIRMED)).toBeInTheDocument();
    expect(mocks.createBooking).toHaveBeenCalledTimes(1);
    expect(mocks.createBooking).toHaveBeenCalledWith(expect.objectContaining({ service: svc, slot: "09:00", promotionId: PROMO }));
  });

  it("le prix affiché au récapitulatif reste celui de la prestation (aucune remise appliquée)", async () => {
    setup(PROMO);
    await toSummary();
    expect(screen.getAllByText(/10\s?000/).length).toBeGreaterThan(0);
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  it("sans promotion : aucun suivi, et la réservation est envoyée comme avant", async () => {
    setup();
    await toSummary();
    fireEvent.click(send());
    expect(await screen.findByText(CONFIRMED)).toBeInTheDocument();
    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.createBooking.mock.calls[0]![0].promotionId).toBeUndefined();
  });

  it("échec de la réservation : message d'erreur, nouvel essai possible avec la même promotion", async () => {
    mocks.createBooking.mockResolvedValueOnce({ ok: false, code: "network", error: "Connexion impossible." }).mockResolvedValue({ ok: true, booking });
    setup(PROMO);
    await toSummary();
    fireEvent.click(send());
    expect(await screen.findByText("Connexion impossible.")).toBeInTheDocument();
    fireEvent.click(send());
    expect(await screen.findByText(CONFIRMED)).toBeInTheDocument();
    expect(mocks.createBooking.mock.calls.map((c) => c[0].promotionId)).toEqual([PROMO, PROMO]);
  });
});
