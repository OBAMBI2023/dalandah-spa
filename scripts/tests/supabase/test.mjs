// Suite principale : droits anon/authenticated, RLS, réservation, annulation, limites anti-abus.
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

// --- Environnement Supabase simulé -----------------------------------------
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

// --- Migration + seed -------------------------------------------------------
try {
  await db.exec(migrationSql());
  ok("migration appliquée sur base vierge", true);
} catch (e) { ok("migration appliquée sur base vierge", false, e.message); process.exit(1); }
try { await db.exec(readFileSync(`${root}/seed.sql`, "utf8")); ok("seed appliqué", true); }
catch (e) { ok("seed appliqué", false, e.message); process.exit(1); }

// --- Utilitaires ------------------------------------------------------------
let ipN = 0;
const newIp = async () => db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ "cf-connecting-ip": `ip-${++ipN}` })]);
const as = async (role, sub = "") => { await db.exec("reset role"); if (role) await db.exec(`set role ${role}`); await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]); };
const denied = async (sql, params = []) => { try { await db.query(sql, params); return false; } catch (e) { return /permission denied|must be owner|row-level security/i.test(e.message) ? true : "autre erreur: " + e.message; } };
const rpc = async (fn, args) => { await newIp(); const r = await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args); return r.rows[0].r; };
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return d.toISOString().slice(0, 10); };
const book = (svc, date, slot, name = "Aminata Koné", phone = "+225 07 07 07 07 07", c = "") => rpc("create_booking", [svc, date, slot, name, phone, c]);
const A = async (sql, p = []) => (await db.query(sql, p)).rows;

// --- 1. Accès invité ---------------------------------------------------------
await as("anon");
ok("anon lit le catalogue (10 prestations)", (await A("select count(*)::int n from public.services"))[0].n === 10);
ok("anon lit les créneaux (6)", (await A("select count(*)::int n from public.time_slots"))[0].n === 6);
ok("anon lit les réglages", (await A("select min_notice_hours from public.salon_settings")).length === 1);
for (const t of ["bookings", "profiles", "user_roles"]) ok(`anon ne lit pas ${t}`, (await denied(`select * from public.${t}`)) === true);
ok("anon n'écrit pas dans services", (await denied(`insert into public.services (id,name,category,duration_min,duration_label,price_fcfa) values ('xx-yy','Test','visage',30,'30 min',1)`)) === true);
ok("anon ne modifie pas les réglages", (await denied(`update public.salon_settings set min_notice_hours = 0`)) === true);
ok("anon ne peut pas TRUNCATE", (await denied(`truncate public.services`)) === true);
ok("anon n'accède pas au schéma private", (await denied(`select private.is_admin()`)) === true);
ok("anon n'accède pas à private.rate_limit_hit", (await denied(`select private.rate_limit_hit('a','b',1,'1 hour')`)) === true);
ok("anon ne lit pas private.rate_limits", (await denied(`select * from private.rate_limits`)) === true);
await as(null);
const privs = (await A(`select has_function_privilege('anon','public.create_booking(text,date,text,text,text,text)','execute') c,
   has_function_privilege('anon','private.rate_limit_hit(text,text,integer,interval)','execute') r,
   has_function_privilege('anon','private.has_role(public.app_role)','execute') h`))[0];
ok("anon peut exécuter create_booking", privs.c === true);
ok("anon ne peut pas exécuter les helpers privés", privs.r === false && privs.h === false);

// --- 2. Disponibilités et chevauchements ---------------------------------------
const d3 = day(3);
let av = await rpc("get_availability", [d3, "nattes"]);
ok("get_availability : 6 créneaux libres", (await A(`select * from public.get_availability($1,'nattes')`, [d3])).filter((r) => r.available).length === 6);

