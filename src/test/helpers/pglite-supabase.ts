// Pont entre le code de l'application et un vrai PostgreSQL local en mémoire (PGlite) : les requêtes de supabase-js utilisées par
// l'administration (select / insert / update, eq / neq / order / limit, comptage) sont traduites en SQL et exécutées avec le rôle
// et l'utilisateur choisis, donc avec les VRAIES politiques RLS et contraintes des migrations.
// PGlite tourne dans un worker_thread (voir pglite-worker.mjs) : il démarre ainsi sous jsdom comme sous node.
// Simulé : le transport HTTP (PostgREST) et Supabase Storage (voir storage() : mêmes règles « administrateur seulement »,
// vérifiées par private.is_admin() de la base, mais aucun serveur de stockage réel).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";

const SUPABASE_DIR = resolve(__dirname, "../../../supabase");
const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (s: string) => { if (!IDENT.test(s)) throw new Error(`identifiant refusé : ${s}`); return s; };
const cols = (s: string) => (s.trim() === "*" ? "*" : s.split(",").map((c) => ident(c.trim())).join(", "));

export type Ctx = { role: "anon" | "authenticated"; sub: string };
export type Failure = { code?: string; message: string; status?: number } | null;

export const BASE_URL = "https://test.supabase.co";

const BOOT_SQL = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

type Reply = { id: number; ok: boolean; rows?: unknown[]; error?: { message: string; code?: string } };

