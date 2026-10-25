// Étape 1 (boutique) : catalogue de produits, prix d'achat, journal du stock, fonctions d'administration et RLS.
// Base PostgreSQL locale en mémoire (PGlite) : aucune connexion au projet Supabase distant.
// Exécution : bun run test:sql:products
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

const ADMIN = "00000000-0000-0000-0000-0000000000a1", CLIENT = "00000000-0000-0000-0000-0000000000c1";
await db.exec(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@example.test'), ('${CLIENT}', 'cliente@example.test');
               insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin');`);

const as = async (role, sub = "") => { await db.exec("reset role"); if (role) await db.exec(`set role ${role}`); await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]); };
const A = async (sql, p = []) => (await db.query(sql, p)).rows;
// Lecture complète d'un produit par l'administrateur : via admin_list_products() (la table n'expose que les colonnes publiques).
const adminProduct = async (id) => (await A("select * from public.admin_list_products() where id = $1", [id]))[0];
const fails = async (sql, p = [], re = /permission denied|row-level security|réservé aux administrateurs|ajout seul|violates check/i) => {
  try { await db.query(sql, p); return false; } catch (e) { return re.test(e.message) ? true : "autre erreur: " + e.message; }
};
const create = async (o = {}) => {
  const a = { id: "savon-test", sku: "sav-001", name: "Savon test", category: "Nettoyants", short: "Court", description: "Long", features: ["Pot"],
    usage: null, volume: "200 ml", image: null, price: 6000, cost: 3500, threshold: 5, qty: 10, active: true, ...o };
  return (await A(`select public.admin_create_product($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) as r`,
    [a.id, a.sku, a.name, a.category, a.short, a.description, a.features, a.usage, a.volume, a.image, a.price, a.cost, a.threshold, a.qty, a.active]))[0].r;
};
const update = async (id, o = {}) => {
  const a = { sku: "SAV-001", name: "Savon test", category: "Nettoyants", short: "Court", description: "Long", features: ["Pot"],
    usage: null, volume: "200 ml", price: 6000, cost: 3500, threshold: 5, active: true, ...o };
  return (await A(`select public.admin_update_product($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as r`,
    [id, a.sku, a.name, a.category, a.short, a.description, a.features, a.usage, a.volume, a.price, a.cost, a.threshold, a.active]))[0].r;
};

// --- 1. Visiteur anonyme --------------------------------------------------------
await as(null);
const before = (await A("select (select count(*) from public.bookings)::int b, (select count(*) from public.services)::int s"))[0];
await as("anon");
ok("anon lit les produits (aucun au départ)", (await A("select count(*)::int n from public.products"))[0].n === 0);
ok("anon ne lit pas product_costs", (await fails("select * from public.product_costs")) === true);
ok("anon ne lit pas stock_movements", (await fails("select * from public.stock_movements")) === true);
ok("anon ne peut pas créer un produit (fonction fermée)", (await fails("select public.admin_create_product('x-y','AB','Nom','Cat','','',null,null,null,null,1,null,0,0,true)")) === true);
ok("anon n'écrit pas dans products", (await fails("insert into public.products (id,sku,name,category,sale_price) values ('aa-bb','AB','Nom','Cat',1)")) === true);

// --- 2. Compte connecté sans le rôle admin -----------------------------------------
await as("authenticated", CLIENT);
ok("non-admin : création refusée par la fonction", (await fails("select public.admin_create_product('x-y','AB','Nom','Cat','','',null,null,null,null,1,null,0,0,true)", [], /réservé aux administrateurs/)) === true);
ok("non-admin : modification refusée", (await fails("select public.admin_update_product('x-y','AB','Nom','Cat','','',null,null,null,1,null,0,true)", [], /réservé aux administrateurs/)) === true);
ok("non-admin : changement de photo refusé", (await fails("select public.admin_set_product_image('x-y', null)", [], /réservé aux administrateurs/)) === true);
ok("non-admin : écriture directe refusée", (await fails("update public.products set stock_qty = 5")) === true);

// --- 3. Administrateur : création -----------------------------------------------------
await as("authenticated", ADMIN);
let r = await create();
ok("admin : création d'un produit avec stock initial", r.ok === true && r.id === "savon-test", JSON.stringify(r));
let p = await adminProduct("savon-test");
ok("référence enregistrée en majuscules, stock = stock initial", p.sku === "SAV-001" && p.stock_qty === 10 && p.low_stock_threshold === 5 && p.active === true);
const mv = await A("select type, quantity, stock_after, created_by from public.stock_movements where product_id = 'savon-test'");
ok("un mouvement « initial » trace le stock de départ (avec l'administrateur)", mv.length === 1 && mv[0].type === "initial" && mv[0].quantity === 10 && mv[0].stock_after === 10 && mv[0].created_by === ADMIN, JSON.stringify(mv));
ok("le prix d'achat est enregistré (visible de l'administrateur)", (await A("select cost_price from public.product_costs where product_id = 'savon-test'"))[0]?.cost_price === 3500);

