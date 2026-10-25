// Catégories de produits : table, unicité (casse, espaces, Unicode, accents combinants), normalisation, RLS, droits et amorçage de
// supabase/migrations/20261027000000_product_categories.sql. Paramètre facultatif : SUPABASE_DIR (dossier contenant migrations/ et seed.sql).
// Base PostgreSQL locale en mémoire (PGlite) : aucune connexion au projet Supabase distant.
// Exécution : npm run test:sql:categories
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = process.env.SUPABASE_DIR ?? fileURLToPath(new URL("../../../supabase", import.meta.url));
const TARGET = "20261027000000_product_categories.sql";
const files = readdirSync(`${root}/migrations`).filter((f) => f.endsWith(".sql")).sort();
const read = (f) => readFileSync(`${root}/migrations/${f}`, "utf8");

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + extra}`); };
const A = async (sql, p = []) => (await db.query(sql, p)).rows;
const as = async (role, sub = "") => { await db.exec("reset role"); if (role) await db.exec(`set role ${role}`); await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]); };
const fails = async (sql, p = [], re = /permission denied|row-level security|réservé aux administrateurs|violates (check|unique)|duplicate key/i) => {
  try { await db.query(sql, p); return false; } catch (e) { return re.test(e.message) ? true : "autre erreur: " + e.message; }
};
const create = async (name) => (await A("select public.admin_create_category($1) as r", [name]))[0].r;
const names = async () => (await A("select name from public.product_categories order by name")).map((r) => r.name);
const count = async () => (await A("select count(*)::int n from public.product_categories"))[0].n;

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
// Toutes les migrations SAUF celle des catégories : on prépare d'abord un catalogue « existant », puis on applique la migration par-dessus.
await db.exec(files.filter((f) => f < TARGET).map(read).join("\n"));
await db.exec(readFileSync(`${root}/seed.sql`, "utf8"));

const ADMIN = "00000000-0000-0000-0000-0000000000a1", CLIENT = "00000000-0000-0000-0000-0000000000c1";
await db.exec(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@example.test'), ('${CLIENT}', 'cliente@example.test');
               insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin');`);

// Catalogue existant : casse et espaces variés, une catégorie hors liste du code, des coûts et des mouvements de stock.
await db.exec(`
  insert into public.products (id, sku, name, category, sale_price, stock_qty) values
    ('p-hydra',  'T-HYDRA',  'Crème A',  'Hydratation',        9000, 7),
    ('p-hydra2', 'T-HYDRA2', 'Crème B',  'hydratation  ',      8000, 3),
    ('p-corps',  'T-CORPS',  'Gel',      'Soins   du  corps',  5500, 12),
    ('p-inedit', 'T-INEDIT', 'Brume',    'Catégorie inédite',  3000, 0),
    ('p-nett',   'T-NETT',   'Savon',    'Nettoyants',         6000, 20);
  insert into public.product_costs (product_id, cost_price) values ('p-hydra', 4000), ('p-corps', 2500);
  insert into public.stock_movements (product_id, type, quantity, stock_after, reason) values
    ('p-hydra', 'initial', 7, 7, 'Stock initial'), ('p-corps', 'initial', 12, 12, 'Stock initial'), ('p-nett', 'initial', 20, 20, 'Stock initial');
`);
const snapshot = async () => (await A(`select md5(
  coalesce((select json_agg(p order by p.id) from public.products p)::text, '') ||
  coalesce((select json_agg(c order by c.product_id) from public.product_costs c)::text, '') ||
  coalesce((select json_agg(m order by m.id) from public.stock_movements m)::text, '') ||
  coalesce((select json_agg(s order by s.id) from public.services s)::text, '')) as h`))[0].h;
const serviceCategoriesBefore = (await A("select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'service_category' order by enumsortorder")).map((r) => r.enumlabel).join(",");
const before = await snapshot();

