// Audit de sécurité de l'étape 1 (boutique) : droits effectifs, contournements possibles du stock et du journal,
// validations, absence d'effet sur les objets existants, script d'import des produits de démonstration.
// Base PostgreSQL locale en mémoire (PGlite) : TEST SIMULÉ, aucune connexion au projet Supabase distant.
// Exécution : bun run test:sql:products-audit
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = process.env.SUPABASE_DIR ?? fileURLToPath(new URL("../../../supabase", import.meta.url));
const files = readdirSync(`${root}/migrations`).filter((f) => f.endsWith(".sql")).sort();
const readMig = (f) => readFileSync(`${root}/migrations/${f}`, "utf8");
const migrationSql = () => files.map(readMig).join("\n");
const SEED = readFileSync(`${root}/seed.sql`, "utf8");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + extra}`); };

const ENV_SQL = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

const db = new PGlite();
await db.exec(ENV_SQL);
await db.exec(migrationSql());
await db.exec(SEED);
const ADMIN = "00000000-0000-0000-0000-0000000000a1", CLIENT = "00000000-0000-0000-0000-0000000000c1";
await db.exec(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@example.test'), ('${CLIENT}', 'cliente@example.test');
               insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin');`);

const as = async (role, sub = "") => { await db.exec("reset role"); if (role) await db.exec(`set role ${role}`); await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]); };
const A = async (sql, p = []) => (await db.query(sql, p)).rows;
const fails = async (sql, re = /permission denied|row-level security|réservé aux administrateurs|ajout seul|violates check/i) => {
  try { await db.query(sql); return false; } catch (e) { return re.test(e.message) ? true : "autre erreur: " + e.message; }
};
const create = async (o = {}) => {
  const a = { id: "savon-test", sku: "sav-001", name: "Savon test", category: "Nettoyants", price: 6000, cost: 3500, threshold: 5, qty: 10, image: null, ...o };
  return (await A(`select public.admin_create_product($1,$2,$3,$4,'','',null,null,null,$5,$6,$7,$8,$9,true) as r`,
    [a.id, a.sku, a.name, a.category, a.image, a.price, a.cost, a.threshold, a.qty]))[0].r;
};

await as("authenticated", ADMIN);
await create();

// --- 1. Droits effectifs ----------------------------------------------------------------------------------
await as(null);
const TABLES = ["products", "product_costs", "stock_movements"];
const tpriv = async (role, t, priv) => (await A("select has_table_privilege($1, $2, $3) as v", [role, "public." + t, priv]))[0].v;
const grid = {};
for (const role of ["anon", "authenticated", "service_role"]) for (const t of TABLES) {
  grid[role + "." + t] = (await Promise.all(["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"].map(async (x) => (await tpriv(role, t, x)) ? x : null))).filter(Boolean).join("/") || "-";
}
console.log("INFO  droits effectifs sur les tables :", JSON.stringify(grid));
ok("anon : aucun droit au niveau table sur les trois tables (products : colonnes seulement, voir plus bas)",
  TABLES.every((t) => grid["anon." + t] === "-"), JSON.stringify(grid));
