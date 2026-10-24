-- Dalandah Beauty : schéma initial, version 2 (catalogue, créneaux, réservations invités ou connectés).
-- NON APPLIQUÉ : à relire, tester sur une base locale ou de test, puis lancer volontairement.
-- Notes de conception, décisions et adaptations frontend : supabase/MIGRATION_NOTES.md
--
-- Principes
--  * Aucune lecture ni écriture directe de public.bookings pour anon : tout passe par des fonctions
--    security definer (get_availability, create_booking, get_booking, cancel_booking).
--  * Prix, durée et nom du soin viennent de public.services, jamais du navigateur.
--  * L'anti-doublon et les chevauchements sont garantis par une contrainte d'exclusion (atomique).
--  * Les heures sont stockées en heure locale d'Abidjan (timestamp sans fuseau) : UTC+0 toute l'année,
--    sans heure d'été, donc sans ambiguïté. salon_settings.timezone est verrouillé sur cette valeur.
--  * Les données de démonstration sont dans supabase/seed.sql, pas dans cette migration.

-- ---------------------------------------------------------------------------
-- Schéma privé (non exposé par l'API) et privilèges par défaut
-- ---------------------------------------------------------------------------
create schema private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;   -- nécessaire pour évaluer les politiques RLS

-- Supabase accorde par défaut tous les droits à anon/authenticated sur les nouveaux objets : on les retire.
alter default privileges in schema public  revoke all on tables    from anon, authenticated;
alter default privileges in schema public  revoke all on sequences from anon, authenticated;
alter default privileges in schema public  revoke all on functions from anon, authenticated;
alter default privileges in schema private revoke all on tables    from anon, authenticated;
alter default privileges in schema private revoke all on functions from anon, authenticated;
-- ⚠ Ces révocations par défaut protègent les TABLES et les séquences, mais PAS les fonctions : PostgreSQL accorde
-- EXECUTE à PUBLIC (donc à anon et authenticated) à toute nouvelle fonction, et `alter default privileges in schema …`
-- ne peut pas retirer ce droit (vérifié par test). Seule la forme globale le ferait, mais elle toucherait aussi les
-- fonctions des autres schémas (extensions Supabase) : on ne l'utilise pas.
-- RÈGLE : toute nouvelle fonction sensible doit être fermée explicitement dans sa propre migration,
--   revoke all on function schema.nom(args) from public, anon, authenticated;
-- puis ouverte seulement aux rôles prévus (grant execute … to …). `bun run test:sql:guard` échoue si une
-- fonction reste exécutable par anon hors de la liste blanche (scripts/tests/supabase/guard.mjs).

-- Normalisation d'un numéro : chiffres seuls, sans préfixe international « 00 », et sans indicatif
-- ivoirien 225 lorsqu'il précède un numéro à 8 chiffres (ancien format) ou à 10 chiffres (format actuel).
-- Les numéros étrangers sont conservés en entier : deux numéros distincts ne fusionnent pas.
create function private.normalize_phone(p text) returns text
language sql immutable parallel safe set search_path = '' as
$$
  select case when d ~ '^225([0-9]{8}|[0-9]{10})$' then substr(d, 4) else d end
  from (select regexp_replace(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '^00', '') as d) s
$$;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.service_category as enum ('visage','corps','massage','coiffure','onglerie','spa');
create type public.booking_status   as enum ('confirmed','cancelled');
-- Extensible : un futur gestionnaire = `alter type public.app_role add value 'manager';`
create type public.app_role         as enum ('admin');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
-- Règles métier du salon, modifiables par l'administrateur (une seule ligne).
create table public.salon_settings (
  singleton                     boolean primary key default true check (singleton),
  timezone                      text    not null default 'Africa/Abidjan' check (timezone = 'Africa/Abidjan'),
  min_notice_hours              integer not null default 2   check (min_notice_hours between 0 and 168),
  cancel_notice_hours           integer not null default 2   check (cancel_notice_hours between 0 and 168),
  max_days_ahead                integer not null default 180 check (max_days_ahead between 1 and 365),
  max_active_bookings_per_phone integer not null default 3   check (max_active_bookings_per_phone between 1 and 20)
);
insert into public.salon_settings default values;

create table public.services (
  id             text primary key check (id ~ '^[a-z0-9-]{2,60}$'),
  name           text not null check (char_length(btrim(name)) between 2 and 120),
  category       public.service_category not null,
  description    text not null default '' check (char_length(description) <= 1000),
  -- Durée OPÉRATIONNELLE : temps de créneau réellement bloqué. Distincte du libellé affiché.
  duration_min   integer not null check (duration_min between 5 and 720),
  duration_label text not null check (char_length(duration_label) between 1 and 40),
  price_fcfa     integer not null check (price_fcfa >= 0),
  image_url      text,
  sort_order     integer not null default 0,
  active         boolean not null default true,
  is_demo        boolean not null default false,  -- true = donnée de démonstration, à remplacer
  created_at     timestamptz not null default now()
);

-- Grille des heures de début autorisées : source de vérité des créneaux.
create table public.time_slots (
  slot    time primary key,
  active  boolean not null default true,
  is_demo boolean not null default false
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name    text not null default '' check (char_length(name)  <= 100),
  phone   text not null default '' check (char_length(phone) <= 30),
  email   text not null default '' check (char_length(email) <= 254)
);

create table public.user_roles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.bookings (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null,
  user_id        uuid references auth.users(id) on delete set null,  -- null = réservation invité
  service_id     text not null references public.services(id),
  -- Instantanés pris sur public.services au moment de la réservation.
  service_name   text    not null,
  duration_label text    not null,
  duration_min   integer not null check (duration_min > 0),
  price_fcfa     integer not null check (price_fcfa >= 0),
  -- Heure locale d'Abidjan.
  starts_at      timestamp not null,
  ends_at        timestamp not null,
  date           date generated always as (starts_at::date) stored,
  slot           time generated always as (starts_at::time) stored,
  name           text not null check (char_length(btrim(name)) between 2 and 100),
  phone          text not null check (phone ~ '^[0-9 .+-]{8,30}$'
                                      and char_length(regexp_replace(phone, '\D', '', 'g')) between 8 and 15),
  -- Clé de comparaison : numéro normalisé (indicatif ivoirien retiré), sans troncature.
  phone_key      text generated always as (private.normalize_phone(phone)) stored,
  comment        text not null default '' check (char_length(comment) <= 500),
  status         public.booking_status not null default 'confirmed',
  cancelled_at   timestamptz,
  cancelled_by   text check (cancelled_by in ('client', 'admin')),
  created_at     timestamptz not null default now(),
  constraint bookings_ref_key unique (ref),
  constraint bookings_ref_format check (ref ~ '^DLD-[0-9A-F]{10}$'),
  constraint bookings_ends_after_start check (ends_at > starts_at),
  constraint bookings_slot_fkey foreign key (slot) references public.time_slots(slot),
  -- Capacité du salon = 1 : deux réservations confirmées ne peuvent pas se chevaucher.
  -- (Évolution multi-employées : voir MIGRATION_NOTES.md.)
  constraint bookings_no_overlap exclude using gist (tsrange(starts_at, ends_at) with &&)
    where (status = 'confirmed')
);
create index bookings_user_idx    on public.bookings (user_id);
create index bookings_date_idx    on public.bookings (date);
create index bookings_service_idx on public.bookings (service_id);
create index bookings_phone_idx   on public.bookings (phone_key) where status = 'confirmed';

-- Limitation de débit (tentatives de réservation, de consultation et d'annulation).
create table private.rate_limits (
  bucket       text not null,
  key          text not null,
  window_start timestamptz not null default now(),
  hits         integer not null default 0,
  primary key (bucket, key)
);
alter table private.rate_limits enable row level security;  -- aucune politique : inaccessible hors fonctions

-- ---------------------------------------------------------------------------
-- Helpers privés
-- ---------------------------------------------------------------------------
create function private.has_role(p_role public.app_role) returns boolean
language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role = p_role) $$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as
$$ select private.has_role('admin') $$;

create function private.err(p_code text, p_message text) returns jsonb
language sql immutable set search_path = '' as
$$ select jsonb_build_object('ok', false, 'code', p_code, 'error', p_message) $$;

-- IP du client : cf-connecting-ip (posé par Cloudflare, non falsifiable), sinon 1er x-forwarded-for.
create function private.client_ip() returns text
language sql stable set search_path = '' as
$$
  select coalesce(nullif(btrim(h->>'cf-connecting-ip'), ''),
                  nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), ''),
                  'unknown')
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json as h) s
$$;

