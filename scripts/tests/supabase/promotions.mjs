// Promotions : table, contraintes par type, période, lien prestation/produit, suppression logique, RLS (lecture publique limitée aux
// promotions publiées dans leur période, écriture réservée aux administrateurs), droits, et NON-MODIFICATION de services, products,
// bookings et create_booking par supabase/migrations/20261029000000_promotions.sql.
// Paramètre facultatif : SUPABASE_DIR (dossier contenant migrations/ et seed.sql).
// Base PostgreSQL locale en mémoire (PGlite) : aucune connexion au projet Supabase distant.
// Exécution : npm run test:sql:promotions
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = process.env.SUPABASE_DIR ?? fileURLToPath(new URL("../../../supabase", import.meta.url));
const TARGET = "20261029000000_promotions.sql";
const files = readdirSync(`${root}/migrations`).filter((f) => f.endsWith(".sql")).sort();
const read = (f) => readFileSync(`${root}/migrations/${f}`, "utf8");

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + extra}`); };
const A = async (sql, p = []) => (await db.query(sql, p)).rows;
const as = async (role, sub = "") => { await db.exec("reset role"); if (role) await db.exec(`set role ${role}`); await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]); };
const fails = async (sql, p = [], re = /permission denied|row-level security|violates (check|unique|foreign key)|duplicate key/i) => {
  try { await db.query(sql, p); return false; } catch (e) { return re.test(e.message) ? true : "autre erreur: " + e.message; }
};

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
               insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin');
               insert into public.products (id, sku, name, category, sale_price, stock_qty) values ('creme-test', 'T-CREME', 'Crème test', 'Hydratation', 9000, 5);`);
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const bk = (await A("select public.create_booking('massage-relaxant', $1, '09:00', 'Aminata Koné', '+225 07 07 07 07 07', '') as r", [day(10)]))[0].r;
ok("préparation : une réservation existe avant la migration", bk.ok === true, JSON.stringify(bk));

const hash = async () => (await A(`select md5(
  coalesce((select json_agg(s order by s.id) from public.services s)::text, '') ||
  coalesce((select json_agg(p order by p.id) from public.products p)::text, '') ||
  coalesce((select json_agg(b order by b.id) from public.bookings b)::text, '') ||
  coalesce((select json_agg(t order by t.slot) from public.time_slots t)::text, '') ||
  coalesce((select json_agg(c order by c.id) from public.service_categories c)::text, '')) as h`))[0].h;
const bookingFn = async () => (await A("select md5(pg_get_functiondef('public.create_booking(text,date,text,text,text,text)'::regprocedure)) as h"))[0].h;
const columns = async (t) => (await A("select column_name || ':' || data_type as c from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position", [t])).map((r) => r.c).join(",");
const before = await hash(), fnBefore = await bookingFn();
const colsBefore = { s: await columns("services"), p: await columns("products"), b: await columns("bookings") };
const policiesBefore = (await A("select md5(coalesce(string_agg(tablename||policyname||cmd||coalesce(qual,'')||coalesce(with_check,''), '|' order by tablename, policyname), '')) h from pg_policies where tablename in ('services','products','bookings')"))[0].h;

// --- 1. La migration ne modifie rien d'existant ---------------------------------------------------
await db.exec(read(TARGET));
ok("services, products, bookings, time_slots et catégories : contenu strictement identique", (await hash()) === before);
ok("create_booking : définition strictement identique", (await bookingFn()) === fnBefore);
ok("colonnes de services, products et bookings inchangées", (await columns("services")) === colsBefore.s && (await columns("products")) === colsBefore.p && (await columns("bookings")) === colsBefore.b);
ok("politiques RLS de services, products et bookings inchangées", (await A("select md5(coalesce(string_agg(tablename||policyname||cmd||coalesce(qual,'')||coalesce(with_check,''), '|' order by tablename, policyname), '')) h from pg_policies where tablename in ('services','products','bookings')"))[0].h === policiesBefore);
ok("la table est vide à la création (aucune promotion de démonstration)", (await A("select count(*)::int n from public.promotions"))[0].n === 0);
const sql = read(TARGET).replace(/--.*$/gm, "");
ok("le fichier de migration ne contient ni DROP, ni DELETE, ni UPDATE, ni ALTER sur une table existante", !/\b(drop|truncate)\b|(?<!on )\bdelete\b/i.test(sql) && !/\bupdate\s+public\./i.test(sql) && !/\balter\s+table\s+public\.(services|products|bookings)/i.test(sql));

