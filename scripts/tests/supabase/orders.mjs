// Commandes de la boutique : droits, RLS, création transactionnelle, idempotence, stock, statuts, suivi invité.
// Base PostgreSQL locale en mémoire (PGlite) : aucune connexion au projet Supabase distant.
// Exécution : node scripts/tests/supabase/orders.mjs
// Limite : PGlite n'a qu'une connexion, les verrous entre transactions simultanées ne sont pas exercés ici (voir le rapport d'audit).
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
try { await db.exec(migrationSql()); ok("migrations (dont commandes) appliquées sur base vierge", true); }
catch (e) { ok("migrations (dont commandes) appliquées sur base vierge", false, e.message); process.exit(1); }
await db.exec(readFileSync(`${root}/seed.sql`, "utf8"));

const ADMIN = "00000000-0000-0000-0000-0000000000a1", CLIENT = "00000000-0000-0000-0000-0000000000c1";
await db.exec(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@example.test'), ('${CLIENT}', 'cliente@example.test');
               insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin');`);

const as = async (role, sub = "") => { await db.exec("reset role"); if (role) await db.exec(`set role ${role}`); await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]); };
const A = async (sql, p = []) => (await db.query(sql, p)).rows;
let ipN = 0;
const newIp = () => db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ "cf-connecting-ip": `ip-${++ipN}` })]);
const fails = async (sql, p = [], re = /permission denied|row-level security|réservé aux administrateurs|violates/i) => {
  try { await db.query(sql, p); return false; } catch (e) { return re.test(e.message) ? true : "autre erreur: " + e.message; }
};
const rpc = async (fn, args, freshIp = true) => { if (freshIp) await newIp(); const r = await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args); return r.rows[0].r; };
let keyN = 0;
const key = () => `test-key-${String(++keyN).padStart(8, "0")}-abcdef`;
let phN = 0;
const nextPhone = () => `07 00 72 ${String(Math.floor(++phN / 100)).padStart(2, "0")} ${String(phN % 100).padStart(2, "0")}`;
const base = { name: "Awa Koné", phone: "07 00 71 71 00", address: "Rue des Jardins", area: "Cocody", notes: "" };
const order = (items, o = {}, freshIp = true) => {
  const a = { ...base, phone: nextPhone(), key: key(), ...o };
  return rpc("create_store_order", [a.name, a.phone, a.address, a.area, a.notes, JSON.stringify(items), a.key], freshIp);
};
const stock = async (id) => (await A("select stock_qty from public.products where id = $1", [id]))[0].stock_qty;
const asAdmin = () => as("authenticated", ADMIN);
const setStatus = async (id, s, reason = "") => { await asAdmin(); const r = await rpc("admin_update_order_status", [id, s, reason]); return r; };

// --- Jeu de produits (créés par l'administrateur, avec stock initial journalisé) ------
await asAdmin();
const mk = (id, sku, price, qty, active = true) => A(`select public.admin_create_product($1,$2,$3,$4,'','',$5,null,null,null,$6,null,0,$7,$8) as r`,
  [id, sku, `Produit ${id}`, "Tests", [], price, qty, active]);
await mk("huile-test", "HUI-1", 8000, 5);
await mk("savon-test", "SAV-1", 6000, 3);
await mk("inactif-test", "INA-1", 1000, 5, false);
await mk("rupture-test", "RUP-1", 1000, 0);
await mk("stock-test", "STK-1", 1000, 100);