// --- 1. La migration et son amorçage -----------------------------------------------------------
const sql = read(TARGET);
await db.exec(sql);
const STATIC_CATEGORIES = ["Soins du visage", "Nettoyants", "Hydratation", "Sérums et soins ciblés", "Soins du corps", "Coffrets beauté", "Routines beauté"];
let list = await names();
ok("amorçage : les 7 catégories proposées par le code sont présentes", STATIC_CATEGORIES.every((c) => list.includes(c)), JSON.stringify(list));
ok("amorçage : la catégorie réellement utilisée mais absente du code est ajoutée", list.includes("Catégorie inédite"), JSON.stringify(list));
ok("amorçage : casse et espaces variés ramenés à une seule entrée (Hydratation, Soins du corps)", list.filter((n) => /^hydratation$/i.test(n)).length === 1 && list.includes("Soins du corps") && !list.some((n) => /\s{2,}/.test(n)), JSON.stringify(list));
ok("amorçage : exactement 8 catégories (7 du code + 1 inédite), aucun doublon", list.length === 8 && new Set(list.map((n) => n.toLowerCase())).size === 8, JSON.stringify(list));
ok("la migration ne modifie aucun produit, coût, mouvement de stock ni prestation", (await snapshot()) === before);

// Amorçage rejouable : on rejoue UNIQUEMENT les deux insertions d'amorçage, deux fois.
const seed = sql.slice(sql.indexOf("-- Amorçage"));
ok("le fichier contient bien un bloc d'amorçage identifiable", seed.includes("insert into public.product_categories") && !seed.includes("create table"));
await db.exec(seed); await db.exec(seed);
ok("amorçage rejoué deux fois : toujours 8 catégories, aucun doublon", (await count()) === 8 && (await names()).join() === list.join());

// --- 2. Structure ------------------------------------------------------------------------------
const cols = await A("select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='product_categories' order by ordinal_position");
ok("table : identifiant, nom, date de création — et rien d'autre (pas de description)", cols.map((c) => c.column_name).join() === "id,name,created_at" && cols.every((c) => c.is_nullable === "NO"), JSON.stringify(cols));
ok("unicité en base : index unique sur private.category_key(name) (casse, espaces, forme Unicode et accents combinants ignorés)",
  (await A("select indexdef from pg_indexes where indexname='product_categories_name_key'"))[0]?.indexdef.includes("UNIQUE") === true
  && (await A("select indexdef from pg_indexes where indexname='product_categories_name_key'"))[0].indexdef.includes("category_key(name)"));
ok("products.category reste un texte libre : colonne text, aucune clé étrangère liée aux catégories",
  (await A("select data_type from information_schema.columns where table_name='products' and column_name='category'"))[0].data_type === "text"
  && (await A("select count(*)::int n from pg_constraint where contype='f' and (conrelid='public.product_categories'::regclass or confrelid='public.product_categories'::regclass)"))[0].n === 0);
ok("l'extension unaccent n'est pas activée", (await A("select count(*)::int n from pg_extension where extname='unaccent'"))[0].n === 0);
ok("le type des catégories de prestations (service_category) est inchangé", (await A("select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'service_category' order by enumsortorder")).map((r) => r.enumlabel).join(",") === serviceCategoriesBefore);

// --- 3. Contraintes directes (propriétaire de la base) -----------------------------------------
ok("contrainte : un nom non normalisé (espaces autour) est refusé même en insertion directe", (await fails("insert into public.product_categories (name) values (' Parfums ')")) === true);
ok("contrainte : deux espaces d'affilée refusés", (await fails("insert into public.product_categories (name) values ('Huiles  rares')")) === true);
ok("contrainte : caractère de contrôle refusé", (await fails("insert into public.product_categories (name) values ('Huile' || chr(10) || 'rare')")) === true);
ok("contrainte : variante de casse d'un nom existant refusée par l'index unique, même en insertion directe", (await fails("insert into public.product_categories (name) values ('NETTOYANTS')")) === true);
ok("contrainte : nom d'un seul caractère ou de 61 caractères refusé", (await fails("insert into public.product_categories (name) values ('a')")) === true && (await fails("insert into public.product_categories (name) values (repeat('x', 61))")) === true);

