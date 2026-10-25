// Traçabilité des promotions : événements anonymes dédupliqués, attribution des réservations liée à un CLIC réel de la même session (fenêtre de
// 24 h), plafonds anti-abus, purge, statistiques administrateur, droits / RLS, type « pourcentage » avec prix de référence annoncé, et
// NON-MODIFICATION de create_booking, services, products et bookings par supabase/migrations/20261030000000_promotion_tracking.sql.
// Paramètre facultatif : SUPABASE_DIR (dossier contenant migrations/ et seed.sql).
// Base PostgreSQL locale en mémoire (PGlite, une seule connexion : les « appels simultanés » sont sérialisés, la vraie concurrence n'est pas
// testée ici ; elle repose sur la clé primaire et ON CONFLICT). Aucune connexion au projet Supabase distant.
// Exécution : npm run test:sql:promotion-tracking
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = process.env.SUPABASE_DIR ?? fileURLToPath(new URL("../../../supabase", import.meta.url));
const TARGET = "20261030000000_promotion_tracking.sql";
const files = readdirSync(`${root}/migrations`).filter((f) => f.endsWith(".sql")).sort();
const read = (f) => readFileSync(`${root}/migrations/${f}`, "utf8");

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + extra}`); };
const A = async (sql, p = []) => (await db.query(sql, p)).rows;
const as = async (role, sub = "") => { await db.exec("reset role"); if (role) await db.exec(`set role ${role}`); await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]); };
let ipN = 0;
const setIp = async (ip) => db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ "cf-connecting-ip": ip })]);
const newIp = async () => setIp(`ip-${++ipN}`);
const fails = async (sql, p = [], re = /permission denied|row-level security|réservé aux administrateurs|violates (check|unique|foreign key)|duplicate key/i) => {
  try { await db.query(sql, p); return false; } catch (e) { return re.test(e.message) ? true : "autre erreur: " + e.message; }
};
const track = async (promo, event, session, ip) => { await (ip ? setIp(ip) : newIp()); return (await A("select public.track_promotion_event($1, $2, $3) as r", [promo, event, session]))[0].r; };
const attribute = async (ref, phone, promo, session, ip) => { await (ip ? setIp(ip) : newIp()); return (await A("select public.attribute_booking_to_promotion($1, $2, $3, $4) as r", [ref, phone, promo, session]))[0].r; };
const count = async (t, where = "true") => (await A(`select count(*)::int n from public.${t} where ${where}`))[0].n;
const hex = (c) => c.repeat(32);
const sess = (n) => n.toString(16).padStart(32, "0");

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
await db.exec(files.filter((f) => f < TARGET).map(read).join("\n"));
await db.exec(readFileSync(`${root}/seed.sql`, "utf8"));

const ADMIN = "00000000-0000-0000-0000-0000000000a1", CLIENT = "00000000-0000-0000-0000-0000000000c1";
await db.exec(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@example.test'), ('${CLIENT}', 'cliente@example.test');
               insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin');`);
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const P = (n) => `00000000-0000-0000-0000-00000000010${n}`;
const promo = (n, status, s, e, extra = "") => `insert into public.promotions (id, title, kind, status, starts_on, ends_on${extra ? ", deleted_at" : ""}) values ('${P(n)}', 'Promo ${n}', 'announcement', '${status}', ${s ? `'${s}'` : "null"}, ${e ? `'${e}'` : "null"}${extra ? ", now()" : ""})`;
await db.exec([
  promo(1, "published", null, null), promo(2, "draft", null, null), promo(3, "disabled", null, null), promo(4, "published", day(3), null),
  promo(5, "published", day(-9), day(-1)), promo(6, "published", null, null, "x"), promo(7, "published", null, null),
].join(";\n"));

// Réservations existantes (avant la migration) : b1 et b2 ; d'autres sont créées plus loin avec des téléphones distincts.
await as("anon");
const book = async (svc, slot, offset, name, phone) => { await newIp(); return (await A("select public.create_booking($1, $2, $3, $4, $5, '') as r", [svc, day(offset), slot, name, phone]))[0].r; };
const b1 = await book("massage-relaxant", "09:00", 10, "Aminata Koné", "+225 07 07 07 07 07");
const b2 = await book("pedicure", "10:30", 11, "Awa Traoré", "+225 05 05 05 05 05");
await as("");
ok("préparation : deux réservations existent avant la migration", b1.ok === true && b2.ok === true, JSON.stringify([b1, b2]));
const PH1 = "+225 07 07 07 07 07", PH2 = "+225 05 05 05 05 05";

