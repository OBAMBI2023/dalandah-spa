// Essais de fautes pour la traçabilité des promotions : on supprime volontairement UNE protection de la migration (dans une copie
// temporaire) et promotion-tracking.mjs doit alors échouer. Prouve que les tests protègent réellement la migration.
// Bases PostgreSQL locales en mémoire (PGlite) : aucune connexion au projet Supabase distant ; aucun fichier du dépôt n'est modifié.
// Exécution : npm run test:sql:promotion-tracking-mutations
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../supabase", import.meta.url));
const script = fileURLToPath(new URL("./promotion-tracking.mjs", import.meta.url));
const MIGRATION = "20261030000000_promotion_tracking.sql";
const original = readFileSync(`${root}/migrations/${MIGRATION}`, "utf8");

// [description, transformation du SQL]. Chaque transformation doit réellement changer le texte (sinon l'essai est invalide).
const mutants = [
  ["type pourcentage : prix promotionnel autorisé", (s) => s.replace("percent_off is not null and promo_price_fcfa is null)", "percent_off is not null)")],
  ["type pourcentage : prix de référence interdit", (s) => s.replace("percent_off is not null and promo_price_fcfa is null)", "percent_off is not null and promo_price_fcfa is null and original_price_fcfa is null)")],
  ["annonce : prix autorisés", (s) => s.replace("or (kind = 'announcement' and percent_off is null and original_price_fcfa is null and promo_price_fcfa is null)", "or (kind = 'announcement')")],
  ["unicité des événements supprimée (déduplication)", (s) => s.replace("  constraint promotion_events_once unique (promotion_id, event, session_key, day)\n", "  constraint promotion_events_dummy check (true)\n").replace("on conflict on constraint promotion_events_once do nothing", "")],
  ["insertion non idempotente (ON CONFLICT retiré)", (s) => s.replace("  on conflict on constraint promotion_events_once do update set last_at = excluded.last_at\n", "\n")],
  ["jour retiré de l'unicité (une seule fois pour toujours)", (s) => s.replace("unique (promotion_id, event, session_key, day)", "unique (promotion_id, event, session_key)")],
  ["session non validée (format libre)", (s) => s.replace("check (session_key ~ '^[0-9a-f]{32}$')", "check (true)").replace("or p_session is null or p_session !~ '^[0-9a-f]{32}$' then", "or p_session is null then")],
  ["événement libre", (s) => s.replace("check (event in ('impression', 'click', 'booking_started'))", "check (true)").replace("p_event not in ('impression', 'click', 'booking_started')", "false")],
  ["éligibilité de la promotion non vérifiée", (s) => s.replace("  if not exists (\n    select 1 from public.promotions p\n     where p.id = p_promotion_id and p.status = 'published' and p.deleted_at is null\n       and (p.starts_on is null or p.starts_on <= current_date)\n       and (p.ends_on is null or p.ends_on >= current_date)\n  ) then", "  if false then")],
  ["statut de publication ignoré par l'éligibilité", (s) => s.replace("where p.id = p_promotion_id and p.status = 'published' and p.deleted_at is null\n       and (p.starts_on is null or p.starts_on <= current_date)\n       and (p.ends_on", "where p.id = p_promotion_id and p.deleted_at is null\n       and (p.starts_on is null or p.starts_on <= current_date)\n       and (p.ends_on")],
  ["sessions d'administrateur comptées", (s) => s.replace("  if (select private.is_admin()) then\n    return jsonb_build_object('ok', true, 'counted', false);\n  end if;\n", "")],
  ["limitation de débit par session supprimée", (s) => s.replace("     or not private.rate_limit_hit('promo:track:session', p_session, 200, interval '1 hour') then", "     or false then")],
  ["lecture directe des événements ouverte à authenticated", (s) => s.replace("revoke all on sequence public.promotion_events_id_seq from anon, authenticated;", "revoke all on sequence public.promotion_events_id_seq from anon, authenticated;\ngrant select on public.promotion_events to authenticated;")],
  ["écriture directe des événements ouverte à anon", (s) => s.replace("revoke all on sequence public.promotion_events_id_seq from anon, authenticated;", "revoke all on sequence public.promotion_events_id_seq from anon, authenticated;\ngrant insert on public.promotion_events to anon;")],
  ["RLS des événements désactivée", (s) => s.replace("alter table public.promotion_events enable row level security;", "")],
  ["donnée personnelle ajoutée aux événements (téléphone)", (s) => s.replace("  last_at      timestamptz not null default now(),", "  last_at      timestamptz not null default now(),\n  phone        text,")],
  ["track_promotion_event non exécutable par anon", (s) => s.replace("grant execute on function public.track_promotion_event(uuid, text, text) to anon, authenticated;", "grant execute on function public.track_promotion_event(uuid, text, text) to authenticated;")],
  ["fonctions en SECURITY INVOKER", (s) => s.replace("create function public.track_promotion_event(p_promotion_id uuid, p_event text, p_session text) returns jsonb\nlanguage plpgsql security definer", "create function public.track_promotion_event(p_promotion_id uuid, p_event text, p_session text) returns jsonb\nlanguage plpgsql")],
  ["attribution sans fenêtre de 30 minutes", (s) => s.replace("  if v_made < now() - interval '30 minutes' then", "  if false then")],
  ["attribution sans vérification du téléphone", (s) => s.replace("where b.ref = upper(btrim(p_ref)) and b.phone_key = v_key;", "where b.ref = upper(btrim(p_ref));")],
  ["attribution sans éligibilité de la promotion", (s) => s.replace("where p.id = p_promotion_id and p.deleted_at is null and p.status <> 'draft'\n          and (p.starts_on is null or p.starts_on <= current_date)", "where p.id = p_promotion_id")],
  ["double attribution possible (ON CONFLICT retiré, clé non unique)", (s) => s.replace("  booking_id   uuid primary key references public.bookings (id) on delete cascade,", "  booking_id   uuid not null references public.bookings (id) on delete cascade,").replace("  on conflict (booking_id) do nothing;", ";")],
  ["l'attribution modifie la réservation", (s) => s.replace("  insert into public.promotion_bookings (booking_id, promotion_id) values (v_id, p_promotion_id)", "  update public.bookings set comment = comment || ' [promo]' where id = v_id;\n  insert into public.promotion_bookings (booking_id, promotion_id) values (v_id, p_promotion_id)")],
  ["l'attribution révèle des informations sur la réservation", (s) => s.replace("return jsonb_build_object('ok', true, 'attributed', v_n = 1);", "return jsonb_build_object('ok', true, 'attributed', v_n = 1, 'ref', p_ref, 'booking', v_id);")],
  ["attributions lisibles par tous les utilisateurs connectés", (s) => s.replace("for select to authenticated using ((select private.is_admin()));\nrevoke all on table public.promotion_bookings", "for select to authenticated using (true);\nrevoke all on table public.promotion_bookings")],
  ["écriture directe des attributions ouverte", (s) => s.replace("grant select on public.promotion_bookings to authenticated; -- RLS : administrateurs", "grant select, insert, update, delete on public.promotion_bookings to authenticated;")],
  ["statistiques sans contrôle administrateur", (s) => s.replace("  if not (select private.is_admin()) then\n    raise exception 'réservé aux administrateurs' using errcode = '42501';\n  end if;\n  return coalesce((", "  return coalesce((")],
  ["statistiques ouvertes à anon", (s) => s.replace("grant execute on function public.admin_promotion_stats() to authenticated;", "grant execute on function public.admin_promotion_stats() to authenticated, anon;")],
  ["statistiques : réservations annulées comptées confirmées", (s) => s.replace("and b.status = 'confirmed')", "and b.status in ('confirmed', 'cancelled'))")],
  ["la migration modifie une réservation", (s) => s + "\nupdate public.bookings set price_fcfa = price_fcfa + 1;\n"],
  ["la migration modifie une prestation", (s) => s + "\nupdate public.services set price_fcfa = price_fcfa + 1;\n"],
  ["la migration remplace create_booking", (s) => s + "\ncreate or replace function public.create_booking(p_service_id text, p_date date, p_slot text, p_name text, p_phone text, p_comment text default '') returns jsonb language sql as $$ select private.err('x','x') $$;\n"],
  ["la migration insère une attribution de démonstration", (s) => s + "\ninsert into public.promotion_bookings (booking_id, promotion_id) select b.id, p.id from public.bookings b, public.promotions p limit 1;\n"],
  ["attribution sans clic exigé (aucune vérification d'événement)", (s) => s.replace("e.promotion_id = p_promotion_id and e.session_key = p_session and e.event = 'click'\n          and e.last_at >= v_made - interval '24 hours' and e.last_at <= v_made + interval '5 minutes'", "true")],
  ["booking_started suffit pour attribuer", (s) => s.replace("and e.event = 'click'\n          and e.last_at", "and e.event in ('click', 'booking_started')\n          and e.last_at")],
  ["l'impression suffit pour attribuer", (s) => s.replace("and e.event = 'click'\n          and e.last_at", "and e.event in ('click', 'impression')\n          and e.last_at")],
  ["clic d'une autre session accepté", (s) => s.replace("where e.promotion_id = p_promotion_id and e.session_key = p_session and e.event = 'click'", "where e.promotion_id = p_promotion_id and e.event = 'click'")],
  ["clic d'une autre promotion accepté", (s) => s.replace("where e.promotion_id = p_promotion_id and e.session_key = p_session and e.event = 'click'", "where e.session_key = p_session and e.event = 'click'")],
  ["fenêtre de 24 h sans borne inférieure (clic ancien accepté)", (s) => s.replace("and e.last_at >= v_made - interval '24 hours' and", "and")],
  ["fenêtre de 24 h étendue à 48 h", (s) => s.replace("e.last_at >= v_made - interval '24 hours'", "e.last_at >= v_made - interval '48 hours'")],
  ["clic postérieur à la réservation accepté (borne supérieure retirée)", (s) => s.replace(" and e.last_at <= v_made + interval '5 minutes'", "")],
  ["session non validée à l'attribution", (s) => s.replace("if p_promotion_id is null or p_session is null or p_session !~ '^[0-9a-f]{32}$' then", "if p_promotion_id is null then")],
  ["plafond global par téléphone supprimé", (s) => s.replace("\n     or not private.rate_limit_hit('attr:phone', v_key, 100, interval '1 hour') then", " then")],
  ["plafond quotidien par IP et par promotion supprimé", (s) => s.replace("if not private.rate_limit_hit('promo:track:ip-promo', private.client_ip() || '|' || p_promotion_id::text, 300, interval '1 day') then", "if false then")],
  ["last_at jamais mis à jour", (s) => s.replace("do update set last_at = excluded.last_at", "do update set last_at = e.last_at")],
  ["événement répété recompté (counted toujours vrai)", (s) => s.replace("returning (e.xmax = 0) into v_new;", "returning true into v_new;")],
  ["purge qui supprime tout (rétention ignorée)", (s) => s.replace("where e.day < (((now() at time zone 'utc') - p_keep)::date)", "where true")],
  ["purge qui supprime aussi les attributions", (s) => s.replace("  delete from public.promotion_events\n   where id in", "  delete from public.promotion_bookings;\n  delete from public.promotion_events\n   where id in")],
  ["purge exécutable par les rôles applicatifs", (s) => s.replace("revoke all on function private.purge_promotion_events(interval) from public, anon, authenticated;", "")],
  ["ancienne signature d'attribution à trois paramètres conservée", (s) => s + "\ncreate function public.attribute_booking_to_promotion(p_ref text, p_phone text, p_promotion_id uuid) returns jsonb language sql security definer set search_path = '' as $$ select jsonb_build_object('ok', true) $$;\ngrant execute on function public.attribute_booking_to_promotion(text, text, uuid) to anon;\n"],
];