// --- 4. Fonction : propriétés et droits ---------------------------------------------------------
const fn = (await A(`select p.prosecdef, coalesce(p.proconfig, '{}') @> array['search_path=""'] as safe_path,
    has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
    exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='admin_create_category'`))[0];
ok("admin_create_category : SECURITY DEFINER avec search_path vide", fn.prosecdef === true && fn.safe_path === true, JSON.stringify(fn));
ok("admin_create_category : exécutable par authenticated seulement (ni anon, ni PUBLIC)", fn.auth_exec === true && fn.anon_exec === false && fn.public_exec === false, JSON.stringify(fn));
const tp = async (role) => (await A(`select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege($1, 'public.product_categories', p)`, [role])).map((r) => r.p).join();
ok("droits sur la table : anon aucun, authenticated lecture seule (RLS : administrateur)", (await tp("anon")) === "" && (await tp("authenticated")) === "SELECT");
ok("la séquence n'est utilisable par aucun rôle applicatif", (await A("select has_sequence_privilege('anon','public.product_categories_id_seq','USAGE') a, has_sequence_privilege('authenticated','public.product_categories_id_seq','USAGE') b"))[0].a === false
  && (await A("select has_sequence_privilege('authenticated','public.product_categories_id_seq','USAGE') b"))[0].b === false);
ok("RLS activée ; une seule politique, en lecture, réservée aux administrateurs", (await A("select relrowsecurity from pg_class where oid='public.product_categories'::regclass"))[0].relrowsecurity === true
  && JSON.stringify((await A("select cmd, roles::text r from pg_policies where tablename='product_categories'"))) === JSON.stringify([{ cmd: "SELECT", r: "{authenticated}" }]));

// --- 5. Administrateur : création, normalisation, doublons --------------------------------------
await as("authenticated", ADMIN);
let r = await create("Parfums d'ambiance");
ok("admin : création d'une catégorie valide (identifiant et nom renvoyés)", r.ok === true && typeof r.id === "number" && r.name === "Parfums d'ambiance", JSON.stringify(r));
ok("la catégorie est enregistrée durablement", (await names()).includes("Parfums d'ambiance") && (await count()) === 9);
r = await create("  Huiles   et \t baumes \n");
ok("normalisation : espaces de début et de fin retirés, espaces répétés ramenés à un seul (tabulations et retours compris)", r.ok === true && r.name === "Huiles et baumes" && (await names()).includes("Huiles et baumes"), JSON.stringify(r));
const exact60 = "x".repeat(60);
r = await create(exact60);
ok("limite : 60 caractères acceptés", r.ok === true && r.name === exact60, JSON.stringify(r).slice(0, 80));

const n0 = await count();
for (const [label, value] of [
  ["même nom, casse différente", "parfums D'AMBIANCE"],
  ["même nom, espaces superflus et casse", "  PARFUMS   d'ambiance  "],
  ["catégorie du code, casse différente", "hydratation"],
  ["catégorie du code, majuscules", "HYDRATATION"],
  ["catégorie du code, espaces autour", "   nettoyants "],
  ["catégorie issue des produits existants", "catégorie INÉDITE".replace("É", "é")],
]) {
  r = await create(value);
  ok(`doublon refusé (${label}) : category_exists avec un message clair`, r.ok === false && r.code === "category_exists" && /existe déjà/.test(r.error), JSON.stringify(r));
}
ok("les doublons refusés n'écrivent rien", (await count()) === n0);