const hashOf = async (t, order) => (await A(`select md5(coalesce(json_agg(x order by x.${order})::text, '')) h from public.${t} x`))[0].h;
const snapshot = async () => [await hashOf("services", "id"), await hashOf("products", "id"), await hashOf("bookings", "id"), await hashOf("promotions", "id")].join("|");
const fn = async () => (await A("select md5(pg_get_functiondef('public.create_booking(text,date,text,text,text,text)'::regprocedure)) as h"))[0].h;
const colsHash = async () => (await A("select md5(string_agg(table_name||column_name||data_type||is_nullable, '|' order by table_name, ordinal_position)) h from information_schema.columns where table_schema='public' and table_name in ('services','products','bookings')"))[0].h;
const before = await snapshot(), fnBefore = await fn(), colsBefore = await colsHash();

// --- 1. La migration ne modifie rien d'existant ---------------------------------------------------
await db.exec(read(TARGET));
ok("services, products, bookings et promotions : contenu strictement identique", (await snapshot()) === before);
ok("create_booking : définition strictement identique", (await fn()) === fnBefore);
ok("colonnes de services, products et bookings inchangées", (await colsHash()) === colsBefore);
ok("aucune donnée de suivi ni d'attribution à la création", (await count("promotion_events")) === 0 && (await count("promotion_bookings")) === 0);
const sqlNoComments = read(TARGET).replace(/--.*$/gm, "");
ok("le fichier de migration ne contient ni DROP TABLE, ni UPDATE de données, ni INSERT de données hors de ses fonctions", !/\bdrop\s+table\b/i.test(sqlNoComments)
  && !/\bupdate\s+public\.(?!promotion)/i.test(sqlNoComments) && !/\binsert\s+into\s+public\.(?!promotion_events|promotion_bookings)/i.test(sqlNoComments.replace(/create function[\s\S]*?\$\$;/gi, "")));
ok("la purge ne touche jamais aux attributions", !/delete\s+from\s+public\.promotion_bookings/i.test(sqlNoComments));

// --- 2. Type « pourcentage » avec prix de référence annoncé ---------------------------------------
const ins = (cols, vals) => `insert into public.promotions (${cols}) values (${vals})`;
ok("pourcentage avec prix de référence annoncé : accepté", (await fails(ins("title, kind, percent_off, original_price_fcfa", "'R1', 'percent', 15, 20000"))) === false);
ok("pourcentage sans prix de référence : toujours accepté", (await fails(ins("title, kind, percent_off", "'R2', 'percent', 15"))) === false);
ok("pourcentage avec prix PROMOTIONNEL : refusé (aucun prix calculé pour ce type)", (await fails(ins("title, kind, percent_off, original_price_fcfa, promo_price_fcfa", "'R3', 'percent', 15, 20000, 17000"))) === true);
ok("pourcentage sans pourcentage : refusé", (await fails(ins("title, kind, original_price_fcfa", "'R4', 'percent', 20000"))) === true);
ok("annonce avec prix : toujours refusée", (await fails(ins("title, kind, original_price_fcfa", "'R5', 'announcement', 20000"))) === true);
ok("type prix : règles inchangées (prix promotionnel inférieur au prix initial)", (await fails(ins("title, kind, original_price_fcfa, promo_price_fcfa", "'R6', 'price', 100, 200"))) === true
  && (await fails(ins("title, kind, original_price_fcfa, promo_price_fcfa", "'R7', 'price', 200, 100"))) === false);
await db.exec("delete from public.promotions where title like 'R_'");

// --- 3. Événements : aucun accès direct -----------------------------------------------------------
for (const [role, sub] of [["anon", ""], ["authenticated", CLIENT], ["authenticated", ADMIN]]) {
  await as(role, sub);
  const who = role + (sub === ADMIN ? " (administrateur)" : "");
  ok(`${who} : aucune lecture, écriture, modification ni suppression directe de promotion_events`,
    (await fails("select * from public.promotion_events")) === true
    && (await fails(`insert into public.promotion_events (promotion_id, event, session_key) values ('${P(1)}', 'click', '${hex("a")}')`)) === true
    && (await fails("update public.promotion_events set event = 'click'")) === true && (await fails("delete from public.promotion_events")) === true);
}
await as("");
ok("RLS activée sur promotion_events, sans aucune politique", (await A("select relrowsecurity r from pg_class where relname='promotion_events'"))[0].r === true
  && (await A("select count(*)::int n from pg_policies where tablename='promotion_events'"))[0].n === 0);
ok("aucune donnée personnelle : colonnes id, promotion, événement, session, jour, dates — rien d'autre",
  (await A("select string_agg(column_name, ',' order by ordinal_position) c from information_schema.columns where table_name='promotion_events'"))[0].c === "id,promotion_id,event,session_key,day,created_at,last_at");

