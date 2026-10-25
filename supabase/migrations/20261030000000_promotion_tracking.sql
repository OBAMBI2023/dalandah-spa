-- Prix de référence annoncé pour le type « pourcentage » + traçabilité des promotions (événements anonymes et attribution des réservations).
-- Non appliquée tant que le propriétaire du projet ne l'a pas validée. Ne modifie AUCUNE migration déjà appliquée, AUCUNE ligne de services,
-- products, bookings ni de promotions, ne touche pas à create_booking et n'ajoute aucune donnée (ni faux client, ni réservation de démonstration).
--
-- 1. Type « pourcentage » : un prix de référence ANNONCÉ facultatif (original_price_fcfa) est désormais autorisé. C'est une valeur saisie dans
--    la promotion (instantané), jamais un lien avec le tarif du catalogue ; aucun prix promotionnel n'est calculé ni enregistré pour ce type.
--    La contrainte promotions_kind_fields (migration 20261029) est remplacée ; les lignes existantes (une annonce) la respectent.
--
-- 2. promotion_events : événements de navigation ANONYMES (impression, click, booking_started). Aucune donnée personnelle : ni nom, ni
--    téléphone, ni e-mail, ni adresse IP. La « session » est un identifiant aléatoire de 32 caractères hexadécimaux, généré par le navigateur
--    pour la durée de la visite (sessionStorage).
--    RÈGLE DE DÉDUPLICATION : une même promotion, un même événement et une même session ne sont comptés QU'UNE FOIS PAR JOUR (jour UTC,
--    Abidjan étant à UTC+0 : contrainte d'unicité + insertion idempotente). Un événement répété le même jour ne crée pas de ligne mais met à
--    jour last_at (horodatage du dernier événement reçu), qui sert à l'attribution.
--    Écriture uniquement par track_promotion_event() ; AUCUNE lecture directe pour anon ni authenticated, administrateurs compris (les chiffres
--    passent par admin_promotion_stats()). Les sessions d'un administrateur connecté à la base ne sont pas comptées.
--    LIMITES ANTI-ABUS (l'identifiant de session est choisi par le navigateur : on ne s'y fie pas seul) : 600 événements par heure et par IP,
--    200 par heure et par session, et 300 par jour pour une même IP sur une même promotion (environ 100 visiteurs : large pour un réseau
--    mobile partagé). Au-delà, l'événement est refusé (rate_limited), pas compté. Les statistiques restent INDICATIVES : elles peuvent être
--    gonflées par quelqu'un qui change d'adresse IP.
--    PURGE : private.purge_promotion_events() supprime les événements de plus de 400 jours ; elle est appelée de façon occasionnelle (environ
--    1 appel sur 500) par track_promotion_event(), comme private.rate_limit_hit() le fait déjà pour private.rate_limits (aucune infrastructure
--    de planification n'est requise). Les attributions (promotion_bookings) ne sont JAMAIS supprimées. Conséquence : les totaux
--    d'impressions, clics et parcours démarrés portent sur 400 jours glissants ; les réservations attribuées, elles, sont conservées.
--
-- 3. promotion_bookings : attribution d'une réservation à une promotion, enregistrée APRÈS la création par attribute_booking_to_promotion()
--    (appel séparé : create_booking n'est ni modifiée ni appelée). Une réservation ne peut être attribuée qu'UNE fois (booking_id unique).
--    RÈGLE D'ATTRIBUTION (toutes les conditions) :
--      a) la fonction exige la référence ET le téléphone de la réservation (comme get_booking / cancel_booking) ;
--      b) l'appel a lieu moins de 30 minutes après la création de la réservation (pas d'attribution rétroactive) ;
--      c) la promotion existe, n'est pas supprimée, a déjà été publiée (ni brouillon) et a commencé ;
--      d) la MÊME SESSION a enregistré un événement CLICK sur CETTE promotion dont le dernier horodatage (last_at) se situe entre 24 heures
--         avant la création de la réservation et 5 minutes après (marge pour un événement livré avec retard).
--    booking_started et impression NE SUFFISENT PAS : booking_started est déclenché par la simple ouverture d'une adresse ?promo=, il ne prouve
--    pas qu'une bannière a été cliquée. Limites : un visiteur qui arrive par un lien partagé (sans clic sur une bannière) n'est pas attribué ;
--    last_at n'est rafraîchi que lorsque le navigateur renvoie l'événement (au plus une fois par jour et par session), donc la fenêtre de
--    24 heures court à partir du dernier clic reçu.
--    La fonction ne modifie jamais la réservation (montant, prestation, statut). Lecture des attributions : administrateurs.
--
-- 4. admin_promotion_stats() : chiffres par promotion pour l'administration (impressions, clics, parcours démarrés, réservations créées /
--    confirmées / annulées). Réservée aux administrateurs.