for (const [label, value] of [["null", null], ["vide", ""], ["espaces seulement", "   "], ["1 caractère", "a"], ["1 caractère entouré d'espaces", "  a  "], ["61 caractères", "y".repeat(61)], ["caractère de contrôle", "Huile" + String.fromCharCode(7) + "rare"]]) {
  r = await create(value);
  ok(`nom invalide refusé (${label}) : invalid_input`, r.ok === false && r.code === "invalid_input" && /2 à 60/.test(r.error), JSON.stringify(r));
}
ok("les noms invalides n'écrivent rien", (await count()) === n0);
ok("l'administrateur lit la liste complète des catégories", (await A("select count(*)::int n from public.product_categories"))[0].n === n0);

// --- 5b. Unicode, espaces insécables, accents (variante proposée) ----------------------------------------------------------------
const C = (...codes) => String.fromCharCode(...codes);
const n5b = await count();
for (const [label, value] of [
  ["espace insécable entre les mots", "Soins" + C(0xa0) + "du corps"],
  ["espace cadratin entre les mots", "Soins" + C(0x2003) + "du corps"],
  ["espace de largeur nulle dans le nom", "Hydra" + C(0x200b) + "tation"],
  ["trait d'union conditionnel dans le nom", "Hydra" + C(0xad) + "tation"],
  ["forme décomposée NFD (lettre + accent combinant)", "Se" + C(0x301) + "rums et soins cible" + C(0x301) + "s"],
  ["accents retirés (« serums et soins cibles »)", "serums et soins cibles"],
  ["accent ajouté (« Hydratatión »)", "Hydratati" + C(0xf3) + "n"],
  ["lettres pleine chasse (« Ｈydratation »)", C(0xff28) + "ydratation"],
]) {
  r = await create(value);
  ok(`doublon refusé (${label}) : category_exists`, r.ok === false && r.code === "category_exists", JSON.stringify(r));
}
ok("ces doublons n'écrivent rien", (await count()) === n5b);

r = await create("Accessoires" + C(0xa0) + C(0x200b));
ok("espace insécable et caractère invisible en fin de nom : retirés à l'enregistrement", r.ok === true && r.name === "Accessoires", JSON.stringify(r));
r = await create("Cre" + C(0x300) + "mes   de  jour");
ok("forme décomposée (NFD) : enregistrée en NFC, espaces fusionnés", r.ok === true && r.name === "Cr" + C(0xe8) + "mes de jour" && r.name === r.name.normalize("NFC"), JSON.stringify(r));
for (const [label, value] of [["commande de sens d'écriture (U+202E)", "Par" + C(0x202e) + "fums"], ["isolat bidi (U+2066)", "Par" + C(0x2066) + "fums"], ["uniquement des caractères invisibles", C(0x200b, 0x200b, 0x200b)], ["espaces insécables seulement", C(0xa0, 0xa0, 0xa0)]]) {
  r = await create(value);
  ok(`nom invalide refusé (${label}) : invalid_input`, r.ok === false && r.code === "invalid_input", JSON.stringify(r));
}

// LIMITES documentées : les lettres sans décomposition Unicode ne sont pas rapprochées de leur équivalent sans accent.
// Ces assertions décrivent le comportement RÉEL ; si elles changent un jour, la documentation de la migration doit changer aussi.
ok("limite connue : « Cœur » puis « Coeur » sont deux catégories distinctes", (await create("Cœur")).ok === true && (await create("Coeur")).ok === true);
ok("limite connue : « Straße » puis « Strasse » sont deux catégories distinctes", (await create("Straße")).ok === true && (await create("Strasse")).ok === true);

const noncanon = await A(`select name from public.product_categories where name <> normalize(name, NFC) or name ~ '[[:cntrl:]]' or name ~ '[[:space:]]{2,}' or name <> btrim(name) or position(chr(160) in name) > 0 or position(chr(8203) in name) > 0`);
ok("tous les noms enregistrés sont sous forme canonique (NFC, sans invisible, sans espace insécable ni doublée)", noncanon.length === 0, JSON.stringify(noncanon));