// --- 2. Contraintes (propriétaire de la base) -----------------------------------------------------
const ins = (cols, vals) => `insert into public.promotions (${cols}) values (${vals})`;
const okIns = async (cols, vals) => (await fails(ins(cols, vals))) === false;
ok("annonce simple valide", await okIns("title, kind", "'Annonce', 'announcement'"));
ok("type prix valide (prix initial + promotionnel)", await okIns("title, kind, original_price_fcfa, promo_price_fcfa", "'Prix', 'price', 20000, 15000"));
ok("type pourcentage valide", await okIns("title, kind, percent_off", "'Pourcentage', 'percent', 20"));
ok("type prix : prix promotionnel nul accepté (offert)", await okIns("title, kind, original_price_fcfa, promo_price_fcfa", "'Gratuit', 'price', 5000, 0"));
for (const [why, cols, vals] of [
  ["type prix sans prix promotionnel", "title, kind, original_price_fcfa", "'X1', 'price', 20000"],
  ["type prix sans prix initial", "title, kind, promo_price_fcfa", "'X2', 'price', 100"],
  ["prix promotionnel égal au prix initial", "title, kind, original_price_fcfa, promo_price_fcfa", "'X3', 'price', 1000, 1000"],
  ["prix promotionnel supérieur au prix initial", "title, kind, original_price_fcfa, promo_price_fcfa", "'X4', 'price', 1000, 2000"],
  ["prix négatif", "title, kind, original_price_fcfa, promo_price_fcfa", "'X5', 'price', 1000, -1"],
  ["prix initial à zéro", "title, kind, original_price_fcfa, promo_price_fcfa", "'X6', 'price', 0, 0"],
  ["type prix avec pourcentage", "title, kind, original_price_fcfa, promo_price_fcfa, percent_off", "'X7', 'price', 1000, 500, 50"],
  ["type pourcentage sans pourcentage", "title, kind", "'X8', 'percent'"],
  ["pourcentage 0", "title, kind, percent_off", "'X9', 'percent', 0"],
  ["pourcentage 100", "title, kind, percent_off", "'X10', 'percent', 100"],
  ["type pourcentage avec prix", "title, kind, percent_off, original_price_fcfa, promo_price_fcfa", "'X11', 'percent', 10, 1000, 900"],
  ["annonce avec prix", "title, kind, original_price_fcfa, promo_price_fcfa", "'X12', 'announcement', 1000, 900"],
  ["annonce avec pourcentage", "title, kind, percent_off", "'X13', 'announcement', 10"],
  ["type inconnu", "title, kind", "'X14', 'autre'"],
  ["statut inconnu", "title, kind, status", "'X15', 'announcement', 'publie'"],
  ["titre trop court", "title, kind", "'a', 'announcement'"],
  ["titre trop long", "title, kind", "repeat('x', 121), 'announcement'"],
  ["titre avec caractère de contrôle", "title, kind", "'Sa' || chr(10) || 'ut', 'announcement'"],
  ["description trop longue", "title, kind, description", "'X16', 'announcement', repeat('x', 1001)"],
  ["fin avant le début", "title, kind, starts_on, ends_on", "'X17', 'announcement', '2030-02-01', '2030-01-01'"],
  ["prestation inexistante", "title, kind, service_id", "'X18', 'announcement', 'inconnue'"],
  ["produit inexistant", "title, kind, product_id", "'X19', 'announcement', 'inconnu'"],
  ["prestation ET produit", "title, kind, service_id, product_id", "'X20', 'announcement', 'pedicure', 'creme-test'"],
]) ok(`refusé : ${why}`, (await fails(ins(cols, vals))) === true);
ok("période : début seul, fin seule, aucune, ou début = fin acceptés", await okIns("title, kind, starts_on", "'P1', 'announcement', '2030-01-01'")
  && await okIns("title, kind, ends_on", "'P2', 'announcement', '2030-01-01'") && await okIns("title, kind", "'P3', 'announcement'")
  && await okIns("title, kind, starts_on, ends_on", "'P4', 'announcement', '2030-01-01', '2030-01-01'"));