// --- Colonnes visibles par un visiteur ---
const PUBLIC_COLS = ["id", "name", "category", "short_description", "description", "features", "usage_tips", "volume", "image_url", "sale_price", "stock_qty"];
const HIDDEN_COLS = ["sku", "low_stock_threshold", "is_demo", "active", "created_at", "updated_at"];
const colPriv = async (role, c, priv) => (await A("select has_column_privilege($1, 'public.products', $2, $3) as v", [role, c, priv]))[0].v;
ok("anon : peut lire exactement les 11 colonnes publiques", (await Promise.all(PUBLIC_COLS.map((c) => colPriv("anon", c, "SELECT")))).every(Boolean));
ok("anon : ne peut lire ni sku, ni seuil d'alerte, ni is_demo, ni active, ni dates", (await Promise.all(HIDDEN_COLS.map((c) => colPriv("anon", c, "SELECT")))).every((v) => v === false));
ok("anon : aucun droit d'écriture sur aucune colonne de products", (await Promise.all(["id", ...PUBLIC_COLS, ...HIDDEN_COLS].flatMap((c) => ["INSERT", "UPDATE"].map((x) => colPriv("anon", c, x))))).every((v) => v === false));
ok("authenticated : peut lire exactement les mêmes 11 colonnes publiques, et aucune autre",
  (await Promise.all(PUBLIC_COLS.map((c) => colPriv("authenticated", c, "SELECT")))).every(Boolean)
  && (await Promise.all(HIDDEN_COLS.map((c) => colPriv("authenticated", c, "SELECT")))).every((v) => v === false));
ok("authenticated : aucun droit d'écriture sur aucune colonne de products", (await Promise.all(["id", ...PUBLIC_COLS, ...HIDDEN_COLS].flatMap((c) => ["INSERT", "UPDATE"].map((x) => colPriv("authenticated", c, x))))).every((v) => v === false));
await as("anon");
const pub = await A("select " + PUBLIC_COLS.join(", ") + " from public.products");
ok("anon : une requête avec les colonnes publiques fonctionne et ne renvoie que les produits actifs (RLS compatible avec les droits par colonne)",
  pub.length === 1 && pub[0].id === "savon-test", JSON.stringify(pub.map((x) => x.id)));
ok("anon : requête sans filtre « actif » et tri par colonne publique acceptés", (await A("select id, name, sale_price, stock_qty from public.products order by name")).length === 1);
for (const c of ["sku", "low_stock_threshold", "is_demo", "active", "created_at", "updated_at"]) {
  ok(`anon : lecture de la colonne ${c} refusée`, (await fails(`select ${c} from public.products`)) === true);
}
ok("anon : « select * » refusé (les requêtes publiques doivent nommer leurs colonnes)", (await fails("select * from public.products")) === true);
ok("anon : filtrer sur la colonne active est refusé (la RLS s'en charge)", (await fails("select id from public.products where active")) === true);
await as(null);
ok("authenticated : products sans droit au niveau table (colonnes seulement) ; lecture seule sur product_costs et stock_movements (RLS : administrateur)",
  grid["authenticated.products"] === "-" && grid["authenticated.product_costs"] === "SELECT" && grid["authenticated.stock_movements"] === "SELECT", JSON.stringify(grid));
ok("aucun droit accordé à PUBLIC sur ces tables ni sur la séquence", (await A(
  `select count(*)::int n from pg_class c, aclexplode(c.relacl) a where c.oid = any(array['public.products'::regclass,'public.product_costs'::regclass,'public.stock_movements'::regclass,'public.stock_movements_id_seq'::regclass]) and a.grantee = 0`))[0].n === 0);
ok("anon et authenticated n'ont aucun droit sur la séquence du journal",
  !(await A("select has_sequence_privilege('anon','public.stock_movements_id_seq','usage') or has_sequence_privilege('authenticated','public.stock_movements_id_seq','usage') as v"))[0].v);
ok("les rôles applicatifs ne sont pas propriétaires des tables (pas de contournement de la RLS)", (await A(
  `select count(*)::int n from pg_class c join pg_roles r on r.oid = c.relowner where c.oid = any(array['public.products'::regclass,'public.product_costs'::regclass,'public.stock_movements'::regclass]) and r.rolname in ('anon','authenticated','service_role')`))[0].n === 0);
ok("RLS activée sur les trois tables ; anon et authenticated n'ont pas BYPASSRLS",
  (await A("select count(*)::int n from pg_roles where rolname in ('anon','authenticated') and rolbypassrls"))[0].n === 0
  && (await A("select bool_and(relrowsecurity) v from pg_class where oid = any(array['public.products'::regclass,'public.product_costs'::regclass,'public.stock_movements'::regclass])"))[0].v === true);

