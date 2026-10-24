// Teste le guard par mutation : on ajoute à une COPIE de supabase/ (dossier temporaire du système, jamais le dépôt)
// une migration « fautive » et on vérifie que guard.mjs la détecte. Aucune connexion au projet Supabase distant.
// Exécution : bun run test:sql:mutations
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.SUPABASE_DIR ?? fileURLToPath(new URL("../../../supabase", import.meta.url));
const guard = fileURLToPath(new URL("./guard.mjs", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "dalandah-mut-"));
const work = join(tmp, "supabase");
const sig = "public.leak()";
const mutations = [
  ["M0 aucune mutation (témoin)", "", true],
  ["M1 nouvelle fonction publique, droits par défaut (PUBLIC)", `create function public.leak() returns int language sql as 'select 1';`, false],
  ["M2 nouvelle fonction publique explicitement fermée", `create function public.leak() returns int language sql as 'select 1';
    revoke all on function ${sig} from public, anon, authenticated;`, true],
  ["M3 nouvelle fonction accordée à anon (hors liste blanche)", `create function public.leak() returns int language sql as 'select 1';
    revoke all on function ${sig} from public; grant execute on function ${sig} to anon;`, false],
  ["M4 SECURITY DEFINER sans search_path", `create function public.leak() returns int language sql security definer as 'select 1';
    revoke all on function ${sig} from public, anon, authenticated;`, false],
  ["M5 nouvelle table sans RLS", `create table public.leaky (id int);`, false],
  ["M6 SELECT sur bookings accordé à anon", `grant select on public.bookings to anon;`, false],
  ["M7 fonction privée à droits par défaut + USAGE du schéma private donné à anon", `create function private.leak() returns int language sql as 'select 1';
    grant usage on schema private to anon;`, false],
  ["M8 rate_limit_hit accordée à authenticated", `grant execute on function private.rate_limit_hit(text, text, integer, interval) to authenticated;`, false],
  ["M9 INSERT sur user_roles accordé à authenticated", `grant insert on public.user_roles to authenticated;`, false],
  ["M10 politique de lecture anon sur bookings", `create policy "anon lit tout" on public.bookings for select to anon using (true);`, false],
  ["M11 UPDATE de toutes les colonnes de bookings pour authenticated", `grant update on public.bookings to authenticated;`, false],
  ["M12 TRUNCATE accordé à authenticated", `grant truncate on public.services to authenticated;`, false],
];

let good = 0;
for (const [label, sql, expectPass] of mutations) {
  rmSync(work, { recursive: true, force: true });
  cpSync(base, work, { recursive: true });
  if (sql) writeFileSync(`${work}/migrations/20261101000000_mutation.sql`, sql);
  let out = "", code = 0;
  try { out = execFileSync(process.execPath, [guard], { env: { ...process.env, SUPABASE_DIR: work }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = (e.stdout ?? "") + (e.stderr ?? ""); code = e.status ?? 1; }
  const failed = out.split("\n").filter((l) => l.startsWith("FAIL")).map((l) => l.replace(/^FAIL\s+/, "").split("  ->")[0]);
  const detected = code !== 0;
  const okRes = expectPass ? !detected : detected;
  if (okRes) good++;
  console.log(`${okRes ? "PASS" : "FAIL"}  ${label} → ${detected ? "DÉTECTÉ" : "non détecté"}${failed.length ? " (" + failed.slice(0, 2).join(" ; ").slice(0, 120) + ")" : ""}`);
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\n${good} sur ${mutations.length} conformes aux attentes`);
process.exit(good === mutations.length ? 0 : 1);