// --- 1. Droits ---------------------------------------------------------------------------
await as("anon");
for (const t of ["orders", "order_items"]) ok(`anon ne lit pas ${t}`, (await fails(`select * from public.${t}`)) === true);
ok("anon n'insère pas dans orders", (await fails(`insert into public.orders (order_number, customer_name, customer_phone, delivery_address, delivery_area, subtotal, idempotency_key) values ('CMD-AAAAAAAAAA','Test','0700717100','Rue','Zone',1,'abcdefghijklmnop')`)) === true);
ok("anon ne modifie ni ne supprime", (await fails(`update public.orders set status = 'delivered'`)) === true && (await fails(`delete from public.orders`)) === true);
ok("anon ne peut pas TRUNCATE orders", (await fails(`truncate public.orders cascade`)) === true);
ok("anon n'appelle pas private.order_json", (await fails(`select private.order_json(gen_random_uuid())`)) === true);
for (const f of ["admin_list_orders(null,10)", "admin_update_order_status(gen_random_uuid(),'confirmed','')", "admin_set_order_delivery_fee(gen_random_uuid(),0)"])
  ok(`anon n'exécute pas ${f.split("(")[0]}`, (await fails(`select public.${f}`)) === true);
await as(null);
const priv = (await A(`select has_function_privilege('anon','public.create_store_order(text,text,text,text,text,jsonb,text)','execute') c,
  has_function_privilege('anon','public.get_order(text,text)','execute') g,
  has_function_privilege('authenticated','public.admin_list_orders(public.order_status,integer)','execute') a`))[0];
ok("anon exécute create_store_order et get_order ; authenticated exécute les fonctions admin", priv.c && priv.g && priv.a);

// --- 2. Création ---------------------------------------------------------------------------
await as("anon");
const k1 = key();
let r = await order([{ product_id: "huile-test", quantity: 2 }, { product_id: "savon-test", quantity: 1 }], { key: k1, phone: base.phone });
ok("commande invitée créée", r.ok === true && r.replayed === false && /^CMD-[0-9A-F]{10}$/.test(r.order?.order_number), JSON.stringify(r));
const o1 = r.order;
ok("sous-total recalculé côté serveur (2×8000 + 6000 = 22000)", o1.subtotal === 22000 && o1.total_amount === 22000);
ok("livraison à confirmer (NULL) et statut pending", o1.delivery_fee === null && o1.status === "pending");
ok("lignes avec nom et prix instantanés", o1.items.length === 2 && o1.items.find((i) => i.product_id === "huile-test").unit_price === 8000 && o1.items.find((i) => i.product_id === "huile-test").line_total === 16000);
ok("la réponse n'expose ni user_id ni clé d'idempotence", !("user_id" in o1) && !("idempotency_key" in o1));
await as(null);
ok("stock décrémenté (5→3, 3→2)", (await stock("huile-test")) === 3 && (await stock("savon-test")) === 2);
const mv = await A(`select quantity, stock_after, type, ref_type, ref_id, created_by from public.stock_movements where ref_id = $1 order by product_id`, [o1.order_number]);
ok("journal stock : 2 mouvements 'sale' négatifs avec stock_after et référence", mv.length === 2 && mv.every((m) => m.type === "sale" && m.quantity < 0 && m.ref_type === "order" && m.created_by === null)
  && mv.find((m) => m.quantity === -2).stock_after === 3, JSON.stringify(mv));

// --- 3. Idempotence --------------------------------------------------------------------------
await as("anon");
r = await order([{ product_id: "huile-test", quantity: 2 }, { product_id: "savon-test", quantity: 1 }], { key: k1 });
ok("même clé : commande rejouée, même numéro", r.ok === true && r.replayed === true && r.order.order_number === o1.order_number, JSON.stringify(r));
r = await order([{ product_id: "huile-test", quantity: 1 }], { key: k1 });
ok("même clé avec un autre panier : renvoie l'ancienne commande, ne crée rien", r.replayed === true && r.order.order_number === o1.order_number);
await as(null);
ok("après 3 envois : 1 commande, stock inchangé", (await A("select count(*)::int n from public.orders"))[0].n === 1 && (await stock("huile-test")) === 3 && (await stock("savon-test")) === 2);