const fnrows = await A(`select p.proname, p.prosecdef, coalesce(p.proconfig, '{}') @> array['search_path=""'] as safe_path,
    (select coalesce(array_agg(distinct case when a.grantee = 0 then 'PUBLIC' else (select rolname from pg_roles where oid = a.grantee) end), '{}')
       from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.privilege_type = 'EXECUTE') as grantees
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proname in ('admin_create_product','admin_update_product','admin_set_product_image','check_product','touch_updated_at','stock_movements_append_only')`);
console.log("INFO  droits d'exécution :", JSON.stringify(fnrows.map((f) => [f.proname, f.grantees])));
const owner = (await A("select current_user as u"))[0].u;
// service_role (clé serveur, contourne la RLS de toute façon) garde l'exécution par défaut de Supabase : toléré, jamais exposé au navigateur.
const only = (f, roles) => f.grantees.filter((g) => g !== owner && g !== "service_role").sort().join() === roles.slice().sort().join();
ok("toutes les fonctions fixent search_path = ''", fnrows.length === 6 && fnrows.every((f) => f.safe_path), JSON.stringify(fnrows.map((f) => [f.proname, f.safe_path])));
ok("admin_update_product n'accepte pas de photo (13 paramètres, aucun p_image_url) ; admin_set_product_image reste le seul moyen de la changer",
  (await A("select pg_get_function_arguments(p.oid) as a from pg_proc p where p.proname = 'admin_update_product'"))[0].a.split(",").length === 13
  && !(await A("select pg_get_function_arguments(p.oid) as a from pg_proc p where p.proname = 'admin_update_product'"))[0].a.includes("image")
  && /image_url\s*=\s*p_image_url/.test(readMig("20261026000000_products_catalog.sql").split("create function public.admin_update_product")[1].split("create function public.admin_set_product_image")[0]) === false);
ok("les 3 fonctions d'administration sont SECURITY DEFINER, exécutables par authenticated seulement (ni PUBLIC, ni anon)",
  fnrows.filter((f) => f.proname.startsWith("admin_")).length === 3 && fnrows.filter((f) => f.proname.startsWith("admin_")).every((f) => f.prosecdef && only(f, ["authenticated"])),
  JSON.stringify(fnrows.filter((f) => f.proname.startsWith("admin_")).map((f) => f.grantees)));
ok("les fonctions privées (validation, déclencheurs) ne sont exécutables par aucun rôle applicatif",
  fnrows.filter((f) => !f.proname.startsWith("admin_")).every((f) => only(f, [])), JSON.stringify(fnrows.filter((f) => !f.proname.startsWith("admin_")).map((f) => [f.proname, f.grantees])));

// --- 1 bis. Matrice des requêtes : anon, compte connecté NON administrateur, administrateur -----------------------------
await as("authenticated", ADMIN);
await db.query("select public.admin_create_product('produit-cache','CACHE-1','Produit caché','Cat','','',null,null,null,null,900,null,2,4,false)");
const ACTORS = [["anon", "", "anon"], ["authenticated", CLIENT, "compte connecté non administrateur"], ["authenticated", ADMIN, "administrateur"]];
const PUB_LIST = PUBLIC_COLS.join(", ");
for (const [role, sub, lbl] of ACTORS) {
  await as(role, sub);
  const rows = await A(`select ${PUB_LIST} from public.products order by name`);
  ok(`[${lbl}] requête publique (colonnes nommées) : seulement les produits actifs`, rows.map((x) => x.id).join() === "savon-test", JSON.stringify(rows.map((x) => x.id)));
  ok(`[${lbl}] comptage (équivalent PostgREST count=exact) autorisé et limité aux produits actifs`, (await A("select count(*)::int n from public.products"))[0].n === 1);
  ok(`[${lbl}] « select * » refusé`, (await fails("select * from public.products")) === true);
  for (const c of ["sku", "low_stock_threshold", "is_demo", "active", "created_at", "updated_at"]) {
    ok(`[${lbl}] colonne ${c} refusée sur la table`, (await fails(`select ${c} from public.products`)) === true);
  }
  ok(`[${lbl}] filtre sur la colonne active refusé (la RLS s'en charge)`, (await fails("select id from public.products where active")) === true);
}
// Jointure du journal avec le nom du produit (colonne publique) : lignes du journal visibles de l'administrateur seulement.
await as("authenticated", ADMIN);
ok("[administrateur] jointure journal + nom du produit (colonne publique) autorisée", (await A("select m.product_id, p.name from public.stock_movements m join public.products p on p.id = m.product_id")).length >= 1);
await as("authenticated", CLIENT);
ok("[compte connecté non administrateur] même jointure : aucune ligne du journal", (await A("select m.product_id, p.name from public.stock_movements m join public.products p on p.id = m.product_id")).length === 0);

