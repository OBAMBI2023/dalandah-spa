import { afterEach, describe, expect, it, vi } from "vitest";
import { ATTRIBUTION_TIMEOUT_MS, createApi, type DataClient } from "@/lib/api";
import { resetPromotionTracking, sessionKey } from "@/lib/promotion-tracking";
import { services } from "@/data/services";

// Forme des appels : create_booking garde ses six paramètres (aucun paramètre de promotion), l'attribution est un appel SÉPARÉ, lancé en
// arrière-plan : elle ne retarde jamais la confirmation, ne rappelle jamais create_booking et ne lève jamais d'erreur.
const PROMO = "11111111-1111-4111-8111-111111111111";
const svc = services[0]!;
const input = { service: svc, date: "2030-01-15", slot: "09:00", name: "Aminata Koné", phone: " +225 07 07 07 07 07 ", comment: "" };

type Reply = { data: unknown; error: { message: string } | null };
function client(attribute: (n: number) => Reply | Promise<Reply>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let attempts = 0;
  const c = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args });
      if (fn === "create_booking") return { data: { ok: true, ref: "DLD-ABCDEF1234", ends: "10:00:00" }, error: null };
      if (fn === "get_booking") return { data: { ok: true, ref: "DLD-ABCDEF1234", service_name: svc.name, duration_label: "60 min", price_fcfa: svc.price, date: "2030-01-15", slot: "09:00", status: "confirmed", name: "Aminata Koné", comment: "", ends: "10:00" }, error: null };
      if (fn === "attribute_booking_to_promotion") return attribute(++attempts);
      return { data: null, error: null };
    }),
    from: () => { throw new Error("pas de lecture de table ici"); },
  };
  return { api: createApi(c as unknown as DataClient), calls };
}
const names = (calls: { fn: string }[]) => calls.map((c) => c.fn);
const count = (calls: { fn: string }[], fn: string) => calls.filter((c) => c.fn === fn).length;
const never = () => new Promise<Reply>(() => {});
const done = (): Reply => ({ data: { ok: true, attributed: true }, error: null });

afterEach(() => { vi.useRealTimers(); resetPromotionTracking(); });

