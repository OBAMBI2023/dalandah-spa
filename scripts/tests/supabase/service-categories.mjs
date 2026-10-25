// Catégories de prestations dynamiques : table, amorçage, conversion enum -> texte de services.category, unicité, normalisation, RLS, droits
// et compatibilité des réservations de supabase/migrations/20261028000000_service_categories.sql.
// Paramètre facultatif : SUPABASE_DIR (dossier contenant migrations/ et seed.sql).
// Base PostgreSQL locale en mémoire (PGlite) : aucune connexion au projet Supabase distant.
// Exécution : npm run test:sql:service-categories
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = process.env.SUPABASE_DIR ?? fileURLToPath(new URL("../../../supabase", import.meta.url));
const TARGET = "20261028000000_service_categories.sql";
const files = readdirSync(`${root}/migrations`).filter((f) => f.endsWith(".sql")).sort();
const read = (f) => readFileSync(`${root}/migrations/${f}`, "utf8");

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + extra}`); };
const A = async (sql, p = []) => (await db.query(sql, p)).rows;
const as = async (role, sub = "") => { await db.exec("reset role"); if (role) await db.exec(`set role ${role}`); await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]); };
const fails = async (sql, p = [], re = /permission denied|row-level security|réservé aux administrateurs|violates (check|unique|foreign key)|duplicate key/i) => {
  try { await db.query(sql, p); return false; } catch (e) { return re.test(e.message) ? true : "autre erreur: " + e.message; }
};
const create = async (name) => (await A("select public.admin_create_service_category($1) as r", [name]))[0].r;
const labels = async () => (await A("select label from public.service_categories order by sort_order, id")).map((r) => r.label);
const count = async () => (await A("select count(*)::int n from public.service_categories"))[0].n;
const ch = (...codes) => String.fromCharCode(...codes);

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
// Toutes les migrations SAUF celle-ci : on prépare d'abord un catalogue « existant », puis on applique la migration par-dessus.
await db.exec(files.filter((f) => f < TARGET).map(read).join("\n"));
await db.exec(readFileSync(`${root}/seed.sql`, "utf8"));

const ADMIN = "00000000-0000-0000-0000-0000000000a1", CLIENT = "00000000-0000-0000-0000-0000000000c1";
await db.exec(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@example.test'), ('${CLIENT}', 'cliente@example.test');
               insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin');`);

// Réservation existante (prix et nom figés à la réservation).
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return d.toISOString().slice(0, 10); };
const bk = (await A("select public.create_booking('massage-relaxant', $1, '09:00', 'Aminata Koné', '+225 07 07 07 07 07', '') as r", [day(10)]))[0].r;
ok("préparation : une réservation existe avant la migration", bk.ok === true, JSON.stringify(bk));

const servicesHash = async () => (await A(`select md5(coalesce(json_agg(json_build_object('id', id, 'name', name, 'category', category::text, 'description', description,
  'duration_min', duration_min, 'duration_label', duration_label, 'price', price_fcfa, 'image', image_url, 'sort', sort_order, 'active', active, 'demo', is_demo) order by id)::text, '')) h from public.services`))[0].h;
const bookingsHash = async () => (await A("select md5(coalesce(json_agg(b order by b.id)::text, '')) h from public.bookings b"))[0].h;
const distribution = async () => (await A("select category::text c, count(*)::int n from public.services group by 1 order by 1")).map((r) => `${r.c}:${r.n}`).join(",");
const servicesBefore = await servicesHash(), bookingsBefore = await bookingsHash(), distBefore = await distribution();
const enumBefore = (await A("select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'service_category' order by enumsortorder")).map((r) => r.enumlabel).join(",");
const productsBefore = (await A("select md5(coalesce(json_agg(p order by p.id)::text, '')) h from public.products p"))[0].h;

// --- 1. La migration et son amorçage -----------------------------------------------------------
const sql = read(TARGET);
await db.exec(sql);
ok("amorçage : les 6 catégories actuelles, dans l'ordre d'affichage actuel", (await labels()).join() === "Visage,Massage,Corps,Onglerie,Coiffure,Spa", (await labels()).join());
const seeded = await A("select id, label, title, description, image_url, sort_order from public.service_categories order by sort_order");
ok("amorçage : identifiants identiques aux anciennes valeurs de l'énumération", seeded.map((r) => r.id).join() === "visage,massage,corps,onglerie,coiffure,spa");
ok("amorçage : titres et descriptions actuels conservés", seeded.find((r) => r.id === "visage").title === "Soins du visage" && seeded.find((r) => r.id === "coiffure").title === "Coiffure et tresses"
  && seeded.every((r) => r.description.length > 10), JSON.stringify(seeded));