// Requêtes de gestion : admin_list_products
await as("anon");
ok("[anon] admin_list_products refusée (fonction fermée)", (await fails("select * from public.admin_list_products()")) === true);
await as("authenticated", CLIENT);
ok("[compte connecté non administrateur] admin_list_products refusée par le contrôle du rôle", (await fails("select * from public.admin_list_products()", /réservé aux administrateurs/)) === true);
await as("authenticated", ADMIN);
const full = await A("select * from public.admin_list_products()");
ok("[administrateur] admin_list_products : tous les produits, inactifs compris", full.map((x) => x.id).sort().join() === "produit-cache,savon-test", JSON.stringify(full.map((x) => x.id)));
const hidden = full.find((x) => x.id === "produit-cache");
ok("[administrateur] admin_list_products : référence, seuil, statut, démonstration, dates, stock et prix disponibles ; coût inconnu = null",
  hidden.sku === "CACHE-1" && hidden.cost_price === null && hidden.low_stock_threshold === 2 && hidden.active === false && hidden.is_demo === false
  && hidden.created_at instanceof Date && hidden.updated_at instanceof Date && hidden.stock_qty === 4 && hidden.sale_price === 900, JSON.stringify(hidden));
ok("[administrateur] admin_list_products : prix d'achat renvoyé quand il est connu", full.find((x) => x.id === "savon-test").cost_price === 3500);
ok("[administrateur] lit product_costs et stock_movements en entier", (await A("select count(*)::int n from public.product_costs"))[0].n === 1 && (await A("select count(*)::int n from public.stock_movements"))[0].n === 2);
await as("authenticated", CLIENT);
ok("[compte connecté non administrateur] product_costs et stock_movements : aucune ligne (RLS)", (await A("select count(*)::int n from public.product_costs"))[0].n === 0 && (await A("select count(*)::int n from public.stock_movements"))[0].n === 0);
await as("anon");
ok("[anon] product_costs et stock_movements : refusé", (await fails("select count(*) from public.product_costs")) === true && (await fails("select count(*) from public.stock_movements")) === true);

// Requêtes de gestion : création, modification, photo
await as("anon");
ok("[anon] création, modification et photo refusées", (await fails("select public.admin_create_product('x-1','XX1','Nom','Cat','','',null,null,null,null,1,null,0,0,true)")) === true
  && (await fails("select public.admin_update_product('savon-test','SAV-001','Nom','Cat','','',null,null,null,1,null,0,true)")) === true
  && (await fails("select public.admin_set_product_image('savon-test', null)")) === true);
await as("authenticated", CLIENT);
ok("[compte connecté non administrateur] création, modification et photo refusées",
  (await fails("select public.admin_create_product('x-2','XX2','Nom','Cat','','',null,null,null,null,1,null,0,0,true)", /réservé aux administrateurs/)) === true
  && (await fails("select public.admin_update_product('savon-test','SAV-001','Nom','Cat','','',null,null,null,1,null,0,true)", /réservé aux administrateurs/)) === true
  && (await fails("select public.admin_set_product_image('savon-test', null)", /réservé aux administrateurs/)) === true);