// --- 4. Validation et refus ------------------------------------------------------------------
await as("anon");
const rejected = async (name, items, o = {}, code = "invalid_input") => { const x = await order(items, o); ok(name, x.ok === false && x.code === code, JSON.stringify(x)); };
await rejected("panier vide refusé", []);
await rejected("panier non tableau refusé", { product_id: "huile-test", quantity: 1 });
await rejected("quantité 0 refusée", [{ product_id: "huile-test", quantity: 0 }]);
await rejected("quantité négative refusée", [{ product_id: "huile-test", quantity: -1 }]);
await rejected("quantité non numérique refusée", [{ product_id: "huile-test", quantity: "abc" }]);
await rejected("quantité 100 refusée", [{ product_id: "huile-test", quantity: 100 }]);
await rejected("identifiant produit invalide refusé", [{ product_id: "Huile'; drop", quantity: 1 }]);
await rejected("nom trop court refusé", [{ product_id: "huile-test", quantity: 1 }], { name: "A" });
await rejected("téléphone invalide refusé", [{ product_id: "huile-test", quantity: 1 }], { phone: "abc" });
await rejected("adresse vide refusée", [{ product_id: "huile-test", quantity: 1 }], { address: "  " });
await rejected("commune vide refusée", [{ product_id: "huile-test", quantity: 1 }], { area: "" });
await rejected("clé d'idempotence invalide refusée", [{ product_id: "huile-test", quantity: 1 }], { key: "court" });
await rejected("31 lignes refusées", Array.from({ length: 31 }, () => ({ product_id: "huile-test", quantity: 1 })));
await rejected("produit inactif refusé", [{ product_id: "inactif-test", quantity: 1 }], {}, "product_unavailable");
await rejected("produit inconnu refusé", [{ product_id: "inconnu-xx", quantity: 1 }], {}, "product_unavailable");
r = await order([{ product_id: "rupture-test", quantity: 1 }]);
ok("produit en rupture refusé (out_of_stock)", r.ok === false && r.code === "out_of_stock" && r.available === 0, JSON.stringify(r));
r = await order([{ product_id: "savon-test", quantity: 1 }, { product_id: "huile-test", quantity: 4 }]);
ok("stock insuffisant sur une ligne : refus, produit et disponible indiqués", r.code === "out_of_stock" && r.product_id === "huile-test" && r.available === 3, JSON.stringify(r));
await as(null);
ok("refus atomiques : aucune commande ni stock modifié", (await A("select count(*)::int n from public.orders"))[0].n === 1 && (await stock("savon-test")) === 2 && (await stock("huile-test")) === 3);

// --- 5. Doublons de lignes, prix modifié, stock jamais négatif --------------------------------
await as("anon");
r = await order([{ product_id: "savon-test", quantity: 1 }, { product_id: "savon-test", quantity: 1 }]);
ok("lignes en double regroupées (1 ligne, quantité 2)", r.ok && r.order.items.length === 1 && r.order.items[0].quantity === 2 && r.order.subtotal === 12000, JSON.stringify(r));
const o2 = r.order;
r = await order([{ product_id: "savon-test", quantity: 1 }]);
ok("stock épuisé par deux commandes successives : la troisième échoue", r.ok === false && r.code === "out_of_stock", JSON.stringify(r));
await as(null);
ok("stock du savon = 0 (jamais négatif)", (await stock("savon-test")) === 0);
await asAdmin();
await A(`select public.admin_update_product('huile-test','HUI-1','Produit huile-test','Tests','','',array[]::text[],null,null,9500,null,0,true)`);
await as("anon");
ok("commande déjà passée : prix instantané inchangé après hausse du prix catalogue", (await rpc("get_order", [o1.order_number, "07 00 71 71 00"])).order.items.find((i) => i.product_id === "huile-test").unit_price === 8000);
r = await order([{ product_id: "huile-test", quantity: 1 }]);
ok("nouvelle commande : prix du catalogue courant (9500)", r.ok && r.order.subtotal === 9500, JSON.stringify(r));
const o3 = r.order;