// --- 4. track_promotion_event ---------------------------------------------------------------------
await as("anon");
let r = await track(P(1), "impression", hex("a"));
ok("impression d'une promotion active : comptée", r.ok === true && r.counted === true, JSON.stringify(r));
r = await track(P(1), "impression", hex("a"));
ok("même promotion, même événement, même session, même jour : PAS recomptée (idempotent)", r.ok === true && r.counted === false, JSON.stringify(r));
await as("");
ok("... une seule ligne en base", (await count("promotion_events", `promotion_id='${P(1)}' and event='impression'`)) === 1);
await as("anon");
ok("autre session : comptée", (await track(P(1), "impression", hex("b"))).counted === true);
ok("autre événement (click) : compté", (await track(P(1), "click", hex("a"))).counted === true);
ok("autre événement (booking_started) : compté", (await track(P(1), "booking_started", hex("a"))).counted === true);
ok("click répété : pas recompté", (await track(P(1), "click", hex("a"))).counted === false);
await as("");
await db.exec(`insert into public.promotion_events (promotion_id, event, session_key, day) values ('${P(1)}', 'impression', '${hex("c")}', ((now() at time zone 'utc')::date) - 1)`);
await as("anon");
ok("même session un autre jour : comptée de nouveau (règle « une fois par jour »)", (await track(P(1), "impression", hex("c"))).counted === true);
const notEligible = async (n) => { const x = await track(P(n), "impression", hex("d")); return x.ok === false && x.code === "not_eligible"; };
ok("brouillon, désactivée, programmée, expirée, supprimée : refusées (not_eligible)", (await notEligible(2)) && (await notEligible(3)) && (await notEligible(4)) && (await notEligible(5)) && (await notEligible(6)));
ok("promotion inconnue : refusée", (await track("00000000-0000-0000-0000-0000000fffff", "click", hex("d"))).code === "not_eligible");
for (const [why, id, ev, s] of [["événement inconnu", P(1), "purchase", hex("e")], ["événement vide", P(1), "", hex("e")], ["événement nul", P(1), null, hex("e")], ["session trop courte", P(1), "click", "abc"],
  ["session en majuscules", P(1), "click", "A".repeat(32)], ["session non hexadécimale", P(1), "click", "g".repeat(32)], ["session avec injection", P(1), "click", "a'); drop table x;--" + "a".repeat(14)],
  ["session trop longue", P(1), "click", hex("a") + "a"], ["session nulle", P(1), "click", null], ["promotion nulle", null, "click", hex("e")]]) {
  r = await track(id, ev, s);
  ok(`paramètre invalide refusé : ${why}`, r.ok === false && r.code === "invalid_input", JSON.stringify(r));
}
await as("");
ok("aucun événement n'a été enregistré pour les cas refusés", (await count("promotion_events", `session_key in ('${hex("d")}', '${hex("e")}')`)) === 0);
await as("authenticated", CLIENT);
ok("un client connecté (non administrateur) est compté comme un visiteur", (await track(P(1), "impression", hex("f"))).counted === true);
await as("authenticated", ADMIN);
r = await track(P(1), "impression", hex("9"));
ok("une session d'administrateur connecté à la base n'est PAS comptée", r.ok === true && r.counted === false, JSON.stringify(r));
await as("");
ok("... aucune ligne pour cette session", (await count("promotion_events", `session_key='${hex("9")}'`)) === 0);

// last_at : horodatage du dernier événement reçu, sans casser la déduplication
await as("anon");
r = await track(P(7), "click", hex("6"));
await as("");
const row0 = (await A(`select created_at, last_at from public.promotion_events where session_key = '${hex("6")}' and event = 'click'`))[0];
ok("premier clic : counted = true, last_at = date de création", r.counted === true && String(row0.last_at) === String(row0.created_at));
await new Promise((res) => setTimeout(res, 30));
await as("anon");
r = await track(P(7), "click", hex("6"));
await as("");
const row1 = (await A(`select created_at, last_at from public.promotion_events where session_key = '${hex("6")}' and event = 'click'`))[0];
ok("clic renvoyé le même jour : pas recompté (counted = false), last_at mis à jour, une seule ligne, created_at inchangé",
  r.counted === false && row1.last_at > row0.last_at && String(row1.created_at) === String(row0.created_at) && (await count("promotion_events", `session_key = '${hex("6")}' and event = 'click'`)) === 1, JSON.stringify([row0, row1]));