await as(null);
ok("contrainte : un nom avec espace insécable est refusé même en insertion directe", (await fails("insert into public.product_categories (name) values ('Parfums' || chr(160) || 'rares')")) === true);
ok("contrainte : un nom en forme décomposée (NFD) est refusé même en insertion directe", (await fails("insert into public.product_categories (name) values ('Cre' || U&'\\0300' || 'mes rares')")) === true);
ok("index unique : une variante d'accent est refusée même en insertion directe", (await fails("insert into public.product_categories (name) values ('Nettoyánts')")) === true);
for (const [label, code] of [["U+202E (inversion de l'affichage)", 8238], ["U+2066 (isolat)", 8294], ["U+200F (marque droite-à-gauche)", 8207]]) {
  ok(`contrainte : une commande de sens d'écriture ${label} est refusée même en insertion directe`, (await fails("insert into public.product_categories (name) values ('Par' || chr(" + code + ") || 'fums')")) === true);
}
ok("contrainte : un caractère invisible (U+200B) est refusé même en insertion directe", (await fails("insert into public.product_categories (name) values ('Par' || chr(8203) || 'fums')")) === true);
const vol = await A(`select p.proname, p.provolatile, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname in ('category_name', 'category_key') order by 1`);
ok("fonctions de normalisation : IMMUABLES (utilisables dans l'index), non exécutables par anon ni authenticated", vol.length === 2 && vol.every((f) => f.provolatile === "i" && !f.a && !f.u), JSON.stringify(vol));
ok("l'extension unaccent n'est toujours pas activée", (await A("select count(*)::int n from pg_extension where extname = 'unaccent'"))[0].n === 0);
await as("authenticated", ADMIN);

// --- 5c. Amorçage sur des catalogues atypiques et sur un catalogue réaliste -----------------------------------------------------
{
  const mk = async (productsSql) => {
    const d = new PGlite();
    await d.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
    await d.exec(files.filter((f) => f < TARGET).map(read).join("\n"));
    await d.exec(readFileSync(`${root}/seed.sql`, "utf8"));
    if (productsSql) await d.exec(productsSql);
    return d;
  };
  const prod = (id, cat) => `insert into public.products (id, sku, name, category, sale_price, stock_qty) values ('prod-${id}', 'T-PROD-${id.toUpperCase()}', 'Produit ${id}', $c$${cat}$c$, 1000, 1);`;
  const snap = async (d) => (await d.query(`select md5(coalesce((select json_agg(p order by p.id) from public.products p)::text, '')) h`)).rows[0].h;
  const cats = async (d) => (await d.query("select name from public.product_categories order by name")).rows.map((x) => x.name);

  // Catalogue réaliste = celui du projet : 7 produits, 5 catégories distinctes, toutes dans la liste du code.
  let d = await mk([["a", "Hydratation"], ["b", "Nettoyants"], ["c", "Soins du corps"], ["d", "Soins du visage"], ["e", "Soins du visage"], ["f", "Coffrets beauté"], ["g", "Soins du corps"]].map(([i, c]) => prod(i, c)).join("\n"));
  let h0 = await snap(d);
  await d.exec(read(TARGET));
  ok("catalogue réaliste (5 catégories utilisées, toutes dans la liste du code) : exactement 7 catégories, pas 8", (await cats(d)).length === 7);
  ok("catalogue réaliste : aucun produit modifié", (await snap(d)) === h0);

  // Une catégorie historique atypique ne doit JAMAIS faire échouer la migration.
  for (const [label, hist, expected] of [
    ["caractère de contrôle (U+0007)", "Huile" + C(7) + "rare", null],
    ["commande de sens d'écriture (U+202E)", "Soins" + C(0x202e) + "x", null],
    ["espace insécable", "Huiles" + C(0xa0) + "rares", "Huiles rares"],
    ["forme décomposée NFD d'une catégorie du code", "Se" + C(0x301) + "rums et soins cible" + C(0x301) + "s", "SANS AJOUT"],
    ["casse et espaces variés d'une catégorie du code", "  HYDRATATION  ", "SANS AJOUT"],
    ["accents retirés d'une catégorie du code", "Serums et soins cibles", "SANS AJOUT"],
  ]) {
    d = await mk(prod("hist", hist));
    const h = await snap(d);
    let failed = null;
    try { await d.exec(read(TARGET)); } catch (e) { failed = e.message.split("\n")[0]; }
    const extra = failed ? [] : (await cats(d)).filter((n) => !["Soins du visage", "Nettoyants", "Hydratation", "Sérums et soins ciblés", "Soins du corps", "Coffrets beauté", "Routines beauté"].includes(n));
    const good = failed === null && (expected === null ? extra.length === 0 : expected === "SANS AJOUT" ? extra.length === 0 : extra.join() === expected);
    ok(`amorçage : catégorie historique atypique (${label}) → la migration réussit${expected && expected !== "SANS AJOUT" ? ` et enregistre « ${expected} »` : expected === "SANS AJOUT" ? " sans doublon" : " et l'ignore"}`, good, failed ?? JSON.stringify(extra));
    ok(`amorçage : (${label}) le produit historique n'est pas modifié`, failed !== null || (await snap(d)) === h);
    if (!failed) {
      const n1 = (await cats(d)).length;
      const seedSql = read(TARGET).slice(read(TARGET).indexOf("-- Amorçage"));
      await d.exec(seedSql); await d.exec(seedSql);
      ok(`amorçage : (${label}) rejouable sans doublon`, (await cats(d)).length === n1);
    }
  }
}