ok("amorçage : aucune image enregistrée (les images actuelles restent celles du site)", seeded.every((r) => r.image_url === null));
ok("la migration ne modifie aucune prestation (nom, catégorie, description, durée, prix, image, ordre, état)", (await servicesHash()) === servicesBefore);
ok("la répartition des prestations par catégorie est identique", (await distribution()) === distBefore, `${await distribution()} vs ${distBefore}`);
ok("la migration ne modifie aucune réservation ni aucun produit", (await bookingsHash()) === bookingsBefore && (await A("select md5(coalesce(json_agg(p order by p.id)::text, '')) h from public.products p"))[0].h === productsBefore);

const seed = sql.slice(sql.indexOf("-- Amorçage"), sql.indexOf("-- services.category"));
ok("le fichier contient bien un bloc d'amorçage identifiable", seed.includes("insert into public.service_categories") && !seed.includes("create table"));
await db.exec(seed); await db.exec(seed);
ok("amorçage rejoué deux fois : toujours 6 catégories", (await count()) === 6);

// --- 2. Structure ------------------------------------------------------------------------------
ok("services.category est un texte (plus l'énumération)", (await A("select data_type from information_schema.columns where table_name='services' and column_name='category'"))[0].data_type === "text");
ok("services.category reste obligatoire", (await A("select is_nullable from information_schema.columns where table_name='services' and column_name='category'"))[0].is_nullable === "NO");
ok("clé étrangère services.category -> service_categories(id)",
  (await A("select count(*)::int n from pg_constraint where contype='f' and conrelid='public.services'::regclass and confrelid='public.service_categories'::regclass"))[0].n === 1);
ok("le type service_category n'est PAS supprimé et reste inchangé",
  (await A("select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'service_category' order by enumsortorder")).map((r) => r.enumlabel).join(",") === enumBefore && enumBefore.split(",").length === 6);
ok("unicité en base : index unique sur private.category_key(label)",
  (await A("select indexdef from pg_indexes where indexname='service_categories_label_key'"))[0]?.indexdef.includes("UNIQUE") === true);
ok("l'extension unaccent n'est pas activée", (await A("select count(*)::int n from pg_extension where extname='unaccent'"))[0].n === 0);

// --- 3. Contraintes directes (propriétaire de la base) -----------------------------------------
ok("contrainte : libellé non normalisé refusé même en insertion directe", (await fails("insert into public.service_categories (id, label, title) values ('x1', ' Sauna ', 'Sauna')")) === true);
ok("contrainte : doublon par la casse refusé par l'index unique", (await fails("insert into public.service_categories (id, label, title) values ('x2', 'VISAGE', 'Visage')")) === true);
ok("contrainte : doublon par les accents refusé", (await fails("insert into public.service_categories (id, label, title) values ('x3', 'Vísage', 'Visage')")) === true);
ok("contrainte : identifiant invalide refusé (majuscules, espace)", (await fails("insert into public.service_categories (id, label, title) values ('Bad Id', 'Sauna', 'Sauna')")) === true);
ok("contrainte : caractère de contrôle refusé", (await fails(`insert into public.service_categories (id, label, title) values ('x4', 'Sa' || chr(7) || 'una', 'Sauna')`)) === true);
ok("contrainte : commande de sens d'écriture refusée", (await fails("insert into public.service_categories (id, label, title) values ('x5', 'Sa' || chr(8238) || 'una', 'Sauna')")) === true);

// --- 4. Droits et RLS --------------------------------------------------------------------------
await as("anon");
ok("anon lit les catégories (6)", (await count()) === 6);
ok("anon ne peut ni insérer, ni modifier, ni supprimer", (await fails("insert into public.service_categories (id, label, title) values ('hack', 'Hack', 'Hack')")) === true
  && (await fails("update public.service_categories set label = 'X'")) === true && (await fails("delete from public.service_categories")) === true);
ok("anon ne peut pas appeler admin_create_service_category", (await fails("select public.admin_create_service_category('Sauna')")) === true);
await as("authenticated", CLIENT);
ok("un client connecté lit les catégories mais n'écrit pas", (await count()) === 6 && (await fails("insert into public.service_categories (id, label, title) values ('hack', 'Hack', 'Hack')")) === true
  && (await fails("update public.service_categories set label = 'X'")) === true && (await fails("delete from public.service_categories")) === true);
ok("un client connecté (non administrateur) reçoit 42501 sur admin_create_service_category", (await fails("select public.admin_create_service_category('Sauna')", [], /réservé aux administrateurs|42501/)) === true);
ok("... et rien n'a été créé", (await count()) === 6);
await as("authenticated", ADMIN);
ok("même un administrateur n'écrit pas directement dans la table (seule la fonction écrit)",
  (await fails("insert into public.service_categories (id, label, title) values ('hack', 'Hack', 'Hack')")) === true
  && (await fails("update public.service_categories set label = 'Autre' where id = 'spa'")) === true
  && (await fails("delete from public.service_categories where id = 'spa'")) === true);