// Cohérence UTC : le jour de comptage est le jour UTC, quel que soit le fuseau de la session SQL
await db.exec("set time zone 'Pacific/Auckland'");
await as("anon");
await track(P(7), "impression", hex("5"));
await as("");
const utc = (await A(`select day::text d, ((now() at time zone 'utc')::date)::text u from public.promotion_events where session_key = '${hex("5")}'`))[0];
ok("le jour de comptage est le jour UTC même avec un fuseau serveur très en avance (Pacific/Auckland)", utc.d === utc.u, JSON.stringify(utc));
await db.exec(`insert into public.promotion_events (promotion_id, event, session_key) values ('${P(7)}', 'booking_started', '${hex("4")}')`);
ok("valeur par défaut de day : jour UTC", (await A(`select (day = ((now() at time zone 'utc')::date)) ok from public.promotion_events where session_key = '${hex("4")}'`))[0].ok === true);
await db.exec("reset time zone");

// Limites anti-abus
await as("anon");
let limited = null;
for (let i = 0; i < 205 && limited === null; i++) { const x = await track(P(1), "click", hex("7"), `ip-rate-${i}`); if (x.code === "rate_limited") limited = i; }
ok("limitation de débit par session (200 par heure), même en changeant d'adresse IP", limited !== null && limited >= 150, String(limited));

// Rotation des identifiants de session depuis une même IP : plafond quotidien par promotion et par IP
let cap = null;
for (let i = 0; i < 320 && cap === null; i++) { const x = await track(P(1), "impression", sess(1000 + i), "ip-cap"); if (x.code === "rate_limited") cap = i; }
ok("rotation des sessions depuis une même IP : plafond quotidien de 300 événements par promotion", cap === 300, String(cap));
ok("... une autre promotion n'est pas bloquée pour cette IP", (await track(P(7), "impression", sess(9000), "ip-cap")).ok === true);
ok("... une autre IP n'est pas bloquée pour cette promotion", (await track(P(1), "impression", sess(9001), "ip-autre")).ok === true);
await as("");
ok("... les événements refusés ne sont pas enregistrés (300 lignes pour cette IP)", (await count("promotion_events", `session_key between '${sess(1000)}' and '${sess(1400)}' and event = 'impression'`)) === 300);

// Purge des anciens événements (les attributions ne sont jamais supprimées)
await db.exec(`insert into public.promotion_events (promotion_id, event, session_key, day) values
  ('${P(1)}', 'click', '${sess(2001)}', ((now() at time zone 'utc')::date) - 500), ('${P(1)}', 'impression', '${sess(2002)}', ((now() at time zone 'utc')::date) - 401),
  ('${P(1)}', 'impression', '${sess(2003)}', ((now() at time zone 'utc')::date) - 399)`);
const oldBefore = await count("promotion_events", `session_key in ('${sess(2001)}', '${sess(2002)}', '${sess(2003)}')`);
const purged = (await A("select private.purge_promotion_events(interval '400 days') n"))[0].n;
ok("purge : supprime les événements de plus de 400 jours, conserve les autres", oldBefore === 3 && purged >= 2 && (await count("promotion_events", `session_key = '${sess(2003)}'`)) === 1 && (await count("promotion_events", `session_key in ('${sess(2001)}', '${sess(2002)}')`)) === 0, `${oldBefore}/${purged}`);
ok("purge : réservée au propriétaire (aucun rôle applicatif ne peut l'exécuter)", (await A("select has_function_privilege('anon','private.purge_promotion_events(interval)','execute') a, has_function_privilege('authenticated','private.purge_promotion_events(interval)','execute') b"))[0].a === false);