await as("authenticated", ADMIN);
const upd = (await A("select public.admin_update_product('produit-cache','CACHE-1','Produit caché','Cat','','',null,null,null,900,350,2,true) as r"))[0].r;
const reactivated = await A("select id, sale_price from public.products where id = 'produit-cache'");
ok("[administrateur] modification + réactivation : le produit apparaît dans la table publique", upd.ok === true && reactivated.length === 1 && reactivated[0].sale_price === 900);
ok("[administrateur] prix d'achat enregistré par la modification (visible via admin_list_products)", (await A("select cost_price from public.admin_list_products() where id = 'produit-cache'"))[0].cost_price === 350);
await db.query("select public.admin_update_product('produit-cache','CACHE-1','Produit caché','Cat','','',null,null,null,900,350,2,false)");
await as(null);

// --- 2. Contournements du journal et du stock -------------------------------------------------------------------
for (const [role, sub, lbl] of [["anon", "", "anon"], ["authenticated", ADMIN, "authenticated (admin)"], ["authenticated", CLIENT, "authenticated (non admin)"]]) {
  await as(role, sub);
  ok(`${lbl} : aucune écriture directe sur stock_movements (INSERT, UPDATE, DELETE, TRUNCATE)`,
    (await fails("insert into public.stock_movements (product_id,type,quantity,stock_after) values ('savon-test','adjustment',1,11)")) === true
    && (await fails("update public.stock_movements set quantity = 1")) === true && (await fails("delete from public.stock_movements")) === true
    && (await fails("truncate public.stock_movements")) === true);
  ok(`${lbl} : aucune écriture directe sur le stock ni sur les coûts`,
    (await fails("update public.products set stock_qty = stock_qty + 1")) === true
    && (await fails("insert into public.product_costs (product_id,cost_price) values ('savon-test',1)")) === true
    && (await fails("update public.product_costs set cost_price = 1")) === true && (await fails("delete from public.product_costs")) === true);
  ok(`${lbl} : impossible de désactiver ou supprimer le déclencheur du journal`,
    (await fails("alter table public.stock_movements disable trigger stock_movements_no_change", /must be owner|permission denied/i)) === true
    && (await fails("drop trigger stock_movements_no_change on public.stock_movements", /must be owner|permission denied/i)) === true
    && (await fails("alter table public.stock_movements disable trigger all", /must be owner|permission denied/i)) === true);
  ok(`${lbl} : impossible de contourner les déclencheurs (session_replication_role)`,
    (await fails("set session_replication_role = replica", /permission denied/i)) === true);
}
await as("service_role");
ok("service_role (clé serveur, jamais dans le navigateur) : UPDATE, DELETE et TRUNCATE du journal bloqués par le déclencheur",
  (await fails("update public.stock_movements set quantity = 1", /ajout seul/)) === true && (await fails("delete from public.stock_movements", /ajout seul/)) === true
  && (await fails("truncate public.stock_movements", /ajout seul/)) === true);
console.log("INFO  limite connue : service_role (clé serveur) et le propriétaire de la base peuvent INSÉRER directement dans le journal et dans les tables ; seul le déclencheur protège l'historique existant.");