describe("attribution des réservations aux promotions", () => {
  it("create_booking garde exactement ses six paramètres : aucune promotion n'y est transmise", async () => {
    const { api, calls } = client(done);
    await api.createBooking({ ...input, promotionId: PROMO });
    const create = calls.find((c) => c.fn === "create_booking")!;
    expect(Object.keys(create.args).sort()).toEqual(["p_comment", "p_date", "p_name", "p_phone", "p_service_id", "p_slot"]);
    expect(JSON.stringify(create.args)).not.toContain(PROMO);
  });

  it("l'attribution est un appel séparé, APRÈS la création, avec référence, téléphone, promotion et SESSION", async () => {
    const { api, calls } = client(done);
    const r = await api.createBooking({ ...input, promotionId: PROMO });
    expect(r.ok).toBe(true);
    const order = names(calls);
    expect(order.indexOf("attribute_booking_to_promotion")).toBeGreaterThan(order.indexOf("create_booking"));
    expect(calls.find((c) => c.fn === "attribute_booking_to_promotion")!.args).toEqual({
      p_ref: "DLD-ABCDEF1234", p_phone: "+225 07 07 07 07 07", p_promotion_id: PROMO, p_session: sessionKey(),
    });
  });

  it("la session transmise est celle des événements de suivi (32 caractères hexadécimaux), stable pendant la visite", async () => {
    const { api, calls } = client(done);
    await api.createBooking({ ...input, promotionId: PROMO });
    const session = calls.find((c) => c.fn === "attribute_booking_to_promotion")!.args["p_session"];
    expect(session).toMatch(/^[0-9a-f]{32}$/);
    expect(session).toBe(sessionKey());
    expect(sessionKey()).toBe(session);
  });

  it("sans promotion : aucun appel d'attribution (comportement existant)", async () => {
    const { api, calls } = client(done);
    const r = await api.createBooking(input);
    expect(r.ok).toBe(true);
    expect(names(calls)).not.toContain("attribute_booking_to_promotion");
  });

  it("CONFIRMATION IMMÉDIATE : la réservation est confirmée même si l'attribution ne se termine jamais", async () => {
    const { api, calls } = client(never);
    const r = await Promise.race([api.createBooking({ ...input, promotionId: PROMO }), new Promise<"bloqué">((res) => setTimeout(() => res("bloqué"), 1000))]);
    expect(r).not.toBe("bloqué");
    expect((r as { ok: boolean }).ok).toBe(true);
    expect(count(calls, "attribute_booking_to_promotion")).toBe(1);   // lancée, jamais attendue
    expect(count(calls, "create_booking")).toBe(1);
  });

  it("une attribution qui ne se termine jamais est abandonnée après le délai, avec une seule nouvelle tentative et SANS rappeler create_booking", async () => {
    vi.useFakeTimers();
    const { api, calls } = client(never);
    const r = await api.createBooking({ ...input, promotionId: PROMO });
    expect(r.ok).toBe(true);
    expect(count(calls, "attribute_booking_to_promotion")).toBe(1);
    await vi.advanceTimersByTimeAsync(ATTRIBUTION_TIMEOUT_MS + 10);
    expect(count(calls, "attribute_booking_to_promotion")).toBe(2);    // une seule tentative supplémentaire
    await vi.advanceTimersByTimeAsync(ATTRIBUTION_TIMEOUT_MS * 5);
    expect(count(calls, "attribute_booking_to_promotion")).toBe(2);    // jamais plus
    expect(count(calls, "create_booking")).toBe(1);                      // la réservation n'est jamais recréée
  });

  it("échec de l'attribution (réseau, refus) : la réservation réussit quand même, un seul nouvel essai, create_booking appelée une fois", async () => {
    const { api, calls } = client(() => ({ data: null, error: { message: "boom" } }));
    const r = await api.createBooking({ ...input, promotionId: PROMO });
    expect(r.ok).toBe(true);
    await vi.waitFor(() => expect(count(calls, "attribute_booking_to_promotion")).toBe(2));
    expect(count(calls, "create_booking")).toBe(1);
  });

  it("exception pendant l'attribution : ignorée (aucune erreur non gérée), la réservation réussit", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const { api } = client(() => Promise.reject(new Error("réseau")) as Promise<Reply>);
    expect((await api.createBooking({ ...input, promotionId: PROMO })).ok).toBe(true);
    await new Promise((res) => setTimeout(res, 20));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("premier essai en échec puis succès : attribuée", async () => {
    const { api, calls } = client((n) => (n === 1 ? { data: null, error: { message: "x" } } : done()));
    expect(await api.attributeToPromotion("DLD-ABCDEF1234", "+225 07 07 07 07 07", PROMO, "a".repeat(32))).toBe(true);
    expect(count(calls, "attribute_booking_to_promotion")).toBe(2);
  });

  it("refus métier (non admissible, trop tard, aucun clic) : résultat faux, sans nouvel essai", async () => {
    const { api, calls } = client(() => ({ data: { ok: false, code: "not_eligible", error: "x" }, error: null }));
    expect(await api.attributeToPromotion("DLD-ABCDEF1234", "+225 07 07 07 07 07", PROMO, "a".repeat(32))).toBe(false);
    expect(count(calls, "attribute_booking_to_promotion")).toBe(1);
  });

  it("mode local (sans Supabase) : aucune attribution, aucune erreur", async () => {
    expect(await createApi(null).attributeToPromotion("DLD-ABCDEF1234", "0700000000", PROMO)).toBe(false);
    const r = await createApi(null).createBooking({ ...input, promotionId: PROMO, date: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10), slot: "09:00" });
    expect(r.ok).toBe(true);
  });
});