let r = await book("nattes", d3, "09:00");
ok("create_booking valide", r.ok === true && /^DLD-[0-9A-F]{10}$/.test(r.ref), JSON.stringify(r));
const ref1 = r.ref;
r = await book("massage-dos", d3, "09:00", "Autre Cliente", "07 08 09 10 11");
ok("même créneau refusé", r.ok === false && r.code === "slot_unavailable", JSON.stringify(r));
r = await book("massage-dos", d3, "10:30", "Autre Cliente", "07 08 09 10 11");
ok("chevauchement avec soin long (nattes 180 min) refusé", r.ok === false && r.code === "slot_unavailable", JSON.stringify(r));
const avs = await A(`select * from public.get_availability($1,'massage-dos')`, [d3]);
const f = Object.fromEntries(avs.map((x) => [x.slot, x.available]));
ok("disponibilités : 09:00 et 10:30 bloqués, 12:00 libre (fin exclusive)", f["09:00"] === false && f["10:30"] === false && f["12:00"] === true && f["14:00"] === true, JSON.stringify(f));
r = await book("massage-dos", d3, "12:00", "Autre Cliente", "07 08 09 10 11");
ok("créneau qui commence à la fin du précédent accepté", r.ok === true, JSON.stringify(r));

// --- 3. Validation ---------------------------------------------------------------
const bad = async (label, args, code) => { const x = await book(...args); ok(label, x.ok === false && x.code === code, JSON.stringify(x)); };
await bad("nom d'un caractère refusé", ["pedicure", day(4), "09:00", "A", "0707070707"], "invalid_input");
await bad("téléphone avec lettres refusé", ["pedicure", day(4), "09:00", "Awa Diallo", "abcdefghij"], "invalid_input");
await bad("téléphone de 7 chiffres refusé", ["pedicure", day(4), "09:00", "Awa Diallo", "1234567"], "invalid_input");
await bad("téléphone de 16 chiffres refusé", ["pedicure", day(4), "09:00", "Awa Diallo", "1234567890123456"], "invalid_input");
await bad("créneau hors grille refusé", ["pedicure", day(4), "09:15", "Awa Diallo", "0707070707"], "invalid_input");
await bad("créneau mal formé refusé", ["pedicure", day(4), "9h", "Awa Diallo", "0707070707"], "invalid_input");
await bad("prestation inconnue", ["inconnu", day(4), "09:00", "Awa Diallo", "0707070707"], "service_not_found");
await bad("date passée refusée", ["pedicure", day(-1), "09:00", "Awa Diallo", "0707070707"], "too_early");
await bad("date au-delà de 180 jours refusée", ["pedicure", day(181), "09:00", "Awa Diallo", "0707070707"], "too_far");
r = await book("pedicure", day(180), "09:00", "Awa Diallo", "0707070701");
ok("date à 180 jours acceptée", r.ok === true, JSON.stringify(r));

await db.exec("reset role");
await db.exec("update public.salon_settings set min_notice_hours = 100");
await as("anon");
await bad("préavis insuffisant refusé (préavis 100 h, rdv dans 72 h)", ["pedicure", day(3), "17:00", "Awa Diallo", "0707070702"], "too_early");
await db.exec("reset role"); await db.exec("update public.salon_settings set min_notice_hours = 2"); await as("anon");
ok("préavis de 2 h par défaut", (await A("select min_notice_hours from public.salon_settings"))[0].min_notice_hours === 2);

r = await book("pedicure", day(5), "14:00", "  Fatou\u0007  Sy ", "0707070703", "x".repeat(600) + "\u0001");
ok("réservation avec nom à caractère de contrôle", r.ok === true, JSON.stringify(r));
await db.exec("reset role");
const stored = (await A(`select name, char_length(comment) n from public.bookings where ref=$1`, [r.ref]))[0];
ok("nom nettoyé et commentaire tronqué à 500", stored.name === "Fatou Sy" && stored.n === 500, JSON.stringify(stored));
await as("anon");

// --- 4. Limite par téléphone ----------------------------------------------------
const ph = "0505050505";
let res = [];
for (const n of [6, 7, 8, 9]) res.push((await book("pedicure", day(n), "09:00", "Mariam Traoré", ph)));
ok("3 rendez-vous à venir par numéro, le 4e refusé", res.slice(0, 3).every((x) => x.ok) && res[3].code === "phone_limit", JSON.stringify(res.map((x) => x.code || "ok")));