// --- 5. Attribution des réservations --------------------------------------------------------------
const bookingsBefore = await hashOf("bookings", "id");
const S1 = hex("1"), S2 = hex("2"), S3 = hex("3");
await as("anon");
r = await attribute(b1.ref, PH1, P(1), S1);
ok("aucun clic de cette session : refusée (not_eligible), générique", r.ok === false && r.code === "not_eligible", JSON.stringify(r));
await track(P(1), "booking_started", S1);
await track(P(1), "impression", S1);
r = await attribute(b1.ref, PH1, P(1), S1);
ok("booking_started et impression NE SUFFISENT PAS (ouvrir une adresse ?promo= ne prouve pas un clic)", r.ok === false && r.code === "not_eligible", JSON.stringify(r));
await track(P(1), "click", S2);
r = await attribute(b1.ref, PH1, P(1), S1);
ok("clic d'une AUTRE session : refusée", r.ok === false && r.code === "not_eligible", JSON.stringify(r));
await track(P(7), "click", S1);
r = await attribute(b1.ref, PH1, P(1), S1);
ok("clic de la bonne session mais sur une AUTRE promotion : refusée", r.ok === false && r.code === "not_eligible", JSON.stringify(r));
ok("... mêmes réponses génériques que pour une promotion inconnue", JSON.stringify(await attribute(b1.ref, PH1, "00000000-0000-0000-0000-0000000fffff", S1)) === JSON.stringify(r));
await as("");
ok("... aucune attribution créée pour ces refus", (await count("promotion_bookings")) === 0);
await as("anon");
await track(P(1), "click", S1);
r = await attribute(b1.ref, PH1, P(1), S1);
ok("clic de la même session sur la même promotion, juste avant la réservation : attribuée", r.ok === true && r.attributed === true, JSON.stringify(r));
ok("la réponse ne révèle rien sur la réservation (uniquement ok et attributed)", Object.keys(r).sort().join() === "attributed,ok", JSON.stringify(r));
r = await attribute(b1.ref, PH1, P(1), S1);
ok("deuxième appel identique : pas de double attribution", r.ok === true && r.attributed === false, JSON.stringify(r));
r = await attribute(b1.ref, PH1, P(7), S1);
ok("une réservation déjà attribuée n'est pas rattachée à une autre promotion (même avec un clic sur celle-ci)", r.ok === true && r.attributed === false, JSON.stringify(r));
await as("");
ok("une seule attribution, vers la première promotion", (await count("promotion_bookings")) === 1 && (await count("promotion_bookings", `promotion_id='${P(1)}'`)) === 1);
ok("la réservation n'a pas été modifiée (montant, prestation, statut…)", (await hashOf("bookings", "id")) === bookingsBefore);

// Paramètres invalides et réponses génériques
await as("anon");
for (const [why, args] of [["session nulle", [b2.ref, PH2, P(1), null]], ["session malformée", [b2.ref, PH2, P(1), "abc"]], ["session en majuscules", [b2.ref, PH2, P(1), "A".repeat(32)]], ["promotion nulle", [b2.ref, PH2, null, S1]]]) {
  const x = await attribute(...args);
  ok(`paramètre invalide refusé : ${why}`, x.ok === false && x.code === "invalid_input", JSON.stringify(x));
}
ok("mauvais téléphone : introuvable (même réponse que pour une référence inconnue)", JSON.stringify(await attribute(b2.ref, "+225 01 01 01 01 01", P(1), S1)) === JSON.stringify(await attribute("DLD-0000000000", PH2, P(1), S1)));
ok("téléphone vide, trop court ou référence nulle : introuvable", (await attribute(b2.ref, "", P(1), S1)).code === "not_found" && (await attribute(b2.ref, "123", P(1), S1)).code === "not_found" && (await attribute(null, PH2, P(1), S1)).code === "not_found");
ok("le téléphone d'un autre client ne permet pas d'attribuer cette réservation", (await attribute(b2.ref, PH1, P(7), S1)).code === "not_found");
await as("");

// Fenêtre de 24 heures entre le clic et la création de la réservation (b2 : promotion 7, session S3)
await as("anon");
await track(P(7), "click", S3);
await as("");
const setClick = (session, promo, interval) => db.exec(`update public.promotion_events e set last_at = (select b.created_at from public.bookings b where b.ref = '${b2.ref}') + interval '${interval}' where e.session_key = '${session}' and e.promotion_id = '${promo}' and e.event = 'click'`);
await setClick(S3, P(7), "-25 hours");
await as("anon");
r = await attribute(b2.ref, PH2, P(7), S3);
ok("clic datant de plus de 24 h avant la réservation : refusée", r.ok === false && r.code === "not_eligible", JSON.stringify(r));
await as("");
await setClick(S3, P(7), "+10 minutes");
await as("anon");
r = await attribute(b2.ref, PH2, P(7), S3);
ok("clic enregistré plus de 5 minutes APRÈS la réservation : refusée (il ne peut pas en être l'origine)", r.ok === false && r.code === "not_eligible", JSON.stringify(r));
await as("");
await setClick(S3, P(7), "-23 hours");
await as("anon");
r = await attribute(b2.ref, PH2, P(7), S3);
ok("clic 23 h avant la réservation : attribuée (dans la fenêtre de 24 h)", r.ok === true && r.attributed === true, JSON.stringify(r));
await as("");

