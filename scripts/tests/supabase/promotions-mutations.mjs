// Essais de fautes pour les promotions : on supprime volontairement UNE protection de la migration (dans une copie temporaire) et
// promotions.mjs doit alors échouer. Prouve que les tests protègent réellement la migration.
// Bases PostgreSQL locales en mémoire (PGlite) : aucune connexion au projet Supabase distant ; aucun fichier du dépôt n'est modifié.
// Exécution : npm run test:sql:promotions-mutations
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../supabase", import.meta.url));
const script = fileURLToPath(new URL("./promotions.mjs", import.meta.url));
const MIGRATION = "20261029000000_promotions.sql";
const original = readFileSync(`${root}/migrations/${MIGRATION}`, "utf8");

// [description, transformation du SQL]. Chaque transformation doit réellement changer le texte (sinon l'essai est invalide).
const mutants = [
  ["RLS désactivée", (s) => s.replace("alter table public.promotions enable row level security;", "")],
  ["lecture publique sans filtre de statut", (s) => s.replace("using (status = 'published' and deleted_at is null", "using (deleted_at is null")],
  ["lecture publique sans filtre de suppression logique", (s) => s.replace("using (status = 'published' and deleted_at is null", "using (status = 'published'")],
  ["lecture publique sans date de début", (s) => s.replace("and (starts_on is null or starts_on <= current_date)", "")],
  ["lecture publique sans date de fin", (s) => s.replace("and (ends_on is null or ends_on >= current_date)", "")],
  ["date de fin exclue (ends_on > current_date)", (s) => s.replace("ends_on >= current_date", "ends_on > current_date")],
  ["lecture publique réservée aux connectés (anon retiré)", (s) => s.replace("for select to anon, authenticated\n  using (status", "for select to authenticated\n  using (status")],
  ["insertion ouverte à tout utilisateur connecté", (s) => s.replace("for insert to authenticated with check ((select private.is_admin()))", "for insert to authenticated with check (true)")],
  ["modification ouverte à tout utilisateur connecté", (s) => s.replace("for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))", "for update to authenticated using (true) with check (true)")],
  ["droit DELETE accordé aux connectés", (s) => s.replace("grant select, insert, update on public.promotions to authenticated;", "grant select, insert, update, delete on public.promotions to authenticated;")],
  ["écriture accordée à anon", (s) => s.replace("grant select on public.promotions to anon;", "grant select, insert, update on public.promotions to anon;")],
  ["lecture administrateur ouverte à tous les connectés", (s) => s.replace("for select to authenticated using ((select private.is_admin()))", "for select to authenticated using (true)")],
  ["contrainte par type supprimée", (s) => s.replace(/  constraint promotions_kind_fields check \([\s\S]*?\n  \),\n/, "")],
  ["prix promotionnel autorisé au-dessus du prix initial", (s) => s.replace("promo_price_fcfa < original_price_fcfa and", "true and")],
  ["période incohérente autorisée", (s) => s.replace(/  constraint promotions_period check[^\n]*\n/, "")],
  ["prestation ET produit autorisés", (s) => s.replace(/,\n  constraint promotions_one_link check[^\n]*\n/, "\n")],
  ["clé étrangère vers services supprimée", (s) => s.replace("service_id          text references public.services (id) on delete set null", "service_id          text")],
  ["clé étrangère vers products supprimée", (s) => s.replace("product_id          text references public.products (id) on delete set null", "product_id          text")],
  ["statut libre", (s) => s.replace("check (status in ('draft', 'published', 'disabled'))", "check (true)")],
  ["titre sans limite de longueur", (s) => s.replace("check (char_length(title) between 2 and 120 and title !~ '[[:cntrl:]]')", "check (true)")],
  ["created_at modifiable", (s) => s.replace("  new.created_at := old.created_at;\n", "")],
  ["updated_at non tenu par la base", (s) => s.replace("  new.updated_at := now();\n", "")],
  ["fonction de déclencheur exécutable par anon", (s) => s.replace("revoke all on function private.touch_promotion() from public, anon, authenticated;", "")],
  ["la migration modifie des prestations (prix)", (s) => s + "\nupdate public.services set price_fcfa = price_fcfa + 1;\n"],
  ["la migration modifie create_booking", (s) => s + "\ncomment on function public.create_booking(text,date,text,text,text,text) is 'x';\ncreate or replace function public.create_booking(p_service_id text, p_date date, p_slot text, p_name text, p_phone text, p_comment text default '') returns jsonb language sql as $$ select private.err('x','x') $$;\n"],
  ["promotion de démonstration insérée à la migration", (s) => s + "\ninsert into public.promotions (title, kind, status) values ('Demo', 'announcement', 'published');\n"],
];

let detected = 0, invalid = 0;
for (const [label, mutate] of mutants) {
  const mutated = mutate(original);
  if (mutated === original) { invalid++; console.log(`INVALIDE   ${label}  -> la faute n'a pas pu être appliquée (motif introuvable)`); continue; }
  const dir = mkdtempSync(join(tmpdir(), "promotions-mutation-"));
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