// --- 3. Validations ------------------------------------------------------------------------------------------------
await as("authenticated", ADMIN);
for (const [label, o] of [["prix de vente > 100 000 000", { id: "p-big", sku: "BIG1", price: 100000001 }], ["prix de vente négatif", { id: "p-neg", sku: "NEG1", price: -1 }],
  ["prix d'achat négatif", { id: "p-neg2", sku: "NEG2", cost: -1 }], ["identifiant de 61 caractères", { id: "a".repeat(61), sku: "LNG1" }],
  ["identifiant avec majuscule", { id: "Majuscule", sku: "MAJ1" }], ["identifiant avec espace", { id: "a b", sku: "SPC1" }],
  ["nom de 121 caractères", { id: "p-nom2", sku: "NOM2", name: "x".repeat(121) }], ["référence de 41 caractères", { id: "p-sku2", sku: "A".repeat(41) }],
  ["référence avec espace", { id: "p-sku3", sku: "A B" }], ["catégorie vide", { id: "p-cat", sku: "CAT1", category: " " }],
  ["stock initial négatif", { id: "p-qty0", sku: "QTY0", qty: -1 }], ["stock initial > 1 000 000", { id: "p-qty", sku: "QTY1", qty: 1000001 }],
  ["photo en javascript:", { id: "p-js", sku: "JS1", image: "javascript:alert(1)" }]]) {
  const x = await create(o);
  ok(`refusé : ${label}`, x.ok === false && x.code === "invalid_input", JSON.stringify(x));
}
let r = await create({ id: "ok-minuscule", sku: "ok-min.2_x" });
ok("référence en minuscules acceptée et normalisée en majuscules", r.ok === true && (await A("select sku from public.admin_list_products() where id = 'ok-minuscule'"))[0].sku === "OK-MIN.2_X", JSON.stringify(r));
await as(null);
ok("les contraintes de la table refusent aussi un prix négatif ou un stock négatif (même pour le propriétaire)",
  (await fails("insert into public.products (id,sku,name,category,sale_price) values ('zz-1','ZZ1','Nom','Cat',-1)", /violates check/i)) === true
  && (await fails("update public.products set stock_qty = -1 where id = 'savon-test'", /violates check/i)) === true);

