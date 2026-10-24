// Normalisation des numéros ivoiriens (+225, 00225, anciens numéros à 8 chiffres), limites anti-abus,
// droits liés à la colonne générée phone_key et durée des nattes.
// Base PostgreSQL locale en mémoire (PGlite) : aucune connexion au projet Supabase distant.
// Exécution : bun run test:sql:limits
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SUPABASE_DIR permet de tester une autre copie du dossier supabase/ (par défaut : celui du dépôt).
const root = process.env.SUPABASE_DIR ?? fileURLToPath(new URL("../../../supabase", import.meta.url));
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + extra}`); };
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`);
await db.exec(readdirSync(`${root}/migrations`).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(`${root}/migrations/${f}`, "utf8")).join("\n"));
await db.exec(readFileSync(`${root}/seed.sql`, "utf8"));

let n = 0;
const as = async (role, sub = "") => { await db.exec("reset role"); if (role) await db.exec(`set role ${role}`); await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]); };
const rpcAt = async (ip, fn, args) => { await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ "cf-connecting-ip": ip })]); return (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) r`, args)).rows[0].r; };
const rpc = (fn, args) => rpcAt(`ip-${++n}`, fn, args);
const D = (k) => new Date(Date.now() + k * 864e5).toISOString().slice(0, 10);
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const norm = async (p) => { await as(null); const v = (await q("select private.normalize_phone($1) v", [p]))[0].v; await as("anon"); return v; };
await as("anon");

// ---------- N. Normalisation : table d'équivalence ----------
const same10 = ["0707070707", "07 07 07 07 07", "07.07.07.07.07", "07-07-07-07-07", "+225 07 07 07 07 07", "+225 0707070707",
                "+2250707070707", "00225 0707070707", "00225 07 07 07 07 07", "225 0707070707"];
const same8 = ["07070707", "07 07 07 07", "+225 07070707", "+225 07 07 07 07", "00225 07070707", "225 07070707"];
for (const v of same10) ok(`10 chiffres : « ${v} » → 0707070707`, (await norm(v)) === "0707070707", await norm(v));
for (const v of same8) ok(`ancien format 8 chiffres : « ${v} » → 07070707`, (await norm(v)) === "07070707", await norm(v));
const distinct = [["0707070707", "0507070707"], ["0707070707", "0107070707"], ["0707070707", "07070707"], ["+225 0707070707", "+33 7 07 07 07 07"],
                  ["+33 6 12 34 56 78", "612345678"], ["+229 61 23 45 67", "61234567"]];
for (const [a, b] of distinct) ok(`numéros distincts non fusionnés : « ${a} » ≠ « ${b} »`, (await norm(a)) !== (await norm(b)), `${await norm(a)} / ${await norm(b)}`);
ok("« 225 » suivi d'un nombre de chiffres inattendu (12) n'est pas retiré", (await norm("225 070707070707")) === "225070707070707", await norm("225 070707070707"));
ok("entrée vide ou sans chiffre : chaîne vide", (await norm("")) === "" && (await norm("abc")) === "");

// ---------- F. Réservation et consultation de bout en bout selon le format saisi ----------
let r = await rpc("create_booking", ["pedicure", D(5), "09:00", "Aminata Koné", "+225 07 07 07 07 07", ""]); const ref10 = r.ref;
ok("réservation saisie en +225 + 10 chiffres", r.ok === true, JSON.stringify(r));
for (const v of ["0707070707", "00225 0707070707", "225 0707070707", "+2250707070707"]) {
  const g = await rpc("get_booking", [ref10, v]);
  ok(`consultation avec « ${v} »`, g.ok === true, JSON.stringify(g));
}
for (const v of ["0507070707", "0107070707", "07070707", "+33 7 07 07 07 07"]) {
  const g = await rpc("get_booking", [ref10, v]);
  ok(`consultation refusée avec un numéro différent « ${v} »`, g.ok === false && g.code === "not_found", JSON.stringify(g));
}
r = await rpc("create_booking", ["manucure", D(6), "09:00", "Awa Diallo", "00225 07070707", ""]); const ref8 = r.ref;
ok("réservation saisie en 00225 + ancien numéro à 8 chiffres", r.ok === true, JSON.stringify(r));
for (const v of ["07070707", "+225 07070707", "225 07 07 07 07"]) { const g = await rpc("get_booking", [ref8, v]); ok(`ancien numéro retrouvé avec « ${v} »`, g.ok === true, JSON.stringify(g)); }
let g = await rpc("get_booking", [ref8, "0707070707"]);
ok("(limite connue) l'ancien numéro à 8 chiffres ne correspond pas au même numéro à 10 chiffres", g.ok === false && g.code === "not_found", JSON.stringify(g));

// ---------- C. Le plafond de rendez-vous à venir compte tous les formats d'un même numéro ----------
const fmts = ["0102030405", "+225 01 02 03 04 05", "00225 0102030405", "01 02 03 04 05"]; const res = [];
for (let i = 0; i < 4; i++) res.push(await rpc("create_booking", ["pedicure", D(10 + i), "09:00", "Cliente Formats", fmts[i], ""]));
ok("3 rendez-vous en 3 formats du même numéro, le 4e (4e format) refusé", res.slice(0, 3).every((x) => x.ok) && res[3].code === "phone_limit", JSON.stringify(res.map((x) => x.code ?? "ok")));

// ---------- L. Limites ----------
const victim = "0112131415";
r = await rpc("create_booking", ["pedicure", D(7), "09:00", "Cliente Victime", victim, ""]); const vref = r.ref;
for (let i = 0; i < 30; i++) await rpc("get_booking", [`DLD-AAAAAAAA${String(i).padStart(2, "0")}`, victim]);
g = await rpcAt("ip-cliente", "get_booking", [vref, victim]);
ok("30 tentatives d'un tiers (30 IP) sur son numéro : la cliente consulte toujours sa réservation", g.ok === true, JSON.stringify(g));
const c = await rpcAt("ip-cliente", "cancel_booking", [vref, victim]);
ok("… et peut l'annuler", c.ok === true, JSON.stringify(c));

let b1 = null;
for (let i = 1; i <= 15; i++) { const x = await rpcAt("ip-acharnee", "get_booking", [`DLD-BBBBBBBB${String(i).padStart(2, "0")}`, "0909090909"]); if (x.code === "rate_limited") { b1 = i; break; } }
ok("consultation : une même IP sur un numéro est bloquée après 10 tentatives (couple numéro/IP)", b1 === 11, "bloqué à " + b1);
let b2 = null;
for (let i = 1; i <= 110; i++) { const x = await rpc("get_booking", [`DLD-DDDDDDDD${String(i).padStart(3, "0")}`, "0808080808"]); if (x.code === "rate_limited") { b2 = i; break; } }
ok("consultation : force brute répartie sur de nombreuses IP, plafond de 100 par heure et par numéro", b2 === 101, "bloqué à " + b2);
let b2c = null;
for (let i = 1; i <= 110; i++) { const x = await rpc("cancel_booking", [`DLD-EEEEEEEE${String(i).padStart(3, "0")}`, "0818181818"]); if (x.code === "rate_limited") { b2c = i; break; } }
ok("annulation : même plafond de 100 par heure et par numéro", b2c === 101, "bloqué à " + b2c);
let b2m = null;
for (let i = 1; i <= 40; i++) { const x = await rpcAt("ip-mixte", i % 2 ? "get_booking" : "cancel_booking", [`DLD-FFFFFFFF${String(i).padStart(2, "0")}`, `0${(i % 9) + 1}3333333${i % 10}`]); if (x.code === "rate_limited") { b2m = i; break; } }
ok("consultation et annulation partagent le plafond de 30 tentatives par IP et par heure", b2m === 31, "bloqué à " + b2m);

let b3 = null;
for (let i = 1; i <= 10; i++) { const x = await rpcAt("ip-resa", "create_booking", ["pedicure", D(40 + i), "09:00", "Test Limite", "0414141414", ""]); if (x.code === "rate_limited") { b3 = i; break; } }
ok("réservation : une même IP sur un numéro est bloquée après 5 tentatives (couple numéro/IP)", b3 === 6, "bloqué à " + b3);
let b4 = null;
for (let i = 1; i <= 25; i++) { const x = await rpc("create_booking", ["pedicure", D(60 + (i % 20)), "09:00", "Test Limite", "0515151515", ""]); if (x.code === "rate_limited") { b4 = i; break; } }
ok("réservation : plafond de 20 tentatives par heure et par numéro (toutes IP confondues)", b4 === 21, "bloqué à " + b4);
let b5 = null;
for (let i = 1; i <= 15; i++) { const x = await rpcAt("ip-robot", "create_booking", ["pedicure", D(80), "09:00", "A", "x", ""]); if (x.code === "rate_limited") { b5 = i; break; } }
ok("réservation : plafond de 10 tentatives par IP et par heure conservé", b5 === 11, "bloqué à " + b5);

// ---------- A. Colonne générée et droits ----------
await as(null);
const adm = (await q("insert into auth.users(email) values ('admin@t') returning id"))[0].id;
await db.query("insert into public.user_roles(user_id,role) values ($1,'admin')", [adm]);
await as("authenticated", adm);
let u = await db.query("update public.bookings set status='cancelled' where ref=$1", [ref10]);
ok("l'administrateur peut modifier une réservation (colonne générée phone_key évaluée avec ses droits)", u.affectedRows === 1, String(u.affectedRows));
await as("service_role");
u = await db.query("update public.bookings set comment='note interne' where ref=$1", [ref8]);
ok("service_role peut modifier une réservation (Edge Function future)", u.affectedRows === 1, String(u.affectedRows));
await as("anon");
let err = null; try { await db.query("select private.normalize_phone('0707070707')"); } catch (e) { err = e.message; }
ok("anon ne peut pas appeler normalize_phone directement", /permission denied/.test(err ?? ""), String(err));
await as("authenticated", adm);
ok("authenticated peut l'appeler (nécessaire à la colonne générée, fonction pure sans donnée)", (await q("select private.normalize_phone('+225 0707070707') v"))[0].v === "0707070707");

// ---------- K. Durée opérationnelle des nattes ----------
await as(null);
const nat = (await q("select duration_min, duration_label, is_demo from public.services where id='nattes'"))[0];
ok("nattes : durée opérationnelle 180 min, libellé « 2 h et + », marquée démonstration", nat.duration_min === 180 && nat.duration_label === "2 h et +" && nat.is_demo === true, JSON.stringify(nat));
await as("anon");
r = await rpc("create_booking", ["nattes", D(9), "09:00", "Cliente Nattes", "0616161616", ""]);
const av = Object.fromEntries((await q("select * from public.get_availability($1,'massage-dos')", [D(9)])).map((x) => [x.slot, x.available]));
ok("nattes à 09:00 bloquent 09:00 et 10:30, libèrent 12:00", r.ok && av["09:00"] === false && av["10:30"] === false && av["12:00"] === true, JSON.stringify(av));

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