ok("lien vers une prestation, puis vers un produit : acceptés", await okIns("title, kind, service_id", "'L1', 'announcement', 'pedicure'") && await okIns("title, kind, product_id", "'L2', 'announcement', 'creme-test'"));
await db.exec("delete from public.promotions");

// --- 3. Visibilité publique (RLS) -----------------------------------------------------------------
const mk = (id, title, status, s, e, extra = "") =>
  `insert into public.promotions (id, title, kind, status, starts_on, ends_on${extra ? ", deleted_at" : ""}) values ('${id}', '${title}', 'announcement', '${status}', ${s ? `'${s}'` : "null"}, ${e ? `'${e}'` : "null"}${extra ? ", now()" : ""})`;
await db.exec([
  mk("00000000-0000-0000-0000-000000000001", "Active sans dates", "published", null, null),
  mk("00000000-0000-0000-0000-000000000002", "Active avec dates", "published", day(-3), day(3)),
  mk("00000000-0000-0000-0000-000000000003", "Commence ce jour", "published", day(0), null),
  mk("00000000-0000-0000-0000-000000000004", "Finit ce jour", "published", null, day(0)),
  mk("00000000-0000-0000-0000-000000000005", "Programmee", "published", day(2), day(9)),
  mk("00000000-0000-0000-0000-000000000006", "Expiree", "published", day(-9), day(-1)),
  mk("00000000-0000-0000-0000-000000000007", "Brouillon", "draft", null, null),
  mk("00000000-0000-0000-0000-000000000008", "Desactivee", "disabled", null, null),
  mk("00000000-0000-0000-0000-000000000009", "Supprimee", "published", null, null, "x"),
].join(";\n"));
const titles = async () => (await A("select title from public.promotions order by title")).map((r) => r.title);
const PUBLIC = ["Active avec dates", "Active sans dates", "Commence ce jour", "Finit ce jour"];
await as("anon");
ok("anon : seulement les promotions publiées, dans leur période, non supprimées (bornes incluses)", (await titles()).join() === PUBLIC.join(), (await titles()).join());
await as("authenticated", CLIENT);
ok("client connecté : même vue publique", (await titles()).join() === PUBLIC.join(), (await titles()).join());
await as("authenticated", ADMIN);
ok("administrateur : lit TOUT (brouillon, programmée, expirée, désactivée, supprimée) — l'application publique doit donc filtrer", (await titles()).length === 9);
await as("");

// --- 4. Écriture : administrateurs seulement ------------------------------------------------------
const NEW = "insert into public.promotions (title, kind) values ('Intrus', 'announcement')";
await as("anon");
ok("anon ne peut ni insérer, ni modifier, ni supprimer", (await fails(NEW)) === true && (await fails("update public.promotions set title = 'Pirate'")) === true && (await fails("delete from public.promotions")) === true);
await as("authenticated", CLIENT);
ok("client connecté ne peut pas insérer", (await fails(NEW)) === true);
await db.exec("update public.promotions set title = 'Pirate'");
ok("client connecté : une modification ne touche aucune ligne (RLS)", (await titles()).every((t) => t !== "Pirate"));
ok("client connecté ne peut pas supprimer (droit refusé)", (await fails("delete from public.promotions")) === true);
await as("authenticated", ADMIN);
ok("administrateur : insertion possible", (await fails("insert into public.promotions (title, kind, status) values ('Nouvelle', 'announcement', 'draft')")) === false);
const row0 = (await A("select created_at, updated_at from public.promotions where title = 'Nouvelle'"))[0];
await new Promise((r) => setTimeout(r, 20));
await db.exec("update public.promotions set status = 'published', created_at = '2000-01-01' where title = 'Nouvelle'");
const row1 = (await A("select created_at, updated_at, status from public.promotions where title = 'Nouvelle'"))[0];
ok("administrateur : modification possible ; updated_at tenu par la base, created_at non modifiable", row1.status === "published" && row1.updated_at > row0.updated_at && String(row1.created_at) === String(row0.created_at), JSON.stringify([row0, row1]));
await db.exec("update public.promotions set deleted_at = now() where title = 'Nouvelle'");
ok("administrateur : suppression logique possible", (await A("select count(*)::int n from public.promotions where title = 'Nouvelle' and deleted_at is not null"))[0].n === 1);
ok("administrateur : AUCUN droit DELETE (la suppression est logique)", (await fails("delete from public.promotions")) === true);
ok("administrateur : les contraintes s'appliquent aussi (prix incohérents refusés)", (await fails("insert into public.promotions (title, kind, original_price_fcfa, promo_price_fcfa) values ('Mauvais', 'price', 100, 200)")) === true);
await as("");