-- Compte une tentative ; renvoie false si le plafond de la fenêtre est dépassé.
-- Les appelants doivent TOUJOURS retourner un résultat (jamais lever d'exception) pour que le compteur soit conservé.
create function private.rate_limit_hit(p_bucket text, p_key text, p_max integer, p_window interval)
returns boolean
language plpgsql security definer set search_path = '' as
$$
declare v_hits integer;
begin
  insert into private.rate_limits as r (bucket, key, window_start, hits)
  values (p_bucket, p_key, now(), 1)
  on conflict (bucket, key) do update
    set window_start = case when r.window_start < now() - p_window then now() else r.window_start end,
        hits         = case when r.window_start < now() - p_window then 1     else r.hits + 1     end
  returning hits into v_hits;

  if random() < 0.02 then  -- nettoyage occasionnel des anciennes fenêtres
    delete from private.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_max;
end
$$;

create function private.bookings_status_guard() returns trigger
language plpgsql set search_path = '' as
$$
begin
  if new.status = 'cancelled' and old.status = 'confirmed' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
    new.cancelled_by := coalesce(new.cancelled_by, 'admin');
  elsif new.status = 'confirmed' then
    new.cancelled_at := null;
    new.cancelled_by := null;
  end if;
  return new;
end
$$;
create trigger bookings_status_guard before update on public.bookings
  for each row execute function private.bookings_status_guard();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.salon_settings enable row level security;
alter table public.services       enable row level security;
alter table public.time_slots     enable row level security;
alter table public.profiles       enable row level security;
alter table public.user_roles     enable row level security;
alter table public.bookings       enable row level security;

create policy "réglages lisibles" on public.salon_settings
  for select to anon, authenticated using (true);
-- ⚠ AVANT LA MISE EN PRODUCTION : l'authentification multifacteur (MFA) doit être exigée pour les administrateurs
-- (inscription obligatoire, puis condition « (select auth.jwt() ->> 'aal') = 'aal2' » ajoutée aux politiques « admin … »
-- dans une migration ultérieure, après inscription du premier administrateur au MFA pour ne pas se verrouiller).
-- Voir supabase/MIGRATION_NOTES.md, section « Exigences avant la mise en production ».
create policy "admin réglages" on public.salon_settings
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "catalogue lisible" on public.services
  for select to anon, authenticated using (active);
create policy "admin services" on public.services
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "créneaux lisibles" on public.time_slots
  for select to anon, authenticated using (active);
create policy "admin créneaux" on public.time_slots
  for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "profil propre" on public.profiles
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "rôles propres" on public.user_roles
  for select to authenticated using (user_id = (select auth.uid()));

create policy "mes réservations" on public.bookings
  for select to authenticated using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy "admin modifie réservations" on public.bookings
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Privilèges SQL (liste blanche)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;

grant select on public.salon_settings, public.services, public.time_slots to anon, authenticated;
grant update on public.salon_settings to authenticated;                         -- RLS : admin
grant insert, update, delete on public.services, public.time_slots to authenticated;  -- RLS : admin
grant select, insert, update, delete on public.profiles to authenticated;       -- RLS : ligne propre
grant select on public.user_roles to authenticated;                             -- aucune écriture : pas d'auto-attribution
grant select on public.bookings to authenticated;                               -- RLS : siennes ou admin
grant update (status, cancelled_at, cancelled_by) on public.bookings to authenticated;  -- RLS : admin

-- ---------------------------------------------------------------------------
-- Fonctions publiques (invités et connectés)
-- ---------------------------------------------------------------------------

-- Disponibilité des créneaux d'un jour pour un soin donné (tient compte de sa durée, du préavis et des chevauchements).
create function public.get_availability(p_date date, p_service_id text)
returns table (slot text, available boolean)
language plpgsql stable security definer set search_path = '' as
$$
#variable_conflict use_column
declare
  v_cfg public.salon_settings%rowtype;
  v_dur integer;
  v_now timestamp;
begin
  select * into v_cfg from public.salon_settings;
  v_now := now() at time zone v_cfg.timezone;
  select s.duration_min into v_dur from public.services s where s.id = p_service_id and s.active;
  if v_dur is null or p_date is null then
    return;
  end if;

  return query
    select to_char(t.slot, 'HH24:MI'),
           (p_date + t.slot) >= v_now + make_interval(hours => v_cfg.min_notice_hours)
           and p_date <= v_now::date + v_cfg.max_days_ahead
           and not exists (
             select 1 from public.bookings b
             where b.status = 'confirmed'
               and tsrange(b.starts_at, b.ends_at)
                   && tsrange(p_date + t.slot, p_date + t.slot + make_interval(mins => v_dur)))
    from public.time_slots t
    where t.active
    order by t.slot;
end
$$;

-- Création d'une réservation (atomique : la contrainte d'exclusion tranche les conflits concurrents).
create function public.create_booking(
  p_service_id text, p_date date, p_slot text,
  p_name text, p_phone text, p_comment text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_cfg     public.salon_settings%rowtype;
  v_service public.services%rowtype;
  v_slot    time;
  v_now     timestamp;
  v_start   timestamp;
  v_end     timestamp;
  v_name    text;
  v_phone   text;
  v_digits  text;
  v_key     text;
  v_ref     text;
  v_try     integer := 0;
begin
  select * into v_cfg from public.salon_settings;
  v_now := now() at time zone v_cfg.timezone;

  if not private.rate_limit_hit('book:ip', private.client_ip(), 10, interval '1 hour') then
    return private.err('rate_limited', 'Trop de tentatives. Réessayez plus tard.');
  end if;

  v_name   := btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[\x01-\x1f\x7f]', ' ', 'g'), '\s+', ' ', 'g'));
  v_phone  := btrim(coalesce(p_phone, ''));
  v_digits := regexp_replace(v_phone, '\D', '', 'g');
  if char_length(v_name) not between 2 and 100
     or v_phone !~ '^[0-9 .+-]{8,30}$'
     or char_length(v_digits) not between 8 and 15 then
    return private.err('invalid_input', 'Nom ou téléphone invalide.');
  end if;
  if p_date is null or p_slot is null or p_slot !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    return private.err('invalid_input', 'Date ou créneau invalide.');
  end if;
  v_slot := p_slot::time;

  if not exists (select 1 from public.time_slots t where t.slot = v_slot and t.active) then
    return private.err('invalid_input', 'Date ou créneau invalide.');
  end if;
  select * into v_service from public.services s where s.id = p_service_id and s.active;
  if not found then
    return private.err('service_not_found', 'Prestation introuvable.');
  end if;

  v_start := p_date + v_slot;
  v_end   := v_start + make_interval(mins => v_service.duration_min);
  if v_start < v_now + make_interval(hours => v_cfg.min_notice_hours) then
    return private.err('too_early', format('Une réservation doit être faite au moins %s h à l''avance.', v_cfg.min_notice_hours));
  end if;
  if p_date > v_now::date + v_cfg.max_days_ahead then
    return private.err('too_far', format('Réservation possible jusqu''à %s jours à l''avance.', v_cfg.max_days_ahead));
  end if;

  v_key := private.normalize_phone(v_phone);
  if not private.rate_limit_hit('book:phoneip', v_key || '|' || private.client_ip(), 5, interval '1 hour')
     or not private.rate_limit_hit('book:phone', v_key, 20, interval '1 hour') then
    return private.err('rate_limited', 'Trop de tentatives. Réessayez plus tard.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dld:phone:' || v_key, 0));
  if (select count(*) from public.bookings b
       where b.status = 'confirmed' and b.phone_key = v_key and b.starts_at >= v_now)
     >= v_cfg.max_active_bookings_per_phone then
    return private.err('phone_limit', 'Nombre maximal de rendez-vous à venir atteint pour ce numéro. Contactez le salon.');
  end if;

  loop
    v_try := v_try + 1;
    v_ref := 'DLD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    begin
      insert into public.bookings
        (ref, user_id, service_id, service_name, duration_label, duration_min, price_fcfa,
         starts_at, ends_at, name, phone, comment)
      values
        (v_ref, auth.uid(), v_service.id, v_service.name, v_service.duration_label, v_service.duration_min,
         v_service.price_fcfa, v_start, v_end, v_name, v_phone,
         left(btrim(regexp_replace(coalesce(p_comment, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', ' ', 'g')), 500));
      return jsonb_build_object('ok', true, 'ref', v_ref, 'date', p_date,
                                'slot', to_char(v_slot, 'HH24:MI'), 'ends', to_char(v_end, 'HH24:MI'));
    exception
      when exclusion_violation then
        return private.err('slot_unavailable', 'Ce créneau n''est plus disponible. Choisissez-en un autre.');
      when unique_violation then  -- collision de référence : on retente
        if v_try >= 5 then
          return private.err('server_error', 'Enregistrement impossible, réessayez.');
        end if;
      when others then
        raise warning 'create_booking: % (%)', sqlerrm, sqlstate;  -- journal serveur uniquement
        return private.err('server_error', 'Enregistrement impossible, réessayez.');
    end;
  end loop;
end
$$;

-- Consultation d'une réservation invitée : référence ET téléphone requis.
create function public.get_booking(p_ref text, p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_cfg    public.salon_settings%rowtype;
  v_now    timestamp;
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_key    text;
  v_b      public.bookings%rowtype;
begin
  select * into v_cfg from public.salon_settings;
  v_now := now() at time zone v_cfg.timezone;

  if not private.rate_limit_hit('lookup:ip', private.client_ip(), 30, interval '1 hour') then
    return private.err('rate_limited', 'Trop de tentatives. Réessayez plus tard.');
  end if;
  if char_length(v_digits) not between 8 and 15 or p_ref is null or char_length(p_ref) > 30 then
    return private.err('not_found', 'Réservation introuvable.');
  end if;
  v_key := private.normalize_phone(p_phone);
  if not private.rate_limit_hit('lookup:phoneip', v_key || '|' || private.client_ip(), 10, interval '1 hour')
     or not private.rate_limit_hit('lookup:phone', v_key, 100, interval '1 hour') then
    return private.err('rate_limited', 'Trop de tentatives. Réessayez plus tard.');
  end if;

  select * into v_b from public.bookings b where b.ref = upper(btrim(p_ref)) and b.phone_key = v_key;
  if not found then
    return private.err('not_found', 'Réservation introuvable.');
  end if;

  return jsonb_build_object('ok', true, 'booking', jsonb_build_object(
    'ref', v_b.ref, 'service_name', v_b.service_name, 'duration_label', v_b.duration_label,
    'price_fcfa', v_b.price_fcfa, 'date', v_b.date, 'slot', to_char(v_b.slot, 'HH24:MI'),
    'ends', to_char(v_b.ends_at, 'HH24:MI'), 'status', v_b.status, 'name', v_b.name,
    'can_cancel', v_b.status = 'confirmed' and v_b.starts_at >= v_now + make_interval(hours => v_cfg.cancel_notice_hours)));
end
$$;

-- Annulation invitée : référence ET téléphone requis, jusqu'à cancel_notice_hours avant le rendez-vous.
create function public.cancel_booking(p_ref text, p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_cfg    public.salon_settings%rowtype;
  v_now    timestamp;
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_key    text;
  v_b      public.bookings%rowtype;
begin
  select * into v_cfg from public.salon_settings;
  v_now := now() at time zone v_cfg.timezone;

  if not private.rate_limit_hit('lookup:ip', private.client_ip(), 30, interval '1 hour') then
    return private.err('rate_limited', 'Trop de tentatives. Réessayez plus tard.');
  end if;
  if char_length(v_digits) not between 8 and 15 or p_ref is null or char_length(p_ref) > 30 then
    return private.err('not_found', 'Réservation introuvable.');
  end if;
  v_key := private.normalize_phone(p_phone);
  if not private.rate_limit_hit('lookup:phoneip', v_key || '|' || private.client_ip(), 10, interval '1 hour')
     or not private.rate_limit_hit('lookup:phone', v_key, 100, interval '1 hour') then
    return private.err('rate_limited', 'Trop de tentatives. Réessayez plus tard.');
  end if;

  select * into v_b from public.bookings b
   where b.ref = upper(btrim(p_ref)) and b.phone_key = v_key for update;
  if not found then
    return private.err('not_found', 'Réservation introuvable.');
  end if;
  if v_b.status <> 'confirmed' then
    return private.err('not_active', 'Cette réservation n''est plus active.');
  end if;
  if v_b.starts_at < v_now + make_interval(hours => v_cfg.cancel_notice_hours) then
    return private.err('too_late', format(
      'Annulation impossible moins de %s h avant le rendez-vous. Contactez le salon.', v_cfg.cancel_notice_hours));
  end if;

  update public.bookings set status = 'cancelled', cancelled_by = 'client' where id = v_b.id;
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------------
-- Droits d'exécution (liste blanche)
-- ---------------------------------------------------------------------------
revoke all on function private.has_role(public.app_role), private.is_admin(), private.err(text, text),
  private.client_ip(), private.rate_limit_hit(text, text, integer, interval), private.bookings_status_guard(),
  private.normalize_phone(text)
  from public, anon, authenticated;
grant execute on function private.has_role(public.app_role), private.is_admin(), private.normalize_phone(text) to authenticated;
-- normalize_phone est évaluée par la colonne générée bookings.phone_key avec les droits de l'appelant (administrateur, service_role).
grant execute on function private.normalize_phone(text) to service_role;
-- private.err et private.client_ip sont appelées par les fonctions security definer (propriétaire), pas par les clients.

revoke all on function
  public.get_availability(date, text),
  public.create_booking(text, date, text, text, text, text),
  public.get_booking(text, text),
  public.cancel_booking(text, text)
  from public, anon, authenticated;
grant execute on function
  public.get_availability(date, text),
  public.create_booking(text, date, text, text, text, text),
  public.get_booking(text, text),
  public.cancel_booking(text, text)
  to anon, authenticated;

-- Avant la mise en production (anti-bots) : placer un CAPTCHA devant create_booking via une Edge Function,
-- puis retirer l'accès direct :
--   revoke execute on function public.create_booking(text,date,text,text,text,text) from anon, authenticated;
--   grant  execute on function public.create_booking(text,date,text,text,text,text) to service_role;
-- (voir MIGRATION_NOTES.md)

-- Premier administrateur : à faire à la main après création du compte (éditeur SQL, rôle propriétaire) :
--   insert into public.user_roles (user_id, role) values ('<uuid du compte>', 'admin');