// --- 5d. Autres espaces Unicode et rafales de noms équivalents --------------------------------------------------------------------
{
  const spaces = [0x09, 0x0b, 0x0c, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000];
  const accepted = [];
  for (const cp of spaces) {
    const res = await create("Soins" + C(cp) + "du corps");
    if (!(res.ok === false && res.code === "category_exists")) accepted.push("U+" + cp.toString(16).padStart(4, "0"));
  }
  ok("espaces Unicode (tabulation, U+1680, U+2000 à U+200A, U+2028/2029, U+202F, U+205F, U+3000) : tous traités comme une espace ordinaire (doublon refusé)", accepted.length === 0, accepted.join(","));
  const before5d = await count();
  r = await create("Soins" + C(0x2009, 0x2009) + "du" + C(0x3000) + C(0xa0) + "corps");
  ok("plusieurs espaces de natures différentes d'affilée : fusionnés en une seule, doublon refusé", r.ok === false && r.code === "category_exists", JSON.stringify(r));
  ok("aucune de ces tentatives n'a écrit quoi que ce soit", (await count()) === before5d);

  // Rafale de noms équivalents : la base arbitre. PGlite n'a qu'une connexion : ce test vérifie l'arbitrage d'une salve de demandes, pas un vrai
  // parallélisme ; l'atomicité elle-même repose sur l'index unique et ON CONFLICT de PostgreSQL (vérifiés au niveau SQL juste dessous).
  const salve = ["Cadeaux", "cadeaux", "  CADEAUX  ", "Cadeaux" + C(0xa0), "Cad" + C(0xe9) + "aux", "Cade" + C(0x301) + "aux", "Ca" + C(0x200b) + "deaux", C(0xff23) + "adeaux"];
  const rs = await Promise.all(salve.map((nm) => create(nm)));
  ok("rafale de 8 noms équivalents (casse, espaces, accents, NFD, invisible, pleine chasse) : une seule création aboutit, les 7 autres sont refusées",
    rs.filter((x) => x.ok === true).length === 1 && rs.filter((x) => x.code === "category_exists").length === 7, JSON.stringify(rs.map((x) => x.ok ? "ok" : x.code)));
  ok("rafale : une seule ligne ajoutée", (await count()) === before5d + 1);

  await as(null);
  const n0 = await count();
  ok("niveau SQL : deux noms équivalents dans UNE MÊME instruction d'insertion → l'instruction échoue en entier (aucune ligne écrite)",
    (await fails("insert into public.product_categories (name) select unnest(array['Rafale', 'rafale'])")) === true && (await count()) === n0);
  const salveSql = await A(`insert into public.product_categories (name) select unnest(array['Salve', 'SALVE', 'Salv' || chr(233)])
    on conflict (private.category_key(name)) do nothing returning name`);
  ok("niveau SQL : avec l'ON CONFLICT utilisé par la fonction, une seule ligne de la salve est insérée", salveSql.length === 1 && (await count()) === n0 + 1, JSON.stringify(salveSql));
  await as("authenticated", ADMIN);
}

