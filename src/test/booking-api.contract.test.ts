// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApi, type DataClient } from "@/lib/api";
import { getBookings } from "@/lib/bookings";
import type { Service } from "@/data/services";

// Test de contrat : l'accès aux données du frontend (src/lib/api.ts) est exécuté contre les VRAIES fonctions SQL de
// supabase/migrations, dans un PostgreSQL local en mémoire (PGlite), avec le rôle anon.
// Simulé : le transport HTTP (PostgREST), les en-têtes et le schéma auth. Non couvert : la concurrence réelle.

const SUPABASE_DIR = resolve(__dirname, "../../supabase");
let db: PGlite;
let ipN = 0;
const D = (k: number) => new Date(Date.now() + k * 864e5).toISOString().slice(0, 10);
type Res = { data: unknown; error: { message: string } | null };

/** Faux client Supabase : rpc() et from().select().order() exécutent du SQL en tant que anon. */
function fakeClient(): DataClient {
  const headers = () => db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ "cf-connecting-ip": `ip-${++ipN}` })]);
  const fail = (e: unknown): Res => ({ data: null, error: { message: String((e as Error).message) } });
  return {
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      try {
        await headers();
        const names = Object.keys(args);
        const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`;
        const r = await db.query(fn === "get_availability" ? `select * from ${call}` : `select ${call} as r`, names.map((n) => args[n]));
        return { data: fn === "get_availability" ? r.rows : (r.rows[0] as { r: unknown }).r, error: null };
      } catch (e) { return fail(e); }
    },
    from(table: string) {
      return {
        select(cols: string) {
          const exec = (order?: string): Promise<Res> =>
            db.query(`select ${cols} from public.${table}${order ? ` order by ${order}` : ""}`).then((r) => ({ data: r.rows, error: null }), fail);
          return Object.assign({ then: (a: never, b: never) => exec().then(a, b) }, {
            order: (col: string) => ({ then: (a: never, b: never) => exec(col).then(a, b) }),
          }) as never;
        },
      };
    },
  } as unknown as DataClient;
}

const asRole = async (role: "anon" | null) => { await db.exec("reset role"); if (role) await db.exec(`set role ${role}`); };
const asOwner = async (sql: string) => { await asRole(null); await db.exec(sql); await asRole("anon"); };

const svc = (id: string, over: Partial<Service> = {}): Service =>
  ({ id, name: "x", category: "visage", description: "", duration: "?", price: 1, image: "", ...over });
const input = (service: Service, date: string, slot: string, over: Record<string, string> = {}) =>
  ({ service, date, slot, name: "Aminata Koné", phone: "+225 07 07 07 07 07", comment: "", ...over });

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  `);
  const migrations = readdirSync(`${SUPABASE_DIR}/migrations`).filter((f) => f.endsWith(".sql")).sort();
  await db.exec(migrations.map((f) => readFileSync(`${SUPABASE_DIR}/migrations/${f}`, "utf8")).join("\n"));
  await db.exec(readFileSync(`${SUPABASE_DIR}/seed.sql`, "utf8"));
  await asRole("anon");
  // Stockage navigateur simulé, installé APRÈS le démarrage de PGlite (qui se comporte autrement s'il voit un window).
  const store = new Map<string, string>();
  Object.assign(globalThis, {
    window: globalThis,
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() },
  });
}, 60_000);

afterAll(async () => { await db.close(); });
beforeEach(() => { localStorage.clear(); });

describe("catalogue lu depuis Supabase", () => {
  it("renvoie les prestations, créneaux et règles du serveur", async () => {
    const c = await createApi(fakeClient()).fetchCatalogue();
    expect(c.source).toBe("supabase");
    expect(c.services).toHaveLength(10);
    expect(c.timeSlots).toEqual(["09:00", "10:30", "12:00", "14:00", "15:30", "17:00"]);
    expect(c.rules).toEqual({ minNoticeHours: 2, cancelNoticeHours: 2, maxDaysAhead: 180, maxActivePerPhone: 3 });
    const nattes = c.services.find((s) => s.id === "nattes")!;
    expect(nattes).toMatchObject({ duration: "2 h et +", price: 15000 });
    expect(nattes.image).toBeTruthy();   // photo locale rattachée par identifiant
  });

  it("lève une erreur si le serveur est injoignable (pour que l'interface réessaie)", async () => {
    const down = { rpc: async () => { throw new Error("réseau"); }, from: () => { throw new Error("réseau"); } } as unknown as DataClient;
    await expect(createApi(down).fetchCatalogue()).rejects.toThrow();
  });
});