// Autres réservations : promotion expirée / désactivée, 30 minutes, concurrence
await as("anon");
const b3 = await book("massage-dos", "12:00", 12, "Fatou Diallo", "+225 01 02 03 04 05");
const b4 = await book("manucure", "14:00", 13, "Kofi Mensah", "+225 01 02 03 04 06");
const b5 = await book("shampoing-soin", "15:30", 14, "Mariam Sy", "+225 01 02 03 04 07");
const b6 = await book("nattes", "09:00", 15, "Yao Kouassi", "+225 01 02 03 04 08");
await as("");
const manualClick = (promo, session, ref, interval) => db.exec(`insert into public.promotion_events (promotion_id, event, session_key, last_at) select '${promo}', 'click', '${session}', b.created_at + interval '${interval}' from public.bookings b where b.ref = '${ref}'`);
await manualClick(P(5), hex("a"), b3.ref, "-2 hours");   // promotion expirée depuis : le clic date d'avant
await manualClick(P(3), hex("b"), b4.ref, "-1 hour");    // promotion désactivée depuis
await as("anon");
ok("promotion expirée mais publiée un jour (clic antérieur à la fin) : attribuée", (await attribute(b3.ref, "+225 01 02 03 04 05", P(5), hex("a"))).attributed === true);
ok("promotion désactivée mais déjà publiée (clic antérieur) : attribuée", (await attribute(b4.ref, "+225 01 02 03 04 06", P(3), hex("b"))).attributed === true);
await as("");
await manualClick(P(2), hex("c"), b5.ref, "-1 hour");
await manualClick(P(4), hex("d"), b5.ref, "-1 hour");
await manualClick(P(6), hex("e"), b5.ref, "-1 hour");
await as("anon");
ok("brouillon, programmée (pas commencée) ou supprimée : jamais attribuées, même avec un clic enregistré", (await attribute(b5.ref, "+225 01 02 03 04 07", P(2), hex("c"))).code === "not_eligible"
  && (await attribute(b5.ref, "+225 01 02 03 04 07", P(4), hex("d"))).code === "not_eligible" && (await attribute(b5.ref, "+225 01 02 03 04 07", P(6), hex("e"))).code === "not_eligible");
await as("");

// Deux attributions simultanées pour une même réservation (sérialisées par PGlite ; l'unicité repose sur la clé primaire)
await manualClick(P(1), hex("f"), b6.ref, "-1 hour");
await manualClick(P(7), hex("f"), b6.ref, "-1 hour");
await as("anon");
const results = await Promise.all([attribute(b6.ref, "+225 01 02 03 04 08", P(1), hex("f")), attribute(b6.ref, "+225 01 02 03 04 08", P(7), hex("f")), attribute(b6.ref, "+225 01 02 03 04 08", P(1), hex("f"))]);
await as("");
ok("trois attributions simultanées pour la même réservation : une seule réussit, une seule ligne en base",
  results.filter((x) => x.attributed === true).length === 1 && results.every((x) => x.ok === true) && (await count("promotion_bookings", `booking_id = (select id from public.bookings where ref = '${b6.ref}')`)) === 1, JSON.stringify(results));

// 30 minutes entre la création de la réservation et l'appel d'attribution
await as("anon");
const b7 = await book("pedicure", "17:00", 16, "Adjoua Kone", "+225 01 02 03 04 09");
await as("");
await manualClick(P(7), hex("a"), b7.ref, "-1 hour");
await db.exec(`update public.bookings set created_at = now() - interval '2 hours' where ref = '${b7.ref}'`);
await db.exec(`update public.promotion_events set last_at = now() - interval '3 hours' where session_key = '${hex("a")}' and promotion_id = '${P(7)}'`);
await as("anon");
r = await attribute(b7.ref, "+225 01 02 03 04 09", P(7), hex("a"));
ok("réservation créée il y a plus de 30 minutes : trop tard, même avec un clic valide", r.ok === false && r.code === "too_late", JSON.stringify(r));
await as("");
await db.exec(`update public.bookings set created_at = now() - interval '29 minutes' where ref = '${b7.ref}'`);
await db.exec(`update public.promotion_events set last_at = now() - interval '40 minutes' where session_key = '${hex("a")}' and promotion_id = '${P(7)}'`);
await as("anon");
ok("réservation créée il y a 29 minutes : encore acceptée", (await attribute(b7.ref, "+225 01 02 03 04 09", P(7), hex("a"))).attributed === true);

