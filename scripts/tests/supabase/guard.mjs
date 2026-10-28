// Garde des privilèges : liste blanche des fonctions exécutables, SECURITY DEFINER, RLS et droits sur les tables.
// Échoue dès qu'une migration ouvre un accès non prévu (par exemple une nouvelle fonction publique exécutable par anon).
// Base PostgreSQL locale en mémoire (PGlite) : aucune connexion au projet Supabase distant.
// Exécution : bun run test:sql:guard
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = process.env.SUPABASE_DIR ?? fileURLToPath(new URL("../../../supabase", import.meta.url));
const migrationSql = () => readdirSync(`${root}/migrations`).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(`${root}/migrations/${f}`, "utf8")).join("\n");

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + extra}`); };
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const set = (a) => [...a].sort().join(", ");

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

// Fonctions réellement appelables par un rôle : droit EXECUTE ET droit USAGE sur le schéma.
const callable = async (role) => (await q(
  `select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
      and has_schema_privilege($1, n.nspname, 'usage') and has_function_privilege($1, p.oid, 'execute')`, [role])).map((r) => r.fn);

// create_store_order / get_order : commandes de la boutique (migration 20261031) ; admin_*_order* : suivi par l'administrateur.
// track_promotion_event / attribute_booking_to_promotion : suivi anonyme des promotions (migration 20261030), sans lecture ni donnée personnelle.
const PUBLIC_API = ["public.attribute_booking_to_promotion", "public.cancel_booking", "public.create_booking", "public.create_store_order", "public.get_availability", "public.get_booking", "public.get_order", "public.track_promotion_event"];
const anonFns = await callable("anon");
ok("anon n'exécute que l'API publique prévue", set(anonFns) === set(PUBLIC_API), set(anonFns));
const authFns = await callable("authenticated");
// normalize_phone (pure, sans donnée) est évaluée par une colonne générée avec les droits de l'appelant : tolérée si présente.
// Fonctions d'administration (rôle admin vérifié dans la fonction, droits fermés à anon) : produits, étape 1.
const ADMIN_API = ["public.admin_create_category", "public.admin_create_product", "public.admin_create_service_category", "public.admin_list_orders", "public.admin_list_products", "public.admin_promotion_stats", "public.admin_set_order_delivery_fee", "public.admin_set_product_image", "public.admin_update_order_status", "public.admin_update_product"];
const AUTH_ALLOWED = [...PUBLIC_API, ...ADMIN_API, "private.has_role", "private.is_admin", "private.normalize_phone"];
ok("authenticated n'exécute que l'API publique et les helpers autorisés",
  authFns.every((f) => AUTH_ALLOWED.includes(f)) && [...PUBLIC_API, ...ADMIN_API].every((f) => authFns.includes(f)), set(authFns));

const defs = await q(`select n.nspname || '.' || p.proname as fn, p.prosecdef as definer,
    exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""') as safe_path
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prokind = 'f'`);
const noPath = defs.filter((d) => d.definer && !d.safe_path).map((d) => d.fn);
ok("toute fonction SECURITY DEFINER fixe search_path = ''", noPath.length === 0, set(noPath));
const definerSet = defs.filter((d) => d.definer).map((d) => d.fn);
ok("liste des fonctions SECURITY DEFINER connue",
  set(definerSet) === set([...PUBLIC_API, ...ADMIN_API, "private.has_role", "private.is_admin", "private.rate_limit_hit"]), set(definerSet));
ok("aucune fonction du schéma public n'est exécutable par PUBLIC sans être dans la liste blanche",
  (await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' and p.proname <> all($1)
              and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))`,
    [[...PUBLIC_API, ...ADMIN_API].map((f) => f.replace("public.", ""))])).length === 0);

const tables = await q(`select n.nspname || '.' || c.relname as t, c.relrowsecurity as rls from pg_class c
  join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private') and c.relkind = 'r'`);
ok("RLS activée sur toutes les tables", tables.every((t) => t.rls), set(tables.filter((t) => !t.rls).map((t) => t.t)));

const tp = async (role) => (await q(
  `select table_schema || '.' || table_name as t, privilege_type as p from information_schema.table_privileges where grantee = $1 and table_schema in ('public','private')`, [role]));
const anonT = Object.fromEntries((await tp("anon")).map((r) => [r.t + ":" + r.p, 1]));
ok("anon : lecture seule de services, service_categories, promotions, time_slots, salon_settings (niveau table), rien d'autre",
  set(Object.keys(anonT)) === set(["public.promotions:SELECT", "public.service_categories:SELECT", "public.services:SELECT", "public.time_slots:SELECT", "public.salon_settings:SELECT"]), set(Object.keys(anonT)));
// products : droits PAR COLONNE pour anon (information_schema.table_privileges ne les montre pas).
const PUBLIC_PRODUCT_COLUMNS = ["id", "name", "category", "short_description", "description", "features", "usage_tips", "volume", "image_url", "sale_price", "stock_qty"];
const anonCols = await q(`select table_name, column_name, privilege_type from information_schema.column_privileges where grantee = 'anon' and table_schema = 'public' and table_name in ('products','product_costs','stock_movements','bookings','profiles','user_roles') order by 1, 2, 3`);
const expectedCols = set(PUBLIC_PRODUCT_COLUMNS.map((c) => "products." + c + ":SELECT"));
const authCols = await q(`select table_name, column_name, privilege_type from information_schema.column_privileges where grantee = 'authenticated' and table_schema = 'public' and table_name = 'products' order by 1, 2, 3`);
ok("authenticated : products limité aux MÊMES colonnes publiques (les droits par colonne suivent le rôle, pas la personne ; l'administrateur passe par admin_list_products)",
  set(authCols.map((r) => r.table_name + "." + r.column_name + ":" + r.privilege_type)) === expectedCols, set(authCols.map((r) => r.table_name + "." + r.column_name + ":" + r.privilege_type)));