// --- 5. Consultation et annulation invité -----------------------------------------
r = await rpc("get_booking", [ref1, "07 07 07 07 07"]);
ok("get_booking : bonne référence + téléphone sans indicatif", r.ok === true && r.booking.status === "confirmed" && r.booking.can_cancel === true && r.booking.slot === "09:00", JSON.stringify(r));
r = await rpc("get_booking", [ref1, "0000000000"]);
ok("get_booking : mauvais téléphone → introuvable", r.ok === false && r.code === "not_found", JSON.stringify(r));
r = await rpc("get_booking", ["DLD-0000000000", "0707070707"]);
ok("get_booking : mauvaise référence → introuvable", r.ok === false && r.code === "not_found", JSON.stringify(r));
r = await rpc("get_booking", [ref1.toLowerCase(), "+22507070707 07"]);
ok("get_booking : référence en minuscules acceptée", r.ok === true, JSON.stringify(r));

// force brute sur un numéro depuis une même IP : 10 tentatives/h par couple (numéro, IP), puis blocage
const rpcAt = async (ip, fn, args) => { await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ "cf-connecting-ip": ip })]); return (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args)).rows[0].r; };
let blocked = null;
for (let i = 1; i <= 14; i++) { const x = await rpcAt("ip-acharnee", "get_booking", [`DLD-AAAAAAAA${String(i).padStart(2, "0")}`, "0909090909"]); if (x.code === "rate_limited") { blocked = i; break; } }
ok("force brute d'une même IP sur un numéro bloquée après 10 tentatives", blocked === 11, "bloqué à " + blocked);

// force brute répartie sur de nombreuses IP : plafond global de 100 tentatives/h par numéro
let blockedDist = null;
for (let i = 1; i <= 105; i++) { const x = await rpc("get_booking", [`DLD-DDDDDDDD${String(i).padStart(3, "0")}`, "0808080808"]); if (x.code === "rate_limited") { blockedDist = i; break; } }
ok("force brute répartie sur plusieurs IP bloquée après 100 tentatives par numéro", blockedDist === 101, "bloqué à " + blockedDist);

// force brute depuis une IP unique
let ipBlock = null;
await db.query(`select set_config('request.headers', '{"cf-connecting-ip":"attaquant"}', false)`);
for (let i = 1; i <= 40; i++) { const x = (await db.query(`select public.get_booking($1,$2) r`, [`DLD-BBBBBBBB${i}`, `06060606${String(i).padStart(2, "0")}`])).rows[0].r; if (x.code === "rate_limited") { ipBlock = i; break; } }
ok("force brute depuis une IP bloquée après 30 tentatives", ipBlock === 31, "bloqué à " + ipBlock);

// limitation des réservations par IP
await db.query(`select set_config('request.headers', '{"cf-connecting-ip":"robot"}', false)`);
let rb = null;
for (let i = 1; i <= 15; i++) { const x = (await db.query(`select public.create_booking('pedicure',$1,'09:00','A','x','') r`, [day(10)])).rows[0].r; if (x.code === "rate_limited") { rb = i; break; } }
ok("réservations automatisées bloquées après 10 tentatives par IP", rb === 11, "bloqué à " + rb);

// annulation
await db.exec("reset role"); await db.exec("update public.salon_settings set cancel_notice_hours = 160"); await as("anon");
r = await rpc("cancel_booking", [ref1, "0707070707"]);
ok("annulation refusée moins de N h avant (préavis 160 h)", r.ok === false && r.code === "too_late", JSON.stringify(r));
await db.exec("reset role"); await db.exec("update public.salon_settings set cancel_notice_hours = 2"); await as("anon");
r = await rpc("cancel_booking", [ref1, "0000000000"]);
ok("annulation avec mauvais téléphone refusée", r.ok === false && r.code === "not_found", JSON.stringify(r));
r = await rpc("cancel_booking", [ref1, "0707070707"]);
ok("annulation valide", r.ok === true, JSON.stringify(r));
r = await rpc("cancel_booking", [ref1, "0707070707"]);
ok("double annulation refusée", r.ok === false && r.code === "not_active", JSON.stringify(r));
r = await book("massage-dos", d3, "10:30", "Autre Cliente", "0708091011");
ok("créneau libéré par l'annulation : de nouveau réservable", r.ok === true, JSON.stringify(r));
ok("anon ne peut pas annuler directement", (await denied(`update public.bookings set status='cancelled'`)) === true);