// Limitation par téléphone, toutes IP confondues (convention de get_booking : 10 par téléphone et IP, 100 par téléphone)
const variants = ["+225 03 03 03 03 03", "00225 03-03-03-03-03", "03 03 03 03 03", "225 0303030303"];
let phoneLimited = null;
for (let i = 0; i < 105 && phoneLimited === null; i++) { const x = await attribute("DLD-0000000000", variants[i % variants.length], P(1), S1, `ip-phone-${i}`); if (x.code === "rate_limited") phoneLimited = i; }
ok("plafond global par téléphone (100 par heure) avec une IP différente à chaque essai et plusieurs écritures du même numéro", phoneLimited === 100, String(phoneLimited));
ok("... un autre numéro n'est pas affecté", (await attribute("DLD-0000000000", "+225 04 04 04 04 04", P(1), S1, "ip-phone-autre")).code === "not_found");
let invalidLimited = false;
for (let i = 0; i < 40; i++) { const x = await attribute("DLD-0000000000", ["123", "", "abc", "12345678901234567890"][i % 4], P(1), S1, `ip-bad-${i}`); if (x.code !== "not_found") invalidLimited = true; }
ok("formats de téléphone invalides : toujours la réponse générique not_found, sans consommer le plafond d'un numéro", invalidLimited === false);
let perIp = null;
for (let i = 0; i < 40 && perIp === null; i++) { const x = await attribute("DLD-0000000000", "+225 09 09 09 09 09", P(1), S1, "ip-fixed"); if (x.code === "rate_limited") perIp = i; }
ok("plafond par téléphone et par IP (10 par heure)", perIp !== null && perIp <= 12, String(perIp));
let ipOnly = null;
for (let i = 0; i < 40 && ipOnly === null; i++) { const x = await attribute("DLD-0000000000", `+225 0${(i % 8) + 1} 00 00 00 ${String(10 + i).slice(-2)}`, P(1), S1, "ip-many"); if (x.code === "rate_limited") ipOnly = i; }
ok("plafond par IP (30 tentatives par heure) même avec des numéros différents", ipOnly !== null && ipOnly <= 31, String(ipOnly));
await as("");

// --- 6. Lecture des attributions ------------------------------------------------------------------
await as("anon");
ok("anon ne lit pas les attributions", (await fails("select * from public.promotion_bookings")) === true);
await as("authenticated", CLIENT);
ok("un client connecté ne voit aucune attribution (RLS)", (await count("promotion_bookings")) === 0);
ok("... et ne peut rien écrire", (await fails(`insert into public.promotion_bookings (booking_id, promotion_id) select id, '${P(1)}' from public.bookings limit 1`)) === true
  && (await fails("update public.promotion_bookings set promotion_id = promotion_id")) === true && (await fails("delete from public.promotion_bookings")) === true);
await as("authenticated", ADMIN);
const attributedTotal = (await A("select count(*)::int n from public.promotion_bookings"))[0].n;
ok("l'administrateur lit les attributions", attributedTotal >= 5, String(attributedTotal));
ok("... mais n'écrit pas directement non plus", (await fails(`insert into public.promotion_bookings (booking_id, promotion_id) select id, '${P(1)}' from public.bookings limit 1`)) === true
  && (await fails("delete from public.promotion_bookings")) === true && (await fails("update public.promotion_bookings set promotion_id = promotion_id")) === true);
await as("");

// --- 7. Statistiques ------------------------------------------------------------------------------
await db.exec(`update public.bookings set status = 'cancelled' where ref = '${b2.ref}'`);
await as("anon");
ok("anon ne peut pas appeler admin_promotion_stats", (await fails("select public.admin_promotion_stats()")) === true);
await as("authenticated", CLIENT);
ok("un client connecté reçoit une erreur (42501)", (await fails("select public.admin_promotion_stats()", [], /réservé aux administrateurs|42501/)) === true);
await as("authenticated", ADMIN);
const stats = (await A("select public.admin_promotion_stats() as s"))[0].s;
await as("");
const expected = async (p) => ({
  impressions: await count("promotion_events", `promotion_id='${p}' and event='impression'`), clicks: await count("promotion_events", `promotion_id='${p}' and event='click'`),
  booking_started: await count("promotion_events", `promotion_id='${p}' and event='booking_started'`), bookings_created: await count("promotion_bookings", `promotion_id='${p}'`),
  bookings_confirmed: (await A(`select count(*)::int n from public.promotion_bookings a join public.bookings b on b.id = a.booking_id where a.promotion_id='${p}' and b.status='confirmed'`))[0].n,
  bookings_cancelled: (await A(`select count(*)::int n from public.promotion_bookings a join public.bookings b on b.id = a.booking_id where a.promotion_id='${p}' and b.status='cancelled'`))[0].n,
});
for (const n of [1, 7, 3, 5]) {
  const got = stats.find((x) => x.promotion_id === P(n));
  const exp = await expected(P(n));
  ok(`statistiques de la promotion ${n} : identiques aux comptages directs de la base`, got && Object.entries(exp).every(([k, v]) => got[k] === v), JSON.stringify([got, exp]));
}
const s7 = stats.find((x) => x.promotion_id === P(7));
ok("la réservation annulée est comptée « créée » et « annulée », pas « confirmée »", s7.bookings_cancelled === 1 && s7.bookings_confirmed === s7.bookings_created - 1, JSON.stringify(s7));
ok("les promotions supprimées sont exclues des statistiques", !stats.some((x) => x.promotion_id === P(6)));

