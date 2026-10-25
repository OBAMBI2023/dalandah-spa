// Essais de fautes pour les catégories de prestations : on supprime volontairement UNE protection de la migration (dans une copie
// temporaire) et service-categories.mjs doit alors échouer. Prouve que les tests protègent réellement la migration.
// Bases PostgreSQL locales en mémoire (PGlite) : aucune connexion au projet Supabase distant ; aucun fichier du dépôt n'est modifié.
// Exécution : npm run test:sql:service-categories-mutations
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../supabase", import.meta.url));
const script = fileURLToPath(new URL("./service-categories.mjs", import.meta.url));
const MIGRATION = "20261028000000_service_categories.sql";
const original = readFileSync(`${root}/migrations/${MIGRATION}`, "utf8");

// [description, transformation du SQL]. Chaque transformation doit réellement changer le texte (sinon l'essai est invalide).
const mutants = [
  ["unicité sensible à la casse seulement (index et ON CONFLICT sur lower(btrim(label)))", (s) => s.split("(private.category_key(label))").join("(lower(btrim(label)))")],
  ["contrôle administrateur supprimé", (s) => s.replace("if not (select private.is_admin()) then", "if false then")],
  ["exécution de la fonction ouverte à anon", (s) => s.replace("to authenticated;\n", "to authenticated, anon;\n")],
  ["écriture directe ouverte aux utilisateurs connectés", (s) => s.replace("grant select on public.service_categories to anon, authenticated;", "grant select, insert, update, delete on public.service_categories to anon, authenticated;")],
  ["RLS désactivée", (s) => s.replace("alter table public.service_categories enable row level security;", "")],
  ["lecture publique retirée (anon)", (s) => s.replace("for select to anon, authenticated using (true)", "for select to authenticated using (true)")],
  ["fonction sans search_path vide", (s) => s.replace("language plpgsql security definer set search_path = '' as", "language plpgsql security definer as")],
  ["fonction en SECURITY INVOKER", (s) => s.replace("language plpgsql security definer set search_path = '' as", "language plpgsql set search_path = '' as")],
  ["normalisation du libellé supprimée dans la fonction", (s) => s.replace("  v_label := private.category_name(p_name);", "  v_label := btrim(coalesce(p_name, ''));")],
  ["normalisation exécutée AVANT le contrôle administrateur", (s) => s.replace("  v_label text;\n", "  v_label text := private.category_name(p_name);\n")],
  ["contrainte « libellé sous forme canonique » supprimée", (s) => s.replace("and label = private.category_name(label)", "and true")],
  ["commandes de sens d'écriture non rejetées (contrainte)", (s) => s.replace(/\n\s+and label !~ '\[(?!\[)[^']*'/, "")],
  ["commandes de sens d'écriture non rejetées (fonction)", (s) => s.replace(/\n\s+or v_label ~ '\[(?!\[)[^']*' then/, " then")],
  ["clé étrangère services.category supprimée", (s) => s.replace(/alter table public\.services\n\s+add constraint services_category_fkey[^;]*;/, "")],
  ["colonne services.category laissée en énumération (nouvelles catégories impossibles)", (s) => s.replace("alter table public.services alter column category type text using category::text;", "")],
  ["conversion qui perd les valeurs (toutes les prestations passent en « visage »)", (s) => s.replace("using category::text;", "using 'visage';")],
  ["type service_category supprimé", (s) => s + "\ndrop type public.service_category;\n"],
  ["amorçage : une catégorie d'origine manquante (spa)", (s) => s.replace(/,\n\s+\('spa',[^\n]*\n/, "\n")],
  ["amorçage : ordre d'affichage modifié", (s) => s.replace("'Massages relaxants',    'Un vrai moment de détente pour relâcher les tensions.',            20", "'Massages relaxants',    'Un vrai moment de détente pour relâcher les tensions.',            5")],
  ["amorçage : titre d'une catégorie d'origine modifié", (s) => s.replace("'Soins du visage',       'Nettoyage", "'Visage',       'Nettoyage")],
  ["amorçage : non rejouable (ON CONFLICT retiré)", (s) => s.replace("on conflict do nothing;", ";")],
  ["la migration modifie des prestations (prix)", (s) => s + "\nupdate public.services set price_fcfa = price_fcfa + 1;\n"],
  ["identifiant déjà pris : pas de nouvel essai (collision non gérée)", (s) => s.replace("exception when unique_violation then", "exception when no_data_found then")],
  ["identifiant de repli supprimé (nom sans lettre latine)", (s) => s.replace("if char_length(v_base) < 2 then v_base := 'categorie'; end if;", "")],
];

let detected = 0, invalid = 0;
for (const [label, mutate] of mutants) {
  const mutated = mutate(original);
  if (mutated === original) { invalid++; console.log(`INVALIDE   ${label}  -> la faute n'a pas pu être appliquée (motif introuvable)`); continue; }
  const dir = mkdtempSync(join(tmpdir(), "service-categories-mutation-"));
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