ok("... la catégorie « spa » est intacte", (await labels()).includes("Spa") && (await count()) === 6);
await as("");

// --- 5. Création par un administrateur ---------------------------------------------------------
await as("authenticated", ADMIN);
let r = await create("Sauna");
ok("création : { ok, id, label }", r.ok === true && r.id === "sauna" && r.label === "Sauna", JSON.stringify(r));
const row = (await A("select * from public.service_categories where id = 'sauna'"))[0];
ok("création : titre = libellé, description vide, aucune image (image par défaut), placée à la fin de l'ordre",
  row.title === "Sauna" && row.description === "" && row.image_url === null && row.sort_order === 70, JSON.stringify(row));
r = await create("  Soins   du   dos  ");
ok("normalisation : espaces autour et répétés ramenés à un seul", r.ok === true && r.label === "Soins du dos" && r.id === "soins-du-dos", JSON.stringify(r));
r = await create("Épilation" + ch(0x200b));
ok("normalisation : caractère invisible retiré, identifiant sans accent", r.ok === true && r.label === "Épilation" && r.id === "epilation", JSON.stringify(r));
r = await create("Bain" + ch(0xa0) + "turc");
ok("normalisation : espace insécable ramenée à une espace", r.ok === true && r.label === "Bain turc" && r.id === "bain-turc", JSON.stringify(r));
const before = await count();
for (const [name, why] of [
  ["sauna", "casse"], ["SAUNA", "casse"], ["  Sauna ", "espaces"], ["Sau" + ch(0x200b) + "na", "caractère invisible"],
  ["Visage", "catégorie d'origine"], ["VISAGE", "casse d'une catégorie d'origine"], ["Vísage", "accent"], ["Massage" + ch(0xa0), "espace insécable"],
  ["E" + ch(0x301) + "pilation", "forme Unicode décomposée"], ["EPILATION", "accent absent"], ["Ｓauna", "lettre pleine chasse"],
]) {
  const x = await create(name);
  ok(`doublon refusé (${why}) : « ${name} »`, x.ok === false && x.code === "category_exists", JSON.stringify(x));
}
ok("... aucun doublon créé", (await count()) === before);
for (const [name, why] of [["", "vide"], ["   ", "espaces seuls"], ["a", "1 caractère"], ["x".repeat(61), "61 caractères"], ["Sa" + ch(7) + "una", "caractère de contrôle"], ["Sa" + ch(0x202e) + "una", "sens d'écriture"]]) {
  const x = await create(name);
  ok(`nom invalide refusé (${why})`, x.ok === false && x.code === "invalid_input", JSON.stringify(x));
}
ok("null refusé proprement", (await A("select public.admin_create_service_category(null) as r"))[0].r.code === "invalid_input");
ok("60 caractères acceptés", (await create("y".repeat(60))).ok === true);

// Identifiants : collisions et noms sans lettres latines.
r = await create("Spa!");
ok("identifiant déjà pris (« spa ») : suffixe -2", r.ok === true && r.id === "spa-2" && r.label === "Spa!", JSON.stringify(r));
r = await create("Spa?");
ok("identifiant déjà pris : suffixe suivant -3", r.ok === true && r.id === "spa-3", JSON.stringify(r));
r = await create("!!!");
ok("nom sans lettre ni chiffre : identifiant « categorie »", r.ok === true && r.id === "categorie", JSON.stringify(r));
r = await create("???");
ok("... et le suivant « categorie-2 »", r.ok === true && r.id === "categorie-2", JSON.stringify(r));
r = await create("日本語");
ok("nom non latin : accepté, identifiant de repli", r.ok === true && /^categorie-\d+$/.test(r.id), JSON.stringify(r));
ok("tous les identifiants créés respectent le format des URL", (await A("select count(*)::int n from public.service_categories where id !~ '^[a-z0-9-]{2,60}$'"))[0].n === 0);
ok("les catégories d'origine sont intactes (libellés, ordre)", (await labels()).slice(0, 6).join() === "Visage,Massage,Corps,Onglerie,Coiffure,Spa");
await as("");