-- ---------------------------------------------------------------------------
-- 1. Type « pourcentage » : prix de référence annoncé facultatif
-- ---------------------------------------------------------------------------

alter table public.promotions drop constraint promotions_kind_fields;
alter table public.promotions add constraint promotions_kind_fields check (
  (kind = 'price'        and original_price_fcfa is not null and promo_price_fcfa is not null and promo_price_fcfa < original_price_fcfa and percent_off is null)
  or (kind = 'percent'   and percent_off is not null and promo_price_fcfa is null)   -- original_price_fcfa : prix de référence annoncé, facultatif
  or (kind = 'announcement' and percent_off is null and original_price_fcfa is null and promo_price_fcfa is null)
);

-- ---------------------------------------------------------------------------
-- 2. Événements anonymes
-- ---------------------------------------------------------------------------

create table public.promotion_events (
  id           bigint generated always as identity primary key,
  promotion_id uuid not null references public.promotions (id) on delete cascade,
  event        text not null check (event in ('impression', 'click', 'booking_started')),
  session_key  text not null check (session_key ~ '^[0-9a-f]{32}$'),
  day          date not null default ((now() at time zone 'utc')::date),   -- jour UTC, comme le navigateur
  created_at   timestamptz not null default now(),
  last_at      timestamptz not null default now(),                         -- dernier événement reçu (met à jour la ligne du jour)
  constraint promotion_events_once unique (promotion_id, event, session_key, day)
);
create index promotion_events_promotion_idx on public.promotion_events (promotion_id, event);
create index promotion_events_session_idx on public.promotion_events (session_key, promotion_id) where event = 'click';
create index promotion_events_day_idx on public.promotion_events (day);

alter table public.promotion_events enable row level security;
-- Aucune politique, aucun droit : ni lecture ni écriture directe pour anon et authenticated.
revoke all on table public.promotion_events from anon, authenticated;
revoke all on sequence public.promotion_events_id_seq from anon, authenticated;

-- Purge des événements anciens (les attributions ne sont jamais touchées). Réservée au propriétaire : appelée par track_promotion_event(),
-- ou à la main depuis l'éditeur SQL : select private.purge_promotion_events(interval '400 days');
-- Par lots de 5 000 lignes pour ne pas bloquer la table. Renvoie le nombre de lignes supprimées.
create function private.purge_promotion_events(p_keep interval default interval '400 days') returns integer
language plpgsql set search_path = '' as
$$
declare
  v_n integer;
begin
  delete from public.promotion_events
   where id in (select e.id from public.promotion_events e where e.day < (((now() at time zone 'utc') - p_keep)::date) limit 5000);
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function private.purge_promotion_events(interval) from public, anon, authenticated;