ok("anon : products en lecture seule limitée aux colonnes de la boutique publique (ni sku, ni seuil, ni is_demo, ni dates)",
  set(anonCols.map((r) => r.table_name + "." + r.column_name + ":" + r.privilege_type)) === set(PUBLIC_PRODUCT_COLUMNS.map((c) => "products." + c + ":SELECT")),
  set(anonCols.map((r) => r.table_name + "." + r.column_name + ":" + r.privilege_type)));
const authT = await tp("authenticated");
ok("aucun TRUNCATE, REFERENCES ni TRIGGER pour authenticated", !authT.some((r) => ["TRUNCATE", "REFERENCES", "TRIGGER"].includes(r.p)));
ok("authenticated ne peut ni insérer ni supprimer dans bookings", !authT.some((r) => r.t === "public.bookings" && ["INSERT", "DELETE", "UPDATE"].includes(r.p)));
ok("authenticated n'écrit pas dans user_roles", !authT.some((r) => r.t === "public.user_roles" && r.p !== "SELECT"));
ok("authenticated n'a aucun droit sur le schéma private (tables)", !authT.some((r) => r.t.startsWith("private.")));

const ADMIN_READ_ONLY = ["public.products", "public.product_costs", "public.stock_movements", "public.product_categories", "public.service_categories"];
ok("authenticated ne peut écrire directement ni dans products, ni dans product_costs, ni dans stock_movements",
  !authT.some((r) => ADMIN_READ_ONLY.includes(r.t) && r.p !== "SELECT"), set(authT.filter((r) => ADMIN_READ_ONLY.includes(r.t) && r.p !== "SELECT").map((r) => r.t + ":" + r.p)));
ok("anon ne lit ni product_costs, ni stock_movements, ni product_categories", !anonT["public.product_costs:SELECT"] && !anonT["public.stock_movements:SELECT"] && !anonT["public.product_categories:SELECT"]);

const cols = (await q(`select column_name from information_schema.column_privileges where grantee = 'authenticated' and table_schema = 'public' and table_name = 'bookings' and privilege_type = 'UPDATE'`)).map((r) => r.column_name);
ok("seules 3 colonnes de bookings sont modifiables (status, cancelled_at, cancelled_by)", set(cols) === set(["status", "cancelled_at", "cancelled_by"]), set(cols));

const pol = await q(`select tablename, cmd, roles::text as roles from pg_policies where schemaname = 'public'`);
ok("aucune politique pour anon sur bookings, profiles, user_roles, product_costs, stock_movements, product_categories",
  !pol.some((p) => ["bookings", "profiles", "user_roles", "product_costs", "stock_movements", "product_categories"].includes(p.tablename) && /anon/.test(p.roles)));
ok("aucune politique d'écriture sur products, product_costs, stock_movements, product_categories, service_categories", !pol.some((p) => ["products", "product_costs", "stock_movements", "product_categories", "service_categories"].includes(p.tablename) && p.cmd !== "SELECT"));
ok("aucune politique d'écriture sur user_roles", !pol.some((p) => p.tablename === "user_roles" && p.cmd !== "SELECT"));

// Promotions : lecture publique limitée par la RLS aux promotions publiées ; écriture réservée aux administrateurs ; jamais de suppression physique.
ok("authenticated n'a aucun droit DELETE sur promotions (suppression logique seulement)", !authT.some((r) => r.t === "public.promotions" && r.p === "DELETE"));
ok("anon n'a que SELECT sur promotions", set(Object.keys(anonT).filter((k) => k.startsWith("public.promotions:"))) === "public.promotions:SELECT");
ok("promotions : aucune politique d'écriture pour anon, aucune politique DELETE ou ALL",
  !pol.some((p) => p.tablename === "promotions" && ((/anon/.test(p.roles) && p.cmd !== "SELECT") || p.cmd === "DELETE" || p.cmd === "ALL")));

// Traçabilité des promotions : événements sans aucun accès direct, attributions lisibles par les administrateurs seulement (RLS), jamais d'écriture directe.
ok("promotion_events : aucun droit pour anon ni authenticated", ![...Object.keys(anonT), ...authT.map((r) => r.t + ":" + r.p)].some((k) => k.startsWith("public.promotion_events")));
ok("promotion_bookings : SELECT seulement pour authenticated, rien pour anon",
  set(authT.filter((r) => r.t === "public.promotion_bookings").map((r) => r.p)) === "SELECT" && !Object.keys(anonT).some((k) => k.startsWith("public.promotion_bookings")));
ok("promotion_events et promotion_bookings : aucune politique d'écriture, aucune politique pour anon",
  !pol.some((p) => ["promotion_events", "promotion_bookings"].includes(p.tablename) && (p.cmd !== "SELECT" || /anon/.test(p.roles))));

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