// --- 6. Compte connecté non administrateur -------------------------------------------------------
await as("authenticated", CLIENT);
ok("non administrateur : admin_create_category refusée (42501, réservé aux administrateurs)", (await fails("select public.admin_create_category('Intrus')", [], /réservé aux administrateurs/)) === true);
ok("non administrateur : aucune catégorie lisible (RLS)", (await A("select * from public.product_categories")).length === 0);
for (const [label, q] of [["INSERT", "insert into public.product_categories (name) values ('Direct')"], ["UPDATE", "update public.product_categories set name = 'Renommée'"],
  ["DELETE", "delete from public.product_categories"], ["TRUNCATE", "truncate public.product_categories"]]) {
  ok(`non administrateur : ${label} direct refusé`, (await fails(q)) === true);
}
await as("authenticated", ADMIN);
for (const [label, q] of [["INSERT", "insert into public.product_categories (name) values ('Direct')"], ["UPDATE", "update public.product_categories set name = 'Renommée'"],
  ["DELETE", "delete from public.product_categories"], ["TRUNCATE", "truncate public.product_categories"]]) {
  ok(`administrateur : ${label} direct refusé aussi (seule la fonction écrit)`, (await fails(q)) === true);
}

// --- 7. Visiteur anonyme ---------------------------------------------------------------------------
await as("anon");
ok("anon : admin_create_category refusée (fonction fermée)", (await fails("select public.admin_create_category('Anonyme')")) === true);
ok("anon : lecture de la table refusée", (await fails("select * from public.product_categories")) === true);
ok("anon : écriture refusée", (await fails("insert into public.product_categories (name) values ('Anonyme')")) === true);

// --- 7b. service_role (clé serveur, jamais dans le navigateur) ---------------------------------------------------------------------
await as("service_role");
{
  const nSr = await count();
  ok("service_role : lit toute la table (contourne la RLS)", nSr >= 8 && (await A("select count(*)::int n from public.product_categories"))[0].n === nSr);
  ok("service_role : admin_create_category refusée (sans session d'utilisateur, il n'est pas administrateur)", (await fails("select public.admin_create_category('ViaService')", [], /réservé aux administrateurs/)) === true);
  r = (await A("insert into public.product_categories (name) values ('Ajout serveur') returning name"))[0];
  ok("service_role : peut écrire directement (droit par défaut de la clé serveur, documenté dans la migration)", r?.name === "Ajout serveur" && (await count()) === nSr + 1);
  ok("service_role : reste soumis aux contraintes — nom non canonique refusé", (await fails("insert into public.product_categories (name) values ('Ajout' || chr(160) || 'serveur2')")) === true);
  ok("service_role : reste soumis aux contraintes — équivalent par casse refusé", (await fails("insert into public.product_categories (name) values ('AJOUT SERVEUR')")) === true);
  ok("service_role : reste soumis aux contraintes — équivalent par accent refusé (« Ajout servéur »)", (await fails("insert into public.product_categories (name) values ('Ajout serv' || chr(233) || 'ur')")) === true);
  ok("service_role : ces refus n'ont rien écrit", (await count()) === nSr + 1);
}

