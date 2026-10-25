import { describe, expect, it, vi } from "vitest";

// Paramètre ?promo= : accepté (UUID uniquement) sur les pages de la navigation promotion -> prestation / produit -> réservation, sans jamais
// toucher aux autres paramètres existants (?service=).
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  Link: () => null,
  useRouter: () => ({}),
}));
vi.mock("@/components/mobile-booking", () => ({ MobileBooking: () => null }));
vi.mock("@/components/app", () => ({ AppBar: () => null, Screen: () => null, Img: () => null }));

import { Route as ReservationRoute } from "@/routes/reservation";
import { Route as ServiceRoute } from "@/routes/prestations.$serviceId";
import { Route as ProductRoute } from "@/routes/boutique.$productId";

const PROMO = "11111111-1111-4111-8111-111111111111";
const validate = (route: unknown, s: Record<string, unknown>) => (route as { validateSearch: (s: Record<string, unknown>) => Record<string, unknown> }).validateSearch(s);

describe("/reservation", () => {
  it("?service= seul : comportement existant inchangé", () => {
    expect(validate(ReservationRoute, { service: "nattes" })).toEqual({ service: "nattes" });
    expect(validate(ReservationRoute, {})).toEqual({});
    expect(validate(ReservationRoute, { service: 3 })).toEqual({});
  });
  it("?service= et ?promo= : les deux sont conservés", () => {
    expect(validate(ReservationRoute, { service: "nattes", promo: PROMO })).toEqual({ service: "nattes", promo: PROMO });
    expect(validate(ReservationRoute, { promo: PROMO })).toEqual({ promo: PROMO });
  });
  it("?promo= invalide ou malveillant : ignoré", () => {
    for (const bad of ["abc", "' or 1=1 --", "<script>", "", 7, null, [PROMO]]) expect(validate(ReservationRoute, { service: "nattes", promo: bad })).toEqual({ service: "nattes" });
  });
});

describe("fiche prestation et fiche produit", () => {
  it("acceptent ?promo= (UUID) pour que la navigation depuis une promotion fonctionne, et ignorent le reste", () => {
    for (const route of [ServiceRoute, ProductRoute]) {
      expect(validate(route, { promo: PROMO })).toEqual({ promo: PROMO });
      expect(validate(route, { promo: "nimporte quoi" })).toEqual({});
      expect(validate(route, {})).toEqual({});
    }
  });
});