r = await create({ id: "autre-produit" });
ok("référence déjà utilisée refusée", r.ok === false && r.code === "sku_taken", JSON.stringify(r));
r = await create({ sku: "SAV-002" });
ok("identifiant déjà utilisé refusé", r.ok === false && r.code === "id_taken", JSON.stringify(r));
for (const [label, o] of [["prix de vente négatif", { id: "p-neg", sku: "NEG1", price: -1 }], ["prix d'achat négatif", { id: "p-neg2", sku: "NEG2", cost: -5 }],
  ["stock initial négatif", { id: "p-neg3", sku: "NEG3", qty: -1 }], ["seuil négatif", { id: "p-neg4", sku: "NEG4", threshold: -1 }],
  ["nom trop court", { id: "p-nom", sku: "NOM1", name: "A" }], ["identifiant invalide", { id: "Mauvais Id", sku: "ID1" }],
  ["référence invalide", { id: "p-sku", sku: "a b" }], ["photo non https", { id: "p-img", sku: "IMG1", image: "http://x/y.webp" }]]) {
  const x = await create(o);
  ok(`refusé : ${label}`, x.ok === false && x.code === "invalid_input", JSON.stringify(x));
}
ok("aucun produit invalide n'a été créé", (await A("select count(*)::int n from public.admin_list_products()"))[0].n === 1);
r = await create({ id: "sans-stock", sku: "SS-1", qty: 0, cost: null });
ok("stock initial 0 : produit créé sans mouvement ni coût", r.ok === true
  && (await A("select count(*)::int n from public.stock_movements where product_id = 'sans-stock'"))[0].n === 0
  && (await A("select count(*)::int n from public.product_costs where product_id = 'sans-stock'"))[0].n === 0);

// --- 4. Administrateur : modification ---------------------------------------------------
const created = (await adminProduct("savon-test")).updated_at;
await new Promise((res) => setTimeout(res, 15));
r = await update("savon-test", { name: "Savon renommé", price: 6500, cost: 4000, threshold: 8 });
p = await adminProduct("savon-test");
ok("admin : modification des champs", r.ok === true && p.name === "Savon renommé" && p.sale_price === 6500 && p.low_stock_threshold === 8, JSON.stringify(r));
ok("la modification ne touche pas au stock", p.stock_qty === 10 && (await A("select count(*)::int n from public.stock_movements where product_id = 'savon-test'"))[0].n === 1);
ok("updated_at est mis à jour", new Date(p.updated_at) > new Date(created));
ok("prix d'achat modifié", (await A("select cost_price from public.product_costs where product_id = 'savon-test'"))[0].cost_price === 4000);
await update("savon-test", { name: "Savon renommé", cost: null });
ok("prix d'achat effacé = coût inconnu", (await A("select count(*)::int n from public.product_costs where product_id = 'savon-test'"))[0].n === 0);
r = await update("inconnu");
ok("produit inconnu : not_found", r.ok === false && r.code === "not_found", JSON.stringify(r));
r = await update("sans-stock", { sku: "SAV-001" });
ok("modification vers une référence déjà prise refusée", r.ok === false && r.code === "sku_taken", JSON.stringify(r));
r = await update("savon-test", { price: -10 });
ok("modification avec prix négatif refusée", r.ok === false && r.code === "invalid_input");

// --- 5. Photo ---------------------------------------------------------------------------
const url = "https://ylixnbhpgbyofhvnfzqw.supabase.co/storage/v1/object/public/catalog-images/products/savon-test/1-a.webp";
r = (await A("select public.admin_set_product_image('savon-test', $1) as r", [url]))[0].r;
ok("admin : photo enregistrée", r.ok === true && (await adminProduct("savon-test")).image_url === url);
r = (await A("select public.admin_set_product_image('savon-test', 'javascript:alert(1)') as r"))[0].r;
ok("adresse de photo invalide refusée", r.ok === false && r.code === "invalid_input");
r = (await A("select public.admin_set_product_image('inconnu', null) as r"))[0].r;
ok("photo d'un produit inconnu : not_found", r.ok === false && r.code === "not_found");