// --- 7c. Ordre des opérations : les droits sont vérifiés AVANT toute normalisation du nom ---------------------------------------------
// Sonde : dans une base jetable, private.category_name est remplacée par une version qui lève une erreur reconnaissable dès qu'elle est
// appelée. Un non-administrateur doit être refusé (42501) SANS que la normalisation soit appelée ; l'administrateur, lui, doit l'atteindre
// (ce qui prouve que la sonde fonctionne). Le coût du traitement d'un très long texte ne peut donc pas être provoqué par un non-administrateur.
{
  const d = new PGlite();
  await d.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
  await d.exec(files.map(read).join("\n"));
  await d.exec(readFileSync(`${root}/seed.sql`, "utf8"));
  await d.exec(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@example.test'), ('${CLIENT}', 'cliente@example.test');
                insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin');`);
  await d.exec(`create or replace function private.category_name(p text) returns text language sql immutable set search_path = ''
                as $$ select (case when p is not null then 'NORMALISATION_APPELEE' else '0' end)::int::text $$`);
  const nBefore = (await d.query("select count(*)::int n from public.product_categories")).rows[0].n;
  const call = async (sub, name) => {
    await d.exec("reset role"); await d.exec("set role authenticated");
    await d.query("select set_config('request.jwt.claim.sub', $1, false)", [sub]);
    try { return { r: (await d.query("select public.admin_create_category($1) as r", [name])).rows[0].r }; } catch (e) { return { error: e.message }; }
  };
  const nonAdmin = await call(CLIENT, "Intrus");
  ok("non-administrateur : refusé (42501) AVANT tout appel à la normalisation", /réservé aux administrateurs/.test(nonAdmin.error ?? "") && !/NORMALISATION_APPELEE/.test(nonAdmin.error ?? ""), JSON.stringify(nonAdmin));
  const huge = await call(CLIENT, "Soins" + String.fromCharCode(0xa0) + "du ".repeat(2_000_000));
  ok("non-administrateur, texte de plusieurs Mo : refusé avant tout traitement du texte", /réservé aux administrateurs/.test(huge.error ?? "") && !/NORMALISATION_APPELEE/.test(huge.error ?? ""), String(huge.error).slice(0, 120));
  const nullName = await call(CLIENT, null);
  ok("non-administrateur, nom nul : refusé avant tout traitement", /réservé aux administrateurs/.test(nullName.error ?? ""), JSON.stringify(nullName));
  const admin = await call(ADMIN, "Parfums");
  ok("administrateur : la normalisation est bien atteinte après le contrôle des droits (la sonde fonctionne)", /NORMALISATION_APPELEE/.test(admin.error ?? ""), JSON.stringify(admin));
  await d.exec("reset role");
  ok("aucune de ces tentatives n'a écrit une ligne", (await d.query("select count(*)::int n from public.product_categories")).rows[0].n === nBefore);
  await d.close();
}

// --- 8. Non-régression ----------------------------------------------------------------------------
await as(null);
ok("après toutes les opérations : produits, coûts, mouvements de stock et prestations strictement identiques", (await snapshot()) === before);
ok("les 5 produits existants sont intacts (catégories texte d'origine conservées)",
  JSON.stringify((await A("select id, category from public.products order by id")).map((x) => [x.id, x.category])) ===
  JSON.stringify([["p-corps", "Soins   du  corps"], ["p-hydra", "Hydratation"], ["p-hydra2", "hydratation  "], ["p-inedit", "Catégorie inédite"], ["p-nett", "Nettoyants"]]));
ok("la boutique publique ne dépend pas de la table : anon lit toujours les produits actifs sans elle", (await (async () => { await as("anon"); const rows = await A("select id, category from public.products order by id"); await as(null); return rows.length === 5; })()));

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