// --- 6. Connectée et administratrice ------------------------------------------------
await db.exec("reset role");
const u1 = (await A(`insert into auth.users (email) values ('cliente@test.local') returning id`))[0].id;
const u2 = (await A(`insert into auth.users (email) values ('admin@test.local') returning id`))[0].id;
await as("authenticated", u1);
r = await book("manucure", day(12), "09:00", "Cliente Connectée", "0102030405");
ok("réservation d'une cliente connectée", r.ok === true, JSON.stringify(r));
const mine = await A("select ref, user_id from public.bookings");
ok("la cliente ne voit que ses réservations", mine.length === 1 && mine[0].user_id === u1, JSON.stringify(mine));
ok("la cliente ne peut pas s'attribuer un rôle", (await denied(`insert into public.user_roles (user_id, role) values ($1,'admin')`, [u1])) === true);
ok("la cliente n'est pas admin", (await A("select private.is_admin() a"))[0].a === false);
const upd = await db.query(`update public.bookings set status='cancelled' where user_id=$1`, [u1]);
ok("la cliente ne peut pas modifier une réservation (0 ligne)", upd.affectedRows === 0, String(upd.affectedRows));
const cat = await db.query(`update public.services set price_fcfa = 1`);
ok("la cliente ne peut pas modifier le catalogue (0 ligne)", cat.affectedRows === 0, String(cat.affectedRows));
const ins = await denied(`insert into public.services (id,name,category,duration_min,duration_label,price_fcfa) values ('xx-yy','Test','visage',30,'30 min',1)`);
ok("la cliente ne peut pas créer de prestation", ins === true, String(ins));
await db.query(`insert into public.profiles (user_id, name) values ($1,'Cliente')`, [u1]);
ok("la cliente gère son profil", (await A("select count(*)::int n from public.profiles"))[0].n === 1);
ok("la cliente ne peut pas écrire le profil d'une autre", (await denied(`insert into public.profiles (user_id) values ($1)`, [u2])) === true);

await db.exec("reset role");
await db.query(`insert into public.user_roles (user_id, role) values ($1,'admin')`, [u2]);
await as("authenticated", u2);
ok("l'admin est reconnue", (await A("select private.is_admin() a"))[0].a === true);
const all = await A("select count(*)::int n from public.bookings");
ok("l'admin voit toutes les réservations", all[0].n >= 7, JSON.stringify(all));
const au = await db.query(`update public.bookings set status='cancelled' where ref=$1`, [mine[0].ref]);
ok("l'admin peut annuler une réservation", au.affectedRows === 1);
const trace = (await A(`select cancelled_by, cancelled_at is not null as t from public.bookings where ref=$1`, [mine[0].ref]))[0];
ok("annulation admin tracée (cancelled_by = admin)", trace.cancelled_by === "admin" && trace.t === true, JSON.stringify(trace));
ok("l'admin ne peut pas modifier le prix ni la date (colonnes)", (await denied(`update public.bookings set price_fcfa = 1`)) === true && (await denied(`update public.bookings set starts_at = now()`)) === true);
const as2 = await db.query(`update public.services set price_fcfa = 16000 where id='soin-visage-eclat'`);
ok("l'admin peut modifier le catalogue", as2.affectedRows === 1);
await db.exec("reset role");
const snap = (await A(`select price_fcfa from public.bookings where ref=$1`, [ref1]))[0];
ok("les réservations existantes gardent leur prix d'origine (instantané)", snap.price_fcfa === 15000, JSON.stringify(snap));
ok("TRUNCATE interdit à authenticated", (await (async () => { await as("authenticated", u1); return denied(`truncate public.bookings`); })()) === true);

await db.exec("reset role");
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
