// Essais de fautes pour les catégories : on supprime volontairement UNE protection de la migration (dans une copie temporaire) et
// categories.mjs doit alors échouer. Prouve que les tests protègent réellement la migration.
// Bases PostgreSQL locales en mémoire (PGlite) : aucune connexion au projet Supabase distant ; aucun fichier du dépôt n'est modifié.
// Exécution : npm run test:sql:categories-mutations
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../supabase", import.meta.url));
const script = fileURLToPath(new URL("./categories.mjs", import.meta.url));
const MIGRATION = "20261027000000_product_categories.sql";
const original = readFileSync(`${root}/migrations/${MIGRATION}`, "utf8");

// [description, transformation du SQL]. Chaque transformation doit réellement changer le texte (sinon l'essai est invalide).
const mutants = [
  ["unicité sensible à la casse seulement (index et ON CONFLICT sur lower(btrim(name)))", (s) => s.split("(private.category_key(name))").join("(lower(btrim(name)))")],
  ["accents non repliés dans la clé d'unicité", (s) => s.replace(/select lower\(regexp_replace\(normalize\(private\.category_name\(p\), NFKD\), '[^']*', '', 'g'\)\)/, "select lower(private.category_name(p))")],
  ["normalisation NFC supprimée", (s) => s.replace("normalize(coalesce(p, ''), NFC)", "coalesce(p, '')")],
  ["espaces Unicode (insécable, cadratin…) non normalisés", (s) => s.replace(/'\[\[:space:\][^']*\]\+'/, "'[[:space:]]+'")],
  ["caractères invisibles non retirés", (s) => s.replace(/regexp_replace\(normalize\(coalesce\(p, ''\), NFC\), '[^']*', '', 'g'\)/, "normalize(coalesce(p, ''), NFC)")],
  ["commandes de sens d'écriture non rejetées (fonction)", (s) => s.replace(/\n\s+or v_name ~ '\[(?!\[)[^']*' then/, " then")],
  ["commandes de sens d'écriture non rejetées (contrainte de la table)", (s) => s.replace(/\n\s+and name !~ '\[(?!\[)[^']*'[^\n]*/, "")],
  ["contrainte « nom sous forme canonique » supprimée", (s) => s.replace("and name = private.category_name(name)", "and true")],
  ["normalisation supprimée dans admin_create_category", (s) => s.replace("v_name text := private.category_name(p_name);", "v_name text := btrim(coalesce(p_name, ''));")],
  ["contrôle administrateur supprimé", (s) => s.replace("if not (select private.is_admin()) then", "if false then")],
  ["exécution de admin_create_category ouverte à anon", (s) => s.replace("to authenticated;\n\n-- ---", "to authenticated, anon;\n\n-- ---")],
  ["écriture directe ouverte aux utilisateurs connectés", (s) => s.replace("grant select on public.product_categories to authenticated;", "grant select, insert, update, delete on public.product_categories to authenticated;")],
  ["lecture de la table ouverte à tous les utilisateurs connectés (RLS)", (s) => s.replace("using ((select private.is_admin()))", "using (true)")],
  ["admin_create_category sans search_path vide", (s) => s.replace("language plpgsql security definer set search_path = '' as", "language plpgsql security definer as")],
  ["admin_create_category en SECURITY INVOKER", (s) => s.replace("language plpgsql security definer set search_path = '' as", "language plpgsql set search_path = '' as")],
  ["fonctions de normalisation exécutables par anon et authenticated", (s) => s.replace("revoke all on function private.category_name(text), private.category_key(text) from public, anon, authenticated;", "")],
  ["amorçage : une catégorie historique avec caractère de contrôle fait échouer la migration", (s) => s.replace("  and t.n !~ '[[:cntrl:]]'\n", "")],
  ["amorçage : modifie les produits existants", (s) => s + "\nupdate public.products set category = category;\n"],
  ["amorçage : non rejouable (ON CONFLICT retiré des insertions d'amorçage)", (s) => s.replace(/on conflict \(private\.category_key\(name\)\) do nothing;/g, ";")],
];

let detected = 0, invalid = 0;
for (const [label, mutate] of mutants) {
  const mutated = mutate(original);
  if (mutated === original) { invalid++; console.log(`INVALIDE   ${label}  -> la faute n'a pas pu être appliquée (motif introuvable)`); continue; }
  const dir = mkdtempSync(join(tmpdir(), "categories-mutation-"));
  try {
    cpSync(`${root}/migrations`, `${dir}/migrations`, { recursive: true });
    cpSync(`${root}/seed.sql`, `${dir}/seed.sql`);
    writeFileSync(`${dir}/migrations/${MIGRATION}`, mutated);
    const run = spawnSync(process.execPath, [script], { env: { ...process.env, SUPABASE_DIR: dir }, encoding: "utf8", timeout: 120_000 });
    const failures = (run.stdout.match(/^FAIL /gm) ?? []).length;
    const caught = run.status !== 0;
    if (caught) detected++;
    console.log(`${caught ? "DÉTECTÉE  " : "NON DÉTECTÉE"} ${label}  (${run.status === 0 ? "aucun échec" : failures > 0 ? failures + " test(s) en échec" : "la migration fautive est refusée ou le test s'interrompt"})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(`\n${detected} sur ${mutants.length} fautes détectées${invalid ? `, ${invalid} essai(s) invalide(s)` : ""}`);
process.exit(detected === mutants.length && invalid === 0 ? 0 : 1);
