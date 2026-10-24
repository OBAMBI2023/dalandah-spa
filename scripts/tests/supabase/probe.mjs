// Sondages complémentaires : chevauchements, annulations, cas limites, inventaire des droits.
// Base PostgreSQL locale en mémoire (PGlite) : aucune connexion au projet Supabase distant.
// Exécution : bun run test:sql   (voir scripts/tests/supabase/README.md)
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SUPABASE_DIR permet de tester une autre copie du dossier supabase/ (par défaut : celui du dépôt).
const root = process.env.SUPABASE_DIR ?? fileURLToPath(new URL("../../../supabase", import.meta.url));
const migrationSql = () => readdirSync(`${root}/migrations`).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(`${root}/migrations/${f}`, "utf8")).join("\n");

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + extra}`); };

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);
await db.exec(migrationSql());
await db.exec(readFileSync(`${root}/seed.sql`, "utf8"));

let ipN = 0;
const setIp = (ip) => db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ "cf-connecting-ip": ip })]);
const newIp = () => setIp(`ip-${++ipN}`);
const as = async (role, sub = "") => { await db.exec("reset role"); if (role) await db.exec(`set role ${role}`); await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]); };
const denied = async (sql, params = []) => { try { await db.query(sql, params); return false; } catch (e) { return e.message; } };
const rpc = async (fn, args) => { await newIp(); const r = await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args); return r.rows[0].r; };
const D = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const book = (svc, date, slot, name, phone) => rpc("create_booking", [svc, date, slot, name, phone, ""]);
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

// a. chevauchement dans l'autre sens
await as("anon");
let r = await book("massage-dos", D(3), "10:30", "Cliente Un", "0101010101");
ok("a1 soin court à 10:30 réservé", r.ok, JSON.stringify(r));
r = await book("nattes", D(3), "09:00", "Cliente Deux", "0202020202");
ok("a2 nattes à 09:00 refusé (chevauche 10:30)", r.code === "slot_unavailable", JSON.stringify(r));
const av = Object.fromEntries((await q("select * from public.get_availability($1,'nattes')", [D(3)])).map((x) => [x.slot, x.available]));
ok("a3 get_availability(nattes) : 09:00 et 10:30 indisponibles, 12:00 disponible", av["09:00"] === false && av["10:30"] === false && av["12:00"] === true, JSON.stringify(av));
r = await book("nattes", D(3), "12:00", "Cliente Deux", "0202020202");
ok("a4 nattes à 12:00 accepté (adjacent à la fin du 10:30-11:00)", r.ok, JSON.stringify(r));

// b. annulée puis reconfirmée par l'administrateur en conflit
await as(null);
const adm = (await q("insert into auth.users(email) values ('a@t') returning id"))[0].id;
await db.query("insert into public.user_roles(user_id,role) values ($1,'admin')", [adm]);
await as("anon");
r = await book("pedicure", D(4), "09:00", "Cliente Trois", "0303030303"); const refA = r.ref;
r = await rpc("cancel_booking", [refA, "0303030303"]);
ok("b1 annulation client", r.ok, JSON.stringify(r));
r = await book("pedicure", D(4), "09:00", "Cliente Quatre", "0404040404");
ok("b2 créneau annulé de nouveau réservable", r.ok, JSON.stringify(r));
await as("authenticated", adm);
const e = await denied("update public.bookings set status='confirmed' where ref=$1", [refA]);
ok("b3 reconfirmer l'annulée alors que le créneau est repris : refusé par la contrainte", typeof e === "string" && /exclusion|conflict/i.test(e), String(e));
await as(null);
ok("b4 la réservation reste annulée", (await q("select status from public.bookings where ref=$1", [refA]))[0].status === "cancelled");

// c. les annulées ne comptent pas dans la limite par téléphone
await as("anon");
const ph = "0505050505"; const refs = [];
for (const n of [20, 21, 22]) refs.push((await book("pedicure", D(n), "09:00", "Cliente Cinq", ph)).ref);
r = await book("pedicure", D(23), "09:00", "Cliente Cinq", ph);
ok("c1 4e rendez-vous refusé (3 actifs)", r.code === "phone_limit", JSON.stringify(r));
await rpc("cancel_booking", [refs[0], ph]);
r = await book("pedicure", D(23), "09:00", "Cliente Cinq", ph);
ok("c2 après une annulation, un nouveau rendez-vous est possible", r.ok, JSON.stringify(r));

// d. get_availability : cas limites
const cnt = async (d, s) => (await q("select count(*)::int n, count(*) filter (where available)::int a from public.get_availability($1,$2)", [d, s]))[0];
ok("d1 service inconnu : 0 ligne", (await cnt(D(3), "zzz")).n === 0);
ok("d2 date nulle : 0 ligne", (await q("select count(*)::int n from public.get_availability(null,'nattes')"))[0].n === 0);
let c = await cnt(D(-2), "nattes"); ok("d3 date passée : tout indisponible", c.n === 6 && c.a === 0, JSON.stringify(c));
c = await cnt(D(181), "nattes"); ok("d4 date à 181 jours : tout indisponible", c.n === 6 && c.a === 0, JSON.stringify(c));
await as(null); await db.exec("update public.services set active=false where id='manucure'"); await as("anon");
ok("d5 service inactif : 0 ligne", (await cnt(D(3), "manucure")).n === 0);
r = await book("manucure", D(3), "17:00", "Cliente Six", "0606060606");
ok("d6 service inactif non réservable", r.code === "service_not_found", JSON.stringify(r));

// f. plafond par IP partagée (cas d'une Edge Function : une seule IP pour tous les clients)
await setIp("edge-fn");
let blocked = null;
for (let i = 1; i <= 14; i++) {
  const x = (await db.query("select public.create_booking('pedicure',$1,'09:00','Client Test',$2,'') r", [D(30 + i), "07000000" + String(i).padStart(2, "0")])).rows[0].r;
  if (x.code === "rate_limited") { blocked = i; break; }
}
ok("f1 (constat) une IP partagée est plafonnée à 10 réservations/h pour tous les clients", blocked === 11, "bloqué à " + blocked);

// l. privilèges par défaut sur de futurs objets
await as(null);
await db.exec("create function public.future_fn() returns int language sql as 'select 1'");
ok("l1 (constat) une future fonction publique est exécutable par anon (PUBLIC) tant qu'on ne la révoque pas",
  (await q("select has_function_privilege('anon','public.future_fn()','execute') a"))[0].a === true);
await db.exec("create table public.future_t (id int)");
ok("l2 une future table publique n'est pas lisible par anon", (await q("select has_table_privilege('anon','public.future_t','select') a"))[0].a === false);

// j. inventaire
console.log("\n--- fonctions (public, private) ---");
for (const f of await q(`select n.nspname||'.'||p.proname as fn, p.prosecdef as definer, coalesce(p.proconfig::text,'-') as cfg,
  coalesce((select string_agg(distinct a.grantee::regrole::text,',') from aclexplode(p.proacl) a where a.privilege_type='EXECUTE'),'(PUBLIC par défaut)') as exec
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname<>'future_fn' order by 1`))
  console.log(f.fn.padEnd(34), "definer=" + String(f.definer).padEnd(6), f.cfg.padEnd(20), "execute:", f.exec);
console.log("\n--- privilèges tables (anon / authenticated) ---");
for (const x of await q(`select table_schema||'.'||table_name t, grantee, string_agg(privilege_type,',' order by privilege_type) p
  from information_schema.table_privileges where grantee in ('anon','authenticated') and table_name<>'future_t' and table_schema in ('public','private')
  group by 1,2 order by 1,2`)) console.log(x.t.padEnd(26), x.grantee.padEnd(14), x.p);
console.log("\n--- politiques RLS ---");
for (const x of await q("select tablename, policyname, cmd, roles::text from pg_policies where schemaname='public' order by 1,2")) console.log(x.tablename.padEnd(16), x.policyname.padEnd(28), x.cmd.padEnd(8), x.roles);
console.log("\n--- RLS activée ---");
for (const x of await q("select c.relname, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r' and c.relname<>'future_t' order by 1")) console.log(x.relname.padEnd(16), x.rls);
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