export class Bridge {
  /** Identité utilisée par le client administrateur (modifiable par les tests : compte non administrateur, session expirée…). */
  adminCtx: Ctx = { role: "authenticated", sub: "" };
  anonCtx: Ctx = { role: "anon", sub: "" };
  objects = new Map<string, number>();
  failNextUpload: { message: string; statusCode: string } | null = null;
  /** true : le stockage accepte n'importe qui (pour atteindre l'étape « base de données refusée » avec un compte non autorisé). */
  storageOpen = false;
  log: string[] = [];
  private worker!: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: Reply) => void; reject: (e: Error) => void }>();
  private queue: Promise<unknown> = Promise.resolve();

  private call(op: string, sql = "", params: unknown[] = []): Promise<Reply> {
    return new Promise((res, rej) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve: res, reject: rej });
      this.worker.postMessage({ id, op, sql, params });
    });
  }

  async start() {
    this.worker = new Worker(resolve(__dirname, "pglite-worker.mjs"));
    this.worker.on("message", (m: Reply) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m); else p.reject(Object.assign(new Error(m.error!.message), { code: m.error!.code }));
    });
    const files = readdirSync(`${SUPABASE_DIR}/migrations`).filter((f) => f.endsWith(".sql")).sort();
    const sql = BOOT_SQL + files.map((f) => readFileSync(`${SUPABASE_DIR}/migrations/${f}`, "utf8")).join("\n") + "\n" + readFileSync(`${SUPABASE_DIR}/seed.sql`, "utf8");
    await this.call("boot", sql);
  }

  async close() { await this.call("close"); await this.worker.terminate(); }

  /** Une requête à la fois (une seule connexion) : rôle et utilisateur posés juste avant chaque requête. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async exec<T = Record<string, unknown>>(ctx: Ctx | null, sql: string, params: unknown[] = []): Promise<T[]> {
    return this.serial(async () => {
      await this.call("exec", "reset role");
      if (ctx) {
        await this.call("exec", `set role ${ctx.role}`);
        await this.call("query", "select set_config('request.jwt.claim.sub', $1, false)", [ctx.sub]);
      }
      this.log.push(sql);
      return ((await this.call("query", sql, params)).rows ?? []) as T[];
    });
  }

  /** Lecture ou écriture directe par le propriétaire de la base (vérifications des tests, jamais l'application). */
  owner<T = Record<string, unknown>>(sql: string, params: unknown[] = []) { return this.exec<T>(null, sql, params); }

  /** Plusieurs instructions SQL d'un coup, par le propriétaire (préparation des données de test). */
  script(sql: string) { return this.serial(async () => { await this.call("exec", "reset role"); await this.call("exec", sql); }); }

  async isAdmin(ctx: Ctx) {
    try { return (await this.exec<{ a: boolean }>(ctx, "select private.is_admin() as a"))[0]!.a === true; } catch { return false; }
  }

  from(getCtx: () => Ctx) {
    const bridge = this;
    return (table: string) => {
      ident(table);
      const q = { op: "select" as "select" | "insert" | "update", select: "*", returning: false, head: false, payload: {} as Record<string, unknown>,
        filters: [] as { col: string; op: "=" | "<>"; v: unknown }[], order: null as null | { col: string; asc: boolean }, limit: null as null | number };
      const run = async (): Promise<{ data: unknown; error: Failure; count?: number | null }> => {
        const params: unknown[] = [];
        const where = q.filters.length ? ` where ${q.filters.map((f) => { params.push(f.v); return `${ident(f.col)} ${f.op} $${params.length}`; }).join(" and ")}` : "";
        let sql: string;
        if (q.op === "select") {
          if (q.head) sql = `select count(*)::int as c from public.${table}${where}`;
          else sql = `select ${cols(q.select)} from public.${table}${where}${q.order ? ` order by ${ident(q.order.col)} ${q.order.asc ? "asc" : "desc"}` : ""}${q.limit !== null ? ` limit ${Number(q.limit)}` : ""}`;
        } else if (q.op === "insert") {
          const keys = Object.keys(q.payload);
          const base = params.length;
          keys.forEach((k) => params.push(q.payload[k]));
          sql = `insert into public.${table} (${keys.map(ident).join(", ")}) values (${keys.map((_, i) => `$${base + i + 1}`).join(", ")})${q.returning ? ` returning ${cols(q.select)}` : ""}`;
        } else {
          const keys = Object.keys(q.payload);
          const sets = keys.map((k) => { params.push(q.payload[k]); return `${ident(k)} = $${params.length}`; });
          sql = `update public.${table} set ${sets.join(", ")}${where}${q.returning ? ` returning ${cols(q.select)}` : ""}`;
        }
        try {
          const rows = await bridge.exec<Record<string, unknown>>(getCtx(), sql, params);
          if (q.op === "select" && q.head) return { data: null, error: null, count: Number(rows[0]!["c"]) };
          return { data: q.op === "select" || q.returning ? rows : null, error: null };
        } catch (e) {
          const err = e as { code?: string; message?: string };
          const status = err.code === "42501" ? 403 : 400;
          return { data: null, error: { ...(err.code ? { code: err.code } : {}), message: String(err.message), status } };
        }
      };
      const b: Record<string, unknown> = {
        select: (c = "*", o?: { count?: string; head?: boolean }) => { q.select = c; if (q.op !== "select") q.returning = true; q.head = !!o?.head; return b; },
        insert: (p: Record<string, unknown>) => { q.op = "insert"; q.payload = p; return b; },
        update: (p: Record<string, unknown>) => { q.op = "update"; q.payload = p; return b; },
        eq: (col: string, v: unknown) => { q.filters.push({ col, op: "=", v }); return b; },
        neq: (col: string, v: unknown) => { q.filters.push({ col, op: "<>", v }); return b; },
        order: (col: string, o?: { ascending?: boolean }) => { q.order = { col, asc: o?.ascending !== false }; return b; },
        limit: (n: number) => { q.limit = n; return b; },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
      };
      return b;
    };
  }

  storage(getCtx: () => Ctx) {
    const bridge = this;
    return {
      from: (bucket: string) => ({
        async upload(path: string, blob: Blob, opts: { upsert?: boolean } = {}) {
          if (bridge.failNextUpload) { const e = bridge.failNextUpload; bridge.failNextUpload = null; return { data: null, error: e }; }
          if (!bridge.storageOpen && !(await bridge.isAdmin(getCtx()))) return { data: null, error: { message: "new row violates row-level security policy", statusCode: "403" } };
          const key = `${bucket}/${path}`;
          if (bridge.objects.has(key) && !opts.upsert) return { data: null, error: { message: "The resource already exists", statusCode: "409" } };
          bridge.objects.set(key, blob.size);
          return { data: { path }, error: null };
        },
        async remove(paths: string[]) {
          if (!bridge.storageOpen && !(await bridge.isAdmin(getCtx()))) return { data: [], error: null };   // la RLS Storage ne supprime rien, sans erreur
          for (const p of paths) bridge.objects.delete(`${bucket}/${p}`);
          return { data: paths.map((name) => ({ name })), error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `${BASE_URL}/storage/v1/object/public/${bucket}/${path}` } }),
      }),
    };
  }

  adminClient() { return { from: this.from(() => this.adminCtx), storage: this.storage(() => this.adminCtx) }; }
  anonClient() { return { from: this.from(() => this.anonCtx), storage: this.storage(() => this.anonCtx) }; }
}

export const bridge = new Bridge();