// --- 6. Compte connecté ----------------------------------------------------------------------
await as("authenticated", CLIENT);
r = await order([{ product_id: "huile-test", quantity: 1 }]);
await as(null);
ok("commande d'un compte connecté : user_id renseigné", r.ok && (await A("select user_id from public.orders where order_number = $1", [r.order.order_number]))[0].user_id === CLIENT, JSON.stringify(r));
await as("authenticated", CLIENT);
ok("client connecté non admin ne lit aucune commande (RLS)", (await A("select count(*)::int n from public.orders"))[0].n === 0);
ok("client connecté n'appelle pas les fonctions admin", (await fails(`select public.admin_list_orders(null,10)`)) === true);
ok("client connecté ne change pas de statut", (await fails(`select public.admin_update_order_status('${o1.id}','confirmed','')`)) === true);

// --- 7. Statuts et transitions ---------------------------------------------------------------
await asAdmin();
ok("admin lit les commandes (RLS)", (await A("select count(*)::int n from public.orders"))[0].n >= 4);
const list = await rpc("admin_list_orders", [null, 50]);
ok("admin_list_orders : commandes récentes d'abord, avec lignes", list.length >= 4 && list[0].items.length >= 1 && new Date(list[0].created_at) >= new Date(list[list.length - 1].created_at));
ok("filtre par statut", (await rpc("admin_list_orders", ["pending", 50])).every((x) => x.status === "pending"));
r = await setStatus(o1.id, "delivered");
ok("pending → delivered refusé", r.ok === false && r.code === "invalid_transition", JSON.stringify(r));
r = await setStatus(o1.id, "confirmed");
ok("pending → confirmed", r.ok && r.order.status === "confirmed" && r.order.confirmed_at !== null);
r = await setStatus(o1.id, "preparing"); ok("confirmed → preparing", r.ok && r.order.preparing_at !== null);
r = await setStatus(o1.id, "pending"); ok("retour en arrière refusé", r.ok === false && r.code === "invalid_transition");
r = await setStatus(o1.id, "delivering"); ok("preparing → delivering", r.ok && r.order.delivering_at !== null);
r = await setStatus(o1.id, "delivered"); ok("delivering → delivered", r.ok && r.order.delivered_at !== null);
r = await setStatus(o1.id, "cancelled"); ok("delivered → cancelled refusé (livraison définitive)", r.ok === false && r.code === "invalid_transition");
r = await setStatus(o1.id, "delivered"); ok("même statut : sans effet", r.ok === true);
r = await setStatus("00000000-0000-0000-0000-00000000dead", "confirmed"); ok("commande inconnue : not_found", r.code === "not_found");

// --- 8. Annulation et restitution du stock ---------------------------------------------------
const huileBefore = await stock("huile-test");
r = await setStatus(o3.id, "cancelled", "Client injoignable");
ok("annulation d'une commande pending", r.ok && r.order.status === "cancelled" && r.order.cancelled_at !== null && r.order.cancel_reason === "Client injoignable", JSON.stringify(r));
ok("stock restitué (+1 huile)", (await stock("huile-test")) === huileBefore + 1);
const ret = await A(`select quantity, stock_after, type from public.stock_movements where ref_id = $1 and type = 'return'`, [o3.order_number]);
ok("journal : mouvement 'return' positif avec stock_after cohérent", ret.length === 1 && ret[0].quantity === 1 && ret[0].stock_after === huileBefore + 1, JSON.stringify(ret));
r = await setStatus(o3.id, "cancelled"); ok("double annulation : sans effet", r.ok === true && (await stock("huile-test")) === huileBefore + 1);
r = await setStatus(o3.id, "confirmed"); ok("annulée → confirmed refusé", r.ok === false && r.code === "invalid_transition");
r = await setStatus(o2.id, "cancelled");
ok("annulation d'une commande à 2 lignes identiques : savon restitué (0 → 2)", r.ok && (await stock("savon-test")) === 2);