// --- 8. Réservations sans promotion, montants inchangés -------------------------------------------
await as("anon");
const b8 = await book("massage-dos", "10:30", 17, "Fatou Diallo", "+225 01 02 03 04 15");
await as("");
const attributedAfter = await count("promotion_bookings");
ok("une réservation sans promotion fonctionne et n'est pas attribuée", b8.ok === true && attributedAfter === attributedTotal, `${attributedAfter}/${attributedTotal}`);
ok("les montants des réservations attribuées sont ceux des prestations", (await A("select price_fcfa from public.bookings where ref = $1", [b1.ref]))[0].price_fcfa === 20000
  && (await A("select price_fcfa from public.bookings where ref = $1", [b8.ref]))[0].price_fcfa === 10000);
ok("services et products toujours inchangés après tout le suivi", (await snapshot()).split("|").slice(0, 2).join("|") === before.split("|").slice(0, 2).join("|"));
ok("create_booking toujours inchangée", (await fn()) === fnBefore);

// --- 9. Droits des fonctions ----------------------------------------------------------------------
const exec = async (role, f) => (await A(`select has_function_privilege($1, $2::regprocedure, 'execute') a`, [role, f]))[0].a;
const ATTR = "public.attribute_booking_to_promotion(text,text,uuid,text)";
ok("track_promotion_event et attribute_booking_to_promotion : exécutables par anon et authenticated", await exec("anon", "public.track_promotion_event(uuid,text,text)") && await exec("authenticated", "public.track_promotion_event(uuid,text,text)")
  && await exec("anon", ATTR) && await exec("authenticated", ATTR));
ok("l'ancienne signature à trois paramètres n'existe plus", (await A("select count(*)::int n from pg_proc where proname = 'attribute_booking_to_promotion' and pronargs = 3"))[0].n === 0);
ok("admin_promotion_stats : authenticated seulement (ni anon, ni PUBLIC)", !(await exec("anon", "public.admin_promotion_stats()")) && await exec("authenticated", "public.admin_promotion_stats()"));
const defs = await A(`select proname, prosecdef, proconfig::text c from pg_proc where proname in ('track_promotion_event','attribute_booking_to_promotion','admin_promotion_stats')`);
ok("les trois fonctions sont SECURITY DEFINER avec search_path vide", defs.length === 3 && defs.every((d) => d.prosecdef && /search_path/.test(d.c)), JSON.stringify(defs));
const adminDef = (await A("select pg_get_functiondef('public.admin_promotion_stats()'::regprocedure) d"))[0].d;
ok("admin_promotion_stats vérifie le rôle admin avant tout calcul", adminDef.indexOf("is_admin") > -1 && adminDef.indexOf("is_admin") < adminDef.indexOf("jsonb_agg"));
const attrDef = (await A(`select pg_get_functiondef('${ATTR}'::regprocedure) d`))[0].d;
ok("attribute_booking_to_promotion ne modifie jamais bookings", !/update\s+public\.bookings|insert\s+into\s+public\.bookings|delete\s+from\s+public\.bookings/i.test(attrDef));
ok("create_booking n'est pas appelée par les fonctions de suivi", !/create_booking/.test(attrDef) && !/create_booking/.test((await A("select pg_get_functiondef('public.track_promotion_event(uuid,text,text)'::regprocedure) d"))[0].d));
ok("l'attribution exige un clic (jamais booking_started ni impression)", /e\.event = 'click'/.test(attrDef) && !/booking_started|impression/.test(attrDef.replace(/--.*$/gm, "")));
const privs = async (t, role) => (await A("select privilege_type p from information_schema.table_privileges where table_schema='public' and table_name=$1 and grantee=$2 order by 1", [t, role])).map((x) => x.p).join(",");
ok("promotion_events : aucun droit pour anon ni authenticated", (await privs("promotion_events", "anon")) === "" && (await privs("promotion_events", "authenticated")) === "");
ok("promotion_bookings : SELECT seulement pour authenticated, rien pour anon", (await privs("promotion_bookings", "authenticated")) === "SELECT" && (await privs("promotion_bookings", "anon")) === "");

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