// --- 6. Limites documentées du journal (pas d'immutabilité absolue) ---------------------------------------------------
const migText = readMig("20261026000000_products_catalog.sql");
ok("la migration documente que la protection du journal n'est pas absolue (propriétaire, superutilisateur, service_role)",
  /n'est PAS une garantie absolue/.test(migText) && /propriétaire de la base/.test(migText) && /superutilisateur/.test(migText) && /service_role/.test(migText));
await as(null);
let ownerCanDisable = true;
try { await db.exec("alter table public.stock_movements disable trigger stock_movements_no_change"); await db.exec("alter table public.stock_movements enable trigger stock_movements_no_change"); } catch { ownerCanDisable = false; }
ok("limite vérifiée : le propriétaire/superutilisateur PEUT désactiver le déclencheur (aucune immutabilité absolue)", ownerCanDisable === true);
await as("service_role");
ok("limite vérifiée : service_role peut insérer directement dans le journal (accès serveur)",
  (await fails("insert into public.stock_movements (product_id,type,quantity,stock_after,reason) values ('savon-test','adjustment',1,11,'test serveur')")) === false);
await as(null);
await db.exec("delete from public.stock_movements where reason = 'test serveur'").catch(() => {});

// --- 7. Fonctions SECURITY DEFINER : droits du propriétaire, contrôle du rôle, absence d'effet de bord -------------------
ok("les fonctions d'administration appartiennent au propriétaire des tables (leurs droits d'écriture viennent de là, pas du client)", (await A(
  `select count(*)::int n from pg_proc p join pg_class c on c.relname = 'products' and c.relnamespace = 'public'::regnamespace
     where p.proname in ('admin_create_product','admin_update_product','admin_set_product_image') and p.proowner = c.relowner`))[0].n === 3);
const counts = async () => (await A("select (select count(*) from public.products)::int p, (select count(*) from public.product_costs)::int c, (select count(*) from public.stock_movements)::int m"))[0];
const c0 = await counts();
await as("authenticated", CLIENT);
await fails("select public.admin_create_product('intrus-1','INTRUS1','Intrus','Cat','','',null,null,null,null,1,1,0,5,true)", /réservé aux administrateurs/);
await fails("select public.admin_update_product('savon-test','SAV-001','Pirate','Cat','','',null,null,null,1,1,0,true)", /réservé aux administrateurs/);
await fails("select public.admin_set_product_image('savon-test','https://exemple.test/x.webp')", /réservé aux administrateurs/);
await as("service_role");
ok("service_role sans session utilisateur : refusé (le rôle admin est vérifié via auth.uid(), pas via la clé)",
  (await fails("select public.admin_create_product('intrus-2','INTRUS2','Intrus','Cat','','',null,null,null,null,1,1,0,5,true)", /réservé aux administrateurs/)) === true);
await as(null);
const c1 = await counts();
ok("tentatives non autorisées : aucune ligne créée ni modifiée (produits, coûts, mouvements)", JSON.stringify(c0) === JSON.stringify(c1), JSON.stringify([c0, c1]));
ok("savon-test inchangé après les tentatives non autorisées", (await A("select name, image_url from public.products where id = 'savon-test'"))[0].name === "Savon test"
  && (await A("select image_url from public.products where id = 'savon-test'"))[0].image_url === null);
ok("un mouvement de quantité 0 est impossible (contrainte)", (await fails("insert into public.stock_movements (product_id,type,quantity,stock_after) values ('savon-test','adjustment',0,10)", /violates check/i)) === true);

// --- 4. La migration ne modifie aucun objet existant ------------------------------------------------------------------
const mig = readMig("20261026000000_products_catalog.sql").replace(/--.*$/gm, "");
ok("le fichier de migration n'altère aucune table existante, ne supprime rien et ne touche ni à Storage, ni aux réservations, ni à WhatsApp",
  !/\balter\s+table\b/i.test(mig.replace(/alter\s+table\s+public\.(products|product_costs|stock_movements)\s+enable\s+row\s+level\s+security/gi, ""))
  && !/\bdrop\b/i.test(mig) && !/storage\./i.test(mig) && !/bookings|whatsapp|salon_settings|user_roles|time_slots|public\.services/i.test(mig), "motif interdit trouvé");
const snap = async (d) => {
  const q = async (sql) => (await d.query(sql)).rows;
  const old = "('services','time_slots','salon_settings','profiles','user_roles','bookings','rate_limits')";
  return JSON.stringify({
    cols: await q(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_name in ${old} order by 1, 2`),
    pols: await q(`select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where tablename in ${old} order by 1, 2`),
    grants: await q(`select table_schema, table_name, grantee, privilege_type from information_schema.table_privileges where table_name in ${old} order by 1, 2, 3, 4`),
    colgrants: await q(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges where table_name = 'bookings' and grantee in ('anon','authenticated') order by 1, 2, 3, 4`),
    fns: await q(`select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as def, p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.proname in ('create_booking','get_booking','cancel_booking','get_availability','has_role','is_admin','normalize_phone','err','client_ip','rate_limit_hit','bookings_status_guard') order by 1`),
    enums: await q(`select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) as labels from pg_type t join pg_enum e on e.enumtypid = t.oid where t.typname in ('booking_status','app_role','service_category') group by 1 order by 1`),
    triggers: await q(`select tgname, tgrelid::regclass::text as t from pg_trigger where not tgisinternal and tgrelid::regclass::text in ('public.bookings','public.services','public.salon_settings') order by 1`),
    counts: await q(`select (select count(*) from public.services)::int s, (select count(*) from public.time_slots)::int t, (select count(*) from public.salon_settings)::int c, (select count(*) from public.bookings)::int b`),
  });
};
const base = new PGlite();
await base.exec(ENV_SQL);
await base.exec(readMig(files[0]));
await base.exec(SEED);
const before = await snap(base);
// Migrations des produits et des catégories de produits seulement : 20261028 (catégories de prestations) transforme VOLONTAIREMENT services.category
// (enum -> texte relié) ; sa non-régression est vérifiée par service-categories.mjs.
for (const f of files.slice(1).filter((x) => x < "20261028")) await base.exec(readMig(f));
const after = await snap(base);
ok("colonnes, politiques, droits, fonctions, énumérations, déclencheurs et données existants strictement identiques après les migrations suivantes", before === after, "différence détectée");
await base.close();

// --- 5. Script d'import des produits de démonstration ---------------------------------------------------------------
const importSql = readFileSync(`${root}/data/import_static_products.sql`, "utf8");
ok("le script d'import ne contient ni DELETE, ni UPDATE, ni DROP, ni TRUNCATE, ni ALTER", !/\b(delete|update|drop|truncate|alter)\b/i.test(importSql.replace(/--.*$/gm, "")));
const imp = new PGlite();
await imp.exec(ENV_SQL);
await imp.exec(migrationSql());
await imp.exec(SEED);
const I = async (sql) => (await imp.query(sql)).rows;
await imp.exec(importSql);
let prods = await I("select id, sku, stock_qty, is_demo, active, image_url from public.products order by id");
ok("import : 6 produits de démonstration, tous is_demo, sans photo (repli sur l'image locale)", prods.length === 6 && prods.every((x) => x.is_demo && x.image_url === null), JSON.stringify(prods));
ok("import : stocks de démonstration conservés (20, 15, 12, 10, 8, 0)",
  JSON.stringify(Object.fromEntries(prods.map((x) => [x.id, x.stock_qty]))) === JSON.stringify({ "coffret-routine": 0, "gel-douche": 12, "huile-caviar": 10, "mousse-nettoyante": 15, "savon-cristal": 8, "savon-melisse-2en1": 20 }));
const mvs = await I("select product_id, type, quantity, stock_after from public.stock_movements order by product_id");
ok("import : un mouvement « initial » par produit en stock (5), aucun pour le coffret à 0", mvs.length === 5 && mvs.every((m) => m.type === "initial" && m.quantity === m.stock_after) && !mvs.some((m) => m.product_id === "coffret-routine"));
ok("import : aucun prix d'achat inventé", (await I("select count(*)::int n from public.product_costs"))[0].n === 0);
await imp.exec("update public.products set name = 'Nom modifié par l''admin', sale_price = 7777, stock_qty = 5, active = false where id = 'gel-douche'");
await imp.exec(importSql);
await imp.exec(importSql);
prods = await I("select id, name, sale_price, stock_qty, active from public.products order by id");
ok("rejeu x2 : toujours 6 produits, aucun doublon", prods.length === 6);
ok("rejeu : les modifications existantes ne sont pas écrasées",
  JSON.stringify(prods.find((x) => x.id === "gel-douche")) === JSON.stringify({ id: "gel-douche", name: "Nom modifié par l'admin", sale_price: 7777, stock_qty: 5, active: false }));
ok("rejeu : aucun mouvement de stock en double", (await I("select count(*)::int n from public.stock_movements"))[0].n === 5);
await imp.exec("delete from public.stock_movements where false");
const conflict = new PGlite();
await conflict.exec(ENV_SQL);
await conflict.exec(migrationSql());
await conflict.exec("insert into public.products (id, sku, name, category, sale_price, stock_qty) values ('mon-savon', 'DAL-SAV-MEL', 'Mon propre savon', 'Nettoyants', 1, 3)");
await conflict.exec(importSql);
const cp = (await conflict.query("select id, name, stock_qty from public.products where sku = 'DAL-SAV-MEL'")).rows;
ok("référence déjà utilisée par un autre produit : ni doublon ni remplacement, les 5 autres produits sont importés",
  cp.length === 1 && cp[0].id === "mon-savon" && (await conflict.query("select count(*)::int n from public.products")).rows[0].n === 6);
await imp.close();
await conflict.close();

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