// --- 9. Frais de livraison -------------------------------------------------------------------
await asAdmin();
r = await rpc("create_store_order", [base.name, base.phone, base.address, base.area, "", JSON.stringify([{ product_id: "savon-test", quantity: 1 }]), key()]);
const o4 = r.order;
r = await rpc("admin_set_order_delivery_fee", [o4.id, 1500]);
ok("frais fixés : total = sous-total + frais", r.ok && r.order.delivery_fee === 1500 && r.order.total_amount === o4.subtotal + 1500, JSON.stringify(r));
r = await rpc("admin_set_order_delivery_fee", [o4.id, null]);
ok("frais remis à « à confirmer »", r.ok && r.order.delivery_fee === null && r.order.total_amount === o4.subtotal);
ok("frais négatifs refusés", (await rpc("admin_set_order_delivery_fee", [o4.id, -1])).code === "invalid_input");
ok("frais impossibles sur commande livrée", (await rpc("admin_set_order_delivery_fee", [o1.id, 1000])).code === "invalid_transition");

// --- 10. Suivi invité (get_order) ------------------------------------------------------------
await as("anon");
r = await rpc("get_order", [o4.order_number.toLowerCase(), "+225 0700717100"]);
ok("get_order : numéro (minuscules) + téléphone au format différent", r.ok === true && r.order.order_number === o4.order_number, JSON.stringify(r));
ok("get_order : mauvais téléphone → not_found", (await rpc("get_order", [o4.order_number, "07 99 99 99 99"])).code === "not_found");
ok("get_order : mauvais numéro → not_found", (await rpc("get_order", ["CMD-0000000000", "07 00 71 71 00"])).code === "not_found");
ok("get_order : la même erreur pour numéro ou téléphone faux (pas d'énumération)", (await rpc("get_order", [o4.order_number, "07 99 99 99 99"])).error === (await rpc("get_order", ["CMD-0000000000", "07 00 71 71 00"])).error);
ok("get_order n'expose ni user_id ni clé d'idempotence", !("user_id" in r.order) && !("idempotency_key" in r.order));
await newIp();
let limited = false;
for (let i = 0; i < 12 && !limited; i++) limited = (await rpc("get_order", [o4.order_number, "07 99 99 99 99"], false)).code === "rate_limited";
ok("get_order : essais répétés limités", limited);

// --- 11. Limitation anti-abus à la création ----------------------------------------------------
await as("anon");
await newIp();
let created = 0, lim = false;
for (let i = 0; i < 12 && !lim; i++) {
  const x = await order([{ product_id: "stock-test", quantity: 1 }], { phone: nextPhone() }, false);
  if (x.ok) created++; else lim = x.code === "rate_limited";
}
ok("création : plafond de 10 commandes par heure et par IP", lim && created === 10, `créées=${created}`);

// --- 12. Intégrité ---------------------------------------------------------------------------
await as(null);
ok("les commandes ne se suppriment pas (même par le propriétaire)", (await fails(`delete from public.orders where id = '${o1.id}'`, [], /ne se suppriment pas/)) === true);
ok("les lignes ne se suppriment pas", (await fails(`delete from public.order_items`, [], /ne se suppriment pas/)) === true);
const bad = await A(`select p.id, p.stock_qty, coalesce(sum(m.quantity),0)::int as journal from public.products p
  left join public.stock_movements m on m.product_id = p.id group by p.id, p.stock_qty having p.stock_qty <> coalesce(sum(m.quantity),0)`);
ok("invariant : stock_qty = somme du journal stock_movements pour chaque produit", bad.length === 0, JSON.stringify(bad));
const incoh = await A(`select count(*)::int n from public.orders o where o.subtotal <> (select coalesce(sum(line_total),0) from public.order_items i where i.order_id = o.id)`);
ok("invariant : sous-total = somme des lignes pour chaque commande", incoh[0].n === 0);
const nums = await A(`select count(*)::int n, count(distinct order_number)::int d from public.orders`);
ok("numéros de commande uniques", nums[0].n === nums[0].d);

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