describe("réservation, consultation et annulation via le serveur", () => {
  const api = createApi(fakeClient());

  it("réserve, enregistre la référence du serveur et aligne l'instantané sur ses valeurs (pas celles du navigateur)", async () => {
    // Le navigateur « ment » sur le prix et la durée : le serveur doit imposer les siens.
    const r = await api.createBooking(input(svc("nattes", { price: 1, duration: "5 min", name: "Gratuit" }), D(5), "09:00"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.ref).toMatch(/^DLD-[0-9A-F]{10}$/);
    expect(r.booking).toMatchObject({ price: 15000, duration: "2 h et +", serviceName: "Nattes et tresses", ends: "12:00", status: "confirmed" });
    expect(getBookings().map((b) => b.ref)).toContain(r.booking.ref);   // carnet local
  });

  it("tient compte de la durée : 09:00 et 10:30 sont pris par les nattes, 12:00 est libre", async () => {
    const av = Object.fromEntries((await api.getAvailability(D(5), svc("massage-dos"))).map((x) => [x.slot, x.available]));
    expect(av).toMatchObject({ "09:00": false, "10:30": false, "12:00": true, "14:00": true });
  });

  it("refuse un créneau pris avec un code stable et un message en français", async () => {
    const r = await api.createBooking(input(svc("massage-dos"), D(5), "10:30", { phone: "0102030405", name: "Autre Cliente" }));
    expect(r).toMatchObject({ ok: false, code: "slot_unavailable" });
    expect(r.ok ? "" : r.error).toMatch(/créneau/i);
  });

  it("renvoie invalid_input pour un téléphone refusé par le serveur", async () => {
    const r = await api.createBooking(input(svc("pedicure"), D(6), "09:00", { phone: "abc" }));
    expect(r).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("consulte et resynchronise une réservation (référence + téléphone)", async () => {
    const [b] = getBookings();
    expect(b).toBeUndefined();   // beforeEach a vidé le carnet : on recrée
    const created = await api.createBooking(input(svc("pedicure"), D(7), "09:00", { phone: "0505050505" }));
    if (!created.ok) throw new Error(created.error);
    const r = await api.refreshBooking({ ...created.booking, status: "cancelled" });   // le local est faux, le serveur corrige
    expect(r.ok && r.booking.status).toBe("confirmed");
    expect(getBookings().find((x) => x.ref === created.booking.ref)?.status).toBe("confirmed");
  });

  it("annule : mauvais téléphone refusé, bon téléphone accepté, double annulation signalée", async () => {
    const created = await api.createBooking(input(svc("manucure"), D(8), "09:00", { phone: "0606060606" }));
    if (!created.ok) throw new Error(created.error);
    const b = created.booking;
    expect(await api.cancelBooking({ ...b, phone: "0000000000" })).toMatchObject({ ok: false, code: "not_found" });
    expect(await api.cancelBooking(b)).toEqual({ ok: true });
    expect(getBookings().find((x) => x.ref === b.ref)?.status).toBe("cancelled");
    expect(await api.cancelBooking(b)).toMatchObject({ ok: false, code: "not_active" });
    const free = (await api.getAvailability(D(8), svc("manucure"))).find((x) => x.slot === "09:00");
    expect(free?.available).toBe(true);   // créneau libéré
  });

  it("refuse l'annulation trop tardive (préavis du serveur)", async () => {
    const created = await api.createBooking(input(svc("shampoing-soin"), D(4), "09:00", { phone: "0707070701" }));
    if (!created.ok) throw new Error(created.error);
    await asOwner("update public.salon_settings set cancel_notice_hours = 168");
    const r = await api.cancelBooking(created.booking);
    await asOwner("update public.salon_settings set cancel_notice_hours = 2");
    expect(r).toMatchObject({ ok: false, code: "too_late" });
    expect(r.ok ? "" : r.error).toMatch(/contactez le salon/i);
    expect(getBookings().find((x) => x.ref === created.booking.ref)?.status).toBe("confirmed");   // rien n'est modifié localement
  });

  it("applique le préavis de 2 h et la limite de 180 jours côté serveur", async () => {
    expect(await api.createBooking(input(svc("pedicure"), D(-1), "09:00", { phone: "0808080801" }))).toMatchObject({ ok: false, code: "too_early" });
    expect(await api.createBooking(input(svc("pedicure"), D(181), "09:00", { phone: "0808080802" }))).toMatchObject({ ok: false, code: "too_far" });
    const av = await api.getAvailability(D(181), svc("pedicure"));
    expect(av.every((x) => !x.available)).toBe(true);
  });
});

describe("défaillances réseau et serveur", () => {
  it("renvoie un échec explicite (jamais une exception) quand le réseau tombe", async () => {
    const api = createApi({ rpc: async () => { throw new TypeError("Failed to fetch"); }, from: () => ({}) } as unknown as DataClient);
    expect(await api.createBooking(input(svc("pedicure"), D(5), "09:00"))).toMatchObject({ ok: false, code: "network" });
    expect(await api.cancelBooking({ ref: "DLD-0", phone: "0707070707" } as never)).toMatchObject({ ok: false, code: "network" });
    expect(getBookings()).toHaveLength(0);
  });

  it("renvoie server_error quand le serveur répond par une erreur", async () => {
    const api = createApi({ rpc: async () => ({ data: null, error: { message: "boom" } }), from: () => ({}) } as unknown as DataClient);
    expect(await api.createBooking(input(svc("pedicure"), D(5), "09:00"))).toMatchObject({ ok: false, code: "server_error" });
  });
});

describe("mode local (sans Supabase)", () => {
  it("fonctionne avec les données du code et refuse un créneau déjà pris", async () => {
    const api = createApi(null);
    expect(api.remote).toBe(false);
    expect((await api.fetchCatalogue()).source).toBe("local");
    const s = svc("pedicure", { name: "Pédicure soin", duration: "45 min", price: 8000 });
    const first = await api.createBooking(input(s, D(5), "09:00"));
    expect(first.ok).toBe(true);
    expect(await api.createBooking(input(s, D(5), "09:00", { phone: "0102030405" }))).toMatchObject({ ok: false, code: "slot_unavailable" });
    expect((await api.getAvailability(D(5), s)).find((x) => x.slot === "09:00")?.available).toBe(false);
  });
});