// --- 6. Prestations et réservations avec une catégorie créée -----------------------------------
await as("authenticated", ADMIN);
await db.exec("update public.services set category = 'sauna' where id = 'pedicure'");
ok("un administrateur peut classer une prestation dans une nouvelle catégorie", (await A("select category from public.services where id='pedicure'"))[0].category === "sauna");
ok("une catégorie inconnue est refusée par la clé étrangère", (await fails("update public.services set category = 'inconnue' where id = 'pedicure'")) === true);
ok("l'ancienne valeur de l'énumération n'est plus un type : texte libre refusé s'il n'existe pas", (await fails("insert into public.services (id, name, category, description, duration_min, duration_label, price_fcfa) values ('t1','Test','nulle','',30,'30 min',1000)")) === true);
await db.exec("insert into public.services (id, name, category, description, duration_min, duration_label, price_fcfa) values ('sauna-vapeur','Sauna vapeur','sauna','',30,'30 min',5000)");
await as("");
await db.exec("update public.services set category = 'onglerie' where id = 'pedicure'");
ok("la catégorie d'une prestation utilisée ne peut pas être supprimée (clé étrangère)", (await fails("delete from public.service_categories where id = 'sauna'")) === true);
await as("anon");
ok("anon lit la prestation d'une nouvelle catégorie (catalogue public)", (await A("select category from public.services where id = 'sauna-vapeur'"))[0]?.category === "sauna");
const nb = (await A("select public.create_booking('sauna-vapeur', $1, '10:30', 'Awa Traoré', '+225 05 05 05 05 05', '') as r", [day(11)]))[0].r;
ok("réservation d'une prestation d'une nouvelle catégorie : acceptée, tarif et durée figés", nb.ok === true, JSON.stringify(nb));
const nb2 = (await A("select public.create_booking('massage-relaxant', $1, '12:00', 'Awa Traoré', '+225 05 05 05 05 05', '') as r", [day(12)]))[0].r;
ok("réservation d'une prestation d'une catégorie d'origine : toujours acceptée", nb2.ok === true, JSON.stringify(nb2));
await as("");
ok("la réservation d'avant la migration est inchangée (nom et prix figés)", (await A("select service_name, price_fcfa from public.bookings where ref = $1", [bk.ref]))[0]?.service_name === "Massage relaxant");
ok("les prix et durées des prestations d'origine sont inchangés",
  (await A("select count(*)::int n from public.services where id = 'massage-relaxant' and price_fcfa = 20000 and duration_label = '60 min'"))[0].n === 1);

// --- 7. Fonction : ordre des contrôles, droits -------------------------------------------------
const def = (await A("select pg_get_functiondef('public.admin_create_service_category(text)'::regprocedure) d"))[0].d;
ok("le rôle admin est vérifié AVANT la normalisation du texte", def.indexOf("is_admin") > -1 && def.indexOf("is_admin") < def.indexOf("category_name"));
ok("SECURITY DEFINER avec search_path vide", /security definer/i.test(def) && /search_path (TO|=) ''|search_path=""|search_path TO ''/i.test(def.replace(/"/g, "'")) || (await A("select proconfig from pg_proc where proname='admin_create_service_category'"))[0].proconfig.includes('search_path=""'));
ok("exécutable par authenticated seulement (pas anon, pas PUBLIC)",
  (await A("select has_function_privilege('authenticated','public.admin_create_service_category(text)','execute') a, has_function_privilege('anon','public.admin_create_service_category(text)','execute') n"))[0].a === true
  && (await A("select has_function_privilege('anon','public.admin_create_service_category(text)','execute') n"))[0].n === false);
ok("service_role n'est pas administrateur : la fonction lui est refusée", await (async () => { await as("service_role"); const x = await fails("select public.admin_create_service_category('Hammam')", [], /réservé aux administrateurs|permission denied/); await as(""); return x === true; })());
ok("aucun droit d'écriture direct (INSERT/UPDATE/DELETE) pour anon et authenticated sur la table",
  (await A("select count(*)::int n from information_schema.table_privileges where table_name='service_categories' and grantee in ('anon','authenticated') and privilege_type <> 'SELECT'"))[0].n === 0);
ok("RLS activée", (await A("select relrowsecurity r from pg_class where relname='service_categories'"))[0].r === true);
ok("la fonction ne touche à aucune autre table que service_categories", !/public\.(services|bookings|products)\b/.test(def.replace(/public\.service_categories/g, "")));

// --- 8. Prestations inactives : visibles de l'administrateur seulement (le site public les filtre côté application, voir api.ts) ---------
await db.exec("update public.services set active = false where id = 'manucure'");
await as("anon");
ok("anon ne voit jamais une prestation inactive (RLS)", (await A("select count(*)::int n from public.services where id = 'manucure'"))[0].n === 0);
await as("authenticated", ADMIN);
ok("un administrateur lit aussi les prestations inactives : le site public doit donc filtrer sur active (api.ts)", (await A("select count(*)::int n from public.services where id = 'manucure'"))[0].n === 1);
await as("authenticated", CLIENT);
ok("un client connecté ne voit pas non plus les inactives", (await A("select count(*)::int n from public.services where id = 'manucure'"))[0].n === 0);
await as("");

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