// --- 5. Droits et fonctions -----------------------------------------------------------------------
const privs = async (role) => (await A("select privilege_type p from information_schema.table_privileges where table_schema='public' and table_name='promotions' and grantee=$1 order by 1", [role])).map((r) => r.p).join(",");
ok("anon : SELECT seulement", (await privs("anon")) === "SELECT", await privs("anon"));
ok("authenticated : SELECT, INSERT, UPDATE (ni DELETE, ni TRUNCATE, ni REFERENCES, ni TRIGGER)", (await privs("authenticated")) === "INSERT,SELECT,UPDATE", await privs("authenticated"));
ok("RLS activée", (await A("select relrowsecurity r from pg_class where relname = 'promotions'"))[0].r === true);
const pol = await A("select policyname, cmd, roles::text r from pg_policies where tablename = 'promotions' order by 1");
ok("quatre politiques : lecture publique, lecture / insertion / modification administrateur ; aucune de suppression", pol.length === 4 && !pol.some((p) => p.cmd === "DELETE" || p.cmd === "ALL"), JSON.stringify(pol));
ok("la lecture publique est la seule politique ouverte à anon", pol.filter((p) => /anon/.test(p.r)).length === 1);
ok("la fonction de déclencheur n'est exécutable par aucun rôle applicatif", (await A("select has_function_privilege('anon','private.touch_promotion()','execute') a, has_function_privilege('authenticated','private.touch_promotion()','execute') b"))[0].a === false);
ok("aucune nouvelle fonction publique : promotions n'ajoute que le déclencheur interne", (await A("select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like '%promotion%'"))[0].n === 0);

// --- 6. Réservations toujours possibles, prix inchangés -------------------------------------------
await as("anon");
const nb = (await A("select public.create_booking('massage-relaxant', $1, '10:30', 'Awa Traoré', '+225 05 05 05 05 05', '') as r", [day(11)]))[0].r;
ok("une réservation reste possible après la migration, au tarif de la prestation", nb.ok === true, JSON.stringify(nb));
await as("");
ok("le prix de la prestation n'a pas changé", (await A("select price_fcfa from public.services where id = 'massage-relaxant'"))[0].price_fcfa === 20000);
await db.exec(`insert into public.promotions (title, kind, original_price_fcfa, promo_price_fcfa, service_id, status) values ('Massage -50%', 'price', 20000, 10000, 'massage-relaxant', 'published')`);
const nb2 = (await A("select public.create_booking('massage-relaxant', $1, '12:00', 'Awa Traoré', '+225 05 05 05 05 05', '') as r", [day(12)]))[0].r;
const paid = (await A("select price_fcfa from public.bookings where ref = $1", [nb2.ref]))[0]?.price_fcfa;
ok("même avec une promotion publiée sur cette prestation, la réservation est enregistrée au prix de la prestation (promotion informative)", nb2.ok === true && paid === 20000, JSON.stringify([nb2, paid]));

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