// La photo ne change que par admin_set_product_image : aucune modification du produit ne peut l'effacer ni la remplacer.
const photoOf = async (id) => (await adminProduct(id)).image_url;
ok("la fonction de modification n'a plus de paramètre photo", !(await A("select pg_get_function_arguments(p.oid) as a from pg_proc p where p.proname = 'admin_update_product'"))[0].a.includes("image"));
r = await update("savon-test", { name: "Savon renommé encore", category: "Soins du corps", price: 7000, threshold: 9 });
ok("modifier le nom, la catégorie, le prix et le seuil conserve la photo", r.ok === true && (await photoOf("savon-test")) === url, JSON.stringify(r));
r = await update("savon-test", { name: "Savon renommé encore", category: "Soins du corps", active: false });
ok("désactiver le produit conserve la photo", r.ok === true && (await photoOf("savon-test")) === url);
r = await update("savon-test", { name: "Savon renommé encore", category: "Soins du corps", active: true, cost: null, usage: null, volume: null });
ok("effacer le coût, les conseils et la contenance conserve la photo", r.ok === true && (await photoOf("savon-test")) === url);
await update("savon-test", { name: "Savon test", category: "Nettoyants", price: 6000, threshold: 5 });
const url2 = "https://ylixnbhpgbyofhvnfzqw.supabase.co/storage/v1/object/public/catalog-images/products/savon-test/2-b.webp";
ok("la photo se remplace par admin_set_product_image", (await A("select public.admin_set_product_image('savon-test', $1) as r", [url2]))[0].r.ok === true && (await photoOf("savon-test")) === url2);
ok("la photo se supprime par admin_set_product_image(null), et seulement par elle", (await A("select public.admin_set_product_image('savon-test', null) as r"))[0].r.ok === true && (await photoOf("savon-test")) === null);
await A("select public.admin_set_product_image('savon-test', $1)", [url]);
ok("une validation échouée de la modification ne touche pas à la photo", (await update("savon-test", { price: -5 })).ok === false && (await photoOf("savon-test")) === url);

// --- 6. Désactivation et visibilité ---------------------------------------------------------
await update("sans-stock", { sku: "SS-1", name: "Produit test", active: false });
ok("admin voit les produits inactifs (via admin_list_products)", (await A("select count(*)::int n from public.admin_list_products()"))[0].n === 2);
ok("admin : la table elle-même n'expose que les produits actifs et les colonnes publiques", (await A("select id from public.products")).map((x) => x.id).join() === "savon-test");
await as("anon");
ok("anon ne voit que les produits actifs", (await A("select id from public.products")).map((x) => x.id).join() === "savon-test");
await as("authenticated", CLIENT);
ok("compte non admin ne voit que les produits actifs", (await A("select id from public.products")).map((x) => x.id).join() === "savon-test");
ok("compte non admin ne lit aucun prix d'achat (RLS)", (await A("select * from public.product_costs")).length === 0);
ok("compte non admin ne lit aucun mouvement de stock (RLS)", (await A("select * from public.stock_movements")).length === 0);

// --- 7. Intégrité du stock -------------------------------------------------------------------
await as("authenticated", ADMIN);
ok("admin ne peut pas écrire le stock directement", (await fails("update public.products set stock_qty = 999 where id = 'savon-test'")) === true);
ok("admin ne peut pas écrire un mouvement directement", (await fails("insert into public.stock_movements (product_id,type,quantity,stock_after) values ('savon-test','adjustment',5,15)")) === true);
ok("admin ne peut pas supprimer un produit", (await fails("delete from public.products where id = 'savon-test'")) === true);
ok("admin lit le journal du stock", (await A("select count(*)::int n from public.stock_movements"))[0].n === 1);
await as(null);
ok("stock jamais négatif (contrainte, même pour le propriétaire)", (await fails("update public.products set stock_qty = -1 where id = 'savon-test'", [], /violates check/i)) === true);
ok("journal en ajout seul : UPDATE refusé", (await fails("update public.stock_movements set quantity = 99", [], /ajout seul/)) === true);
ok("journal en ajout seul : DELETE refusé", (await fails("delete from public.stock_movements", [], /ajout seul/)) === true);
ok("journal en ajout seul : TRUNCATE refusé", (await fails("truncate public.stock_movements", [], /ajout seul/)) === true);

// --- 8. Réservations et catalogue de prestations inchangés -------------------------------------
const after = (await A("select (select count(*) from public.bookings)::int b, (select count(*) from public.services)::int s"))[0];
ok("réservations et prestations inchangées", before.b === after.b && before.s === after.s);

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
