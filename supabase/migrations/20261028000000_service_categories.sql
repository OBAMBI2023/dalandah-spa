-- Catégories de prestations dynamiques (formulaire « Prestation » de l'administration, pages publiques).
-- Non appliquée tant que le propriétaire du projet ne l'a pas validée. NON DESTRUCTIVE : aucune prestation, aucun prix, aucune durée,
-- aucune réservation n'est modifié ; les 6 catégories actuelles sont conservées avec le même identifiant.
--
-- Principes
--  * Jusqu'ici services.category était un type énuméré FIGÉ (public.service_category) : une nouvelle catégorie exigeait une migration.
--    La colonne devient un TEXTE relié par clé étrangère à public.service_categories. Les valeurs existantes ('visage', 'massage'…) sont
--    reprises telles quelles (conversion enum -> texte) : les 10 prestations gardent exactement leur catégorie.
--  * Le type public.service_category N'EST PAS supprimé : il reste défini mais n'est plus utilisé (réversible, rien à purger).
--  * Réservations : bookings ne référence que services(id) ; create_booking lit la ligne de services en entier (%rowtype) et ne manipule
--    pas la catégorie : elle est donc inchangée. Aucune réservation existante n'est touchée.
--  * Table service_categories : id (identifiant stable, utilisé dans les URL ?categorie=), label (court, filtres), title (titre des
--    cartes), description, image_url (facultative : sans image, le site affiche l'image par défaut), sort_order (ordre d'affichage).
--  * Lecture PUBLIQUE (anon et authenticated) : ce sont des libellés d'affichage, sans donnée sensible. Le site n'affiche une catégorie
--    que si elle compte au moins une prestation active (filtre côté application). ÉCRITURE : aucun droit direct pour les rôles
--    applicatifs, administrateurs compris ; seule admin_create_service_category() (SECURITY DEFINER, rôle admin vérifié en premier) crée.
--  * Unicité garantie par la base, avec les MÊMES fonctions que les catégories de produits (private.category_name / private.category_key,
--    migration 20261027000000 déjà appliquée, non modifiée) : casse, espaces, forme Unicode et accents combinants ignorés. Mêmes limites
--    documentées (« œ » / « oe », « ß » / « ss »… ne sont pas rapprochés).
--  * Un administrateur modifie toujours les prestations par la politique existante « admin services » (ALL) : la clé étrangère garantit
--    qu'une prestation ne peut référencer qu'une catégorie existante. Les catégories ne peuvent être ni renommées ni supprimées depuis
--    l'application (aucun droit d'écriture) : une prestation ne perd donc jamais sa catégorie.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.service_categories (
  id          text primary key check (id ~ '^[a-z0-9-]{2,60}$'),
  label       text not null check (
    char_length(label) between 2 and 60
    and label = private.category_name(label)                  -- toujours enregistré sous forme canonique
    and label !~ '[[:cntrl:]]'
    and label !~ '[\u061c\u180e\u200e\u200f\u202a-\u202e\u2066-\u2069]'
  ),
  title       text not null check (char_length(title) between 2 and 120 and title !~ '[[:cntrl:]]'),
  description text not null default '' check (char_length(description) <= 500),
  image_url   text check (image_url is null or char_length(image_url) <= 2000),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Doublon = même clé (casse, espaces, forme Unicode et accents combinants ignorés).
create unique index service_categories_label_key on public.service_categories (private.category_key(label));

-- ---------------------------------------------------------------------------
-- RLS et privilèges (liste blanche)
-- ---------------------------------------------------------------------------

alter table public.service_categories enable row level security;

create policy "categories de prestations lisibles" on public.service_categories
  for select to anon, authenticated using (true);
-- Aucune politique d'écriture : seule admin_create_service_category() écrit.

revoke all on table public.service_categories from anon, authenticated;
grant select on public.service_categories to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Amorçage : les 6 catégories actuelles, mêmes libellés, titres, descriptions et même ordre que src/data/services.ts
-- (images : conservées côté application, image_url reste vide). Idempotent.
-- ---------------------------------------------------------------------------

insert into public.service_categories (id, label, title, description, sort_order) values
  ('visage',   'Visage',   'Soins du visage',       'Nettoyage, vapeur et soins doux pour une peau apaisée.',           10),
  ('massage',  'Massage',  'Massages relaxants',    'Un vrai moment de détente pour relâcher les tensions.',            20),
  ('corps',    'Corps',    'Soins du corps',        'Gommage, enveloppement et soins pour le corps.',                   30),
  ('onglerie', 'Onglerie', 'Onglerie',              'Manucure, pédicure et soins des ongles.',                          40),
  ('coiffure', 'Coiffure', 'Coiffure et tresses',   'Shampoing, soins, nattes et coiffure.',                            50),
  ('spa',      'Spa',      'Rituels beauté et spa', 'Des rituels complets pour prendre du temps pour vous.',            60)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- services.category : enum -> texte relié à service_categories (les valeurs sont reprises à l'identique)
-- ---------------------------------------------------------------------------

alter table public.services alter column category type text using category::text;
alter table public.services
  add constraint services_category_fkey foreign key (category) references public.service_categories (id);

-- ---------------------------------------------------------------------------
-- Création d'une catégorie (administrateur)
-- ---------------------------------------------------------------------------

-- Renvoie { ok: true, id, label } ou { ok: false, code, error } :
--   invalid_input   : nom vide, trop court (< 2), trop long (> 60) ou contenant un caractère de contrôle ou de sens d'écriture ;
--   category_exists : une catégorie portant déjà ce nom (casse, espaces, forme Unicode et accents combinants ignorés) existe.
-- Titre = libellé, description vide, pas d'image (image par défaut côté site), placée à la fin de l'ordre d'affichage.
-- Un utilisateur non administrateur reçoit l'erreur 42501. Le rôle admin est vérifié AVANT tout traitement du texte fourni.
create function public.admin_create_service_category(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_label text;
  v_base  text;
  v_id    text;
  v_slug  text;
  v_sort  integer;
  n       integer := 1;
begin
  if not (select private.is_admin()) then
    raise exception 'réservé aux administrateurs' using errcode = '42501';
  end if;
  v_label := private.category_name(p_name);
  if char_length(v_label) not between 2 and 60
     or v_label ~ '[[:cntrl:]]'
     or v_label ~ '[\u061c\u180e\u200e\u200f\u202a-\u202e\u2066-\u2069]' then
    return private.err('invalid_input', 'Le nom de la catégorie doit contenir de 2 à 60 caractères.');
  end if;

  -- Identifiant : libellé sans accents, en minuscules, tout le reste devient « - » ; « categorie » si rien d'exploitable.
  v_base := btrim(regexp_replace(private.category_key(v_label), '[^a-z0-9]+', '-', 'g'), '-');
  v_base := left(v_base, 50);
  v_base := btrim(v_base, '-');
  if char_length(v_base) < 2 then v_base := 'categorie'; end if;

  select coalesce(max(sort_order), 0) + 10 into v_sort from public.service_categories;

  loop
    v_slug := case when n = 1 then v_base else v_base || '-' || n end;
    begin
      -- Atomique : si deux administrateurs créent le même nom au même instant, un seul insert aboutit.
      insert into public.service_categories (id, label, title, description, sort_order)
      values (v_slug, v_label, v_label, '', v_sort)
      on conflict (private.category_key(label)) do nothing
      returning id into v_id;
      exit;
    exception when unique_violation then
      -- L'identifiant est déjà pris par une autre catégorie : on essaie le suivant.
      n := n + 1;
      if n > 50 then
        return private.err('invalid_input', 'Impossible de générer un identifiant pour cette catégorie.');
      end if;
    end;
  end loop;

  if v_id is null then
    return private.err('category_exists', 'Cette catégorie existe déjà.');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'label', v_label);
end
$$;

revoke all on function public.admin_create_service_category(text) from public, anon, authenticated;
grant execute on function public.admin_create_service_category(text) to authenticated;