let detected = 0, invalid = 0;
// ONLY="texte" : ne rejoue que les essais dont la description contient ce texte (pratique après avoir corrigé un seul essai).
const selected = mutants.filter(([l]) => !process.env.ONLY || l.includes(process.env.ONLY));
for (const [label, mutate] of selected) {
  const mutated = mutate(original);
  if (mutated === original) { invalid++; console.log(`INVALIDE   ${label}  -> la faute n'a pas pu être appliquée (motif introuvable)`); continue; }
  const dir = mkdtempSync(join(tmpdir(), "promotion-tracking-mutation-"));
  try {
    cpSync(`${root}/migrations`, `${dir}/migrations`, { recursive: true });
    cpSync(`${root}/seed.sql`, `${dir}/seed.sql`);
    writeFileSync(`${dir}/migrations/${MIGRATION}`, mutated);
    const run = spawnSync(process.execPath, [script], { env: { ...process.env, SUPABASE_DIR: dir }, encoding: "utf8", timeout: 180_000 });
    const failures = (run.stdout.match(/^FAIL /gm) ?? []).length;
    const caught = run.status !== 0;
    if (caught) detected++;
    console.log(`${caught ? "DÉTECTÉE  " : "NON DÉTECTÉE"} ${label}  (${run.status === 0 ? "aucun échec" : failures > 0 ? failures + " test(s) en échec" : "la migration fautive est refusée ou le test s'interrompt"})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(`\n${detected} sur ${selected.length} fautes détectées${invalid ? `, ${invalid} essai(s) invalide(s)` : ""}`);
process.exit(detected === selected.length && invalid === 0 ? 0 : 1);