-- Enregistre un événement (idempotent). Renvoie { ok: true, counted } ou { ok: false, code, error }.
-- counted = true seulement pour la première réception du jour ; un renvoi met à jour last_at sans recompter.
create function public.track_promotion_event(p_promotion_id uuid, p_event text, p_session text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_new boolean;
begin
  if p_promotion_id is null or p_event is null or p_event not in ('impression', 'click', 'booking_started')
     or p_session is null or p_session !~ '^[0-9a-f]{32}$' then
    return private.err('invalid_input', 'Paramètres invalides.');
  end if;
  if not private.rate_limit_hit('promo:track:ip', private.client_ip(), 600, interval '1 hour')
     or not private.rate_limit_hit('promo:track:session', p_session, 200, interval '1 hour') then
    return private.err('rate_limited', 'Trop de requêtes. Réessayez plus tard.');
  end if;
  -- Les consultations d'un administrateur connecté à la base (aperçus) ne sont pas des visites de clients.
  if (select private.is_admin()) then
    return jsonb_build_object('ok', true, 'counted', false);
  end if;
  -- Éligible = visible par le public : publiée, non supprimée, dans sa période.
  if not exists (
    select 1 from public.promotions p
     where p.id = p_promotion_id and p.status = 'published' and p.deleted_at is null
       and (p.starts_on is null or p.starts_on <= current_date)
       and (p.ends_on is null or p.ends_on >= current_date)
  ) then
    return private.err('not_eligible', 'Promotion indisponible.');
  end if;
  -- Plafond quotidien par IP et par promotion (seulement pour les promotions éligibles : pas de ligne de compteur pour des identifiants inventés).
  if not private.rate_limit_hit('promo:track:ip-promo', private.client_ip() || '|' || p_promotion_id::text, 300, interval '1 day') then
    return private.err('rate_limited', 'Trop de requêtes. Réessayez plus tard.');
  end if;

  insert into public.promotion_events as e (promotion_id, event, session_key, day, last_at)
  values (p_promotion_id, p_event, p_session, ((now() at time zone 'utc')::date), now())
  on conflict on constraint promotion_events_once do update set last_at = excluded.last_at
  returning (e.xmax = 0) into v_new;   -- xmax = 0 : ligne insérée (première réception du jour)

  if random() < 0.002 then              -- purge occasionnelle, sans planificateur
    perform private.purge_promotion_events(interval '400 days');
  end if;
  return jsonb_build_object('ok', true, 'counted', v_new);
end
$$;
revoke all on function public.track_promotion_event(uuid, text, text) from public, anon, authenticated;
grant execute on function public.track_promotion_event(uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Attribution des réservations
-- ---------------------------------------------------------------------------

create table public.promotion_bookings (
  booking_id   uuid primary key references public.bookings (id) on delete cascade,   -- une réservation, une seule attribution
  promotion_id uuid not null references public.promotions (id),
  created_at   timestamptz not null default now()
);
create index promotion_bookings_promotion_idx on public.promotion_bookings (promotion_id);

alter table public.promotion_bookings enable row level security;
create policy "admin lit les attributions" on public.promotion_bookings
  for select to authenticated using ((select private.is_admin()));
revoke all on table public.promotion_bookings from anon, authenticated;
grant select on public.promotion_bookings to authenticated; -- RLS : administrateurs

-- Rattache une réservation existante à la promotion d'où venait le visiteur (règle ci-dessus). Renvoie { ok: true, attributed } ou
-- { ok: false, code, error }. Réponses volontairement génériques : not_found pour toute référence / téléphone inexact ou mal formé,
-- not_eligible pour toute promotion ou session sans clic admissible. Ne modifie jamais la réservation.
create function public.attribute_booking_to_promotion(p_ref text, p_phone text, p_promotion_id uuid, p_session text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_key    text;
  v_id     uuid;
  v_made   timestamptz;
  v_n      integer;
begin
  if p_promotion_id is null or p_session is null or p_session !~ '^[0-9a-f]{32}$' then
    return private.err('invalid_input', 'Paramètres invalides.');
  end if;
  if not private.rate_limit_hit('attr:ip', private.client_ip(), 30, interval '1 hour') then
    return private.err('rate_limited', 'Trop de tentatives. Réessayez plus tard.');
  end if;
  if char_length(v_digits) not between 8 and 15 or p_ref is null or char_length(p_ref) > 30 then
    return private.err('not_found', 'Réservation introuvable.');
  end if;
  v_key := private.normalize_phone(p_phone);
  if not private.rate_limit_hit('attr:phoneip', v_key || '|' || private.client_ip(), 10, interval '1 hour')
     or not private.rate_limit_hit('attr:phone', v_key, 100, interval '1 hour') then
    return private.err('rate_limited', 'Trop de tentatives. Réessayez plus tard.');
  end if;

  select b.id, b.created_at into v_id, v_made from public.bookings b where b.ref = upper(btrim(p_ref)) and b.phone_key = v_key;
  if v_id is null then
    return private.err('not_found', 'Réservation introuvable.');
  end if;
  if v_made < now() - interval '30 minutes' then
    return private.err('too_late', 'Cette réservation ne peut plus être rattachée à une promotion.');
  end if;
  -- Promotion admissible : existante, non supprimée, déjà publiée un jour (ni brouillon) et commencée. Une promotion qui vient de se terminer ou
  -- d'être désactivée reste admissible : le visiteur a pu cliquer avant.
  -- Et un CLIC de la même session sur cette promotion, entre 24 h avant la création de la réservation et 5 minutes après.
  if not exists (
       select 1 from public.promotions p
        where p.id = p_promotion_id and p.deleted_at is null and p.status <> 'draft'
          and (p.starts_on is null or p.starts_on <= current_date)
     )
     or not exists (
       select 1 from public.promotion_events e
        where e.promotion_id = p_promotion_id and e.session_key = p_session and e.event = 'click'
          and e.last_at >= v_made - interval '24 hours' and e.last_at <= v_made + interval '5 minutes'
     ) then
    return private.err('not_eligible', 'Promotion indisponible.');
  end if;

  -- Atomique : deux appels simultanés pour la même réservation ne produisent qu'une ligne (clé primaire).
  insert into public.promotion_bookings (booking_id, promotion_id) values (v_id, p_promotion_id)
  on conflict (booking_id) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'attributed', v_n = 1);
end
$$;
revoke all on function public.attribute_booking_to_promotion(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.attribute_booking_to_promotion(text, text, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Statistiques (administrateurs)
-- ---------------------------------------------------------------------------

-- Un objet par promotion non supprimée. Rôle admin vérifié AVANT tout calcul ; non-administrateur : erreur 42501.
-- Les compteurs d'événements portent sur les 400 derniers jours (purge) ; les réservations attribuées sont conservées sans limite.
create function public.admin_promotion_stats() returns jsonb
language plpgsql security definer set search_path = '' as
$$
begin
  if not (select private.is_admin()) then
    raise exception 'réservé aux administrateurs' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'promotion_id', p.id,
      'impressions', (select count(*) from public.promotion_events e where e.promotion_id = p.id and e.event = 'impression'),
      'clicks', (select count(*) from public.promotion_events e where e.promotion_id = p.id and e.event = 'click'),
      'booking_started', (select count(*) from public.promotion_events e where e.promotion_id = p.id and e.event = 'booking_started'),
      'bookings_created', (select count(*) from public.promotion_bookings a where a.promotion_id = p.id),
      'bookings_confirmed', (select count(*) from public.promotion_bookings a join public.bookings b on b.id = a.booking_id where a.promotion_id = p.id and b.status = 'confirmed'),
      'bookings_cancelled', (select count(*) from public.promotion_bookings a join public.bookings b on b.id = a.booking_id where a.promotion_id = p.id and b.status = 'cancelled')
    ) order by p.created_at desc)
    from public.promotions p where p.deleted_at is null
  ), '[]'::jsonb);
end
$$;
revoke all on function public.admin_promotion_stats() from public, anon, authenticated;
grant execute on function public.admin_promotion_stats() to authenticated;
