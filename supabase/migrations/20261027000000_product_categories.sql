-- Catégories de produits créées depuis l'administration (formulaire « Ajouter un produit »).
-- Non appliquée tant que le propriétaire du projet ne l'a pas validée. NON DESTRUCTIVE : elle ne crée que de nouveaux objets et
-- n'écrit AUCUNE ligne dans products, product_costs ni stock_movements.
--
-- Principes
--  * products.category reste un TEXTE LIBRE : aucune clé étrangère, aucun produit modifié. Cette table est la liste des catégories
--    proposées à l'administrateur ; la boutique publique ne la lit pas (elle n'affiche que les catégories qui ont des produits).
--  * Un nom est enregistré sous sa forme canonique (private.category_name) : Unicode NFC, caractères invisibles retirés, espaces de toute
--    sorte (insécable, cadratin…) ramenés à une espace ordinaire, espaces répétés fusionnés, espaces de début et de fin retirés.
--  * Unicité, garantie par la base : deux noms qui ne diffèrent que par la casse, les espaces, la forme Unicode (NFC/NFD), les lettres
--    pleine chasse ou les ACCENTS COMBINANTS sont le même nom (index unique sur private.category_key). Même deux créations simultanées
--    ne peuvent pas produire de doublon. L'extension unaccent n'est PAS activée : le pliage repose sur normalize() de PostgreSQL (13+,
--    base en UTF8) suivi du retrait des marques combinantes U+0300 à U+036F.
--  * LIMITES de ce pliage (documentées, testées) : les lettres qui n'ont pas de décomposition ne sont pas rapprochées de leur
--    équivalent sans accent (« œ » / « oe », « ß » / « ss », « ø » / « o », « æ » / « ae », « đ » / « d », « ł » / « l »).
--  * RLS : lecture réservée aux administrateurs (private.is_admin()) ; ni politique ni droit d'écriture pour les rôles applicatifs
--    anon et authenticated, administrateurs compris. La création passe par admin_create_category(), SECURITY DEFINER, qui vérifie le
--    rôle admin AVANT toute écriture, valide le nom et rend une erreur exploitable.
--  * service_role est DIFFÉRENT : c'est la clé serveur (jamais dans le navigateur). Supabase lui accorde par défaut tous les droits sur
--    les nouvelles tables et il contourne la RLS : il peut donc écrire directement (les contraintes de la table s'appliquent quand même :
--    nom canonique, unicité). Il ne peut PAS créer via admin_create_category() : sans session d'utilisateur, il n'est pas administrateur.
--    Le propriétaire de la base (postgres) contourne aussi la RLS, comme pour toutes les tables du projet.
--  * Les catégories de prestations (type public.service_category) ne sont pas concernées.

-- ---------------------------------------------------------------------------
-- Normalisation (fonctions internes, immuables : utilisables dans un index)
-- ---------------------------------------------------------------------------

-- Forme canonique d'un nom de catégorie.
create function private.category_name(p text) returns text
language sql immutable set search_path = '' as
$$
  select btrim(
    regexp_replace(
      regexp_replace(normalize(coalesce(p, ''), NFC), '[\u00ad\u200b-\u200d\u2060\ufeff]', '', 'g'),
      '[[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+', ' ', 'g'))
$$;

-- Clé d'unicité : forme canonique, sans casse, sans accents (décomposition de compatibilité, puis retrait des marques combinantes).
create function private.category_key(p text) returns text
language sql immutable set search_path = '' as
$$
  select lower(regexp_replace(normalize(private.category_name(p), NFKD), '[\u0300-\u036f]', '', 'g'))
$$;

revoke all on function private.category_name(text), private.category_key(text) from public, anon, authenticated;
-- Évaluées par la contrainte et l'index de la table avec les droits de l'appelant : service_role (écriture directe côté serveur) en a besoin,
-- comme pour private.normalize_phone dans la migration initiale. Les rôles applicatifs, eux, n'écrivent jamais directement.
grant execute on function private.category_name(text), private.category_key(text) to service_role;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.product_categories (
  id         bigint generated always as identity primary key,
  name       text not null check (
    char_length(name) between 2 and 60                       -- mêmes bornes que products.category
    and name = private.category_name(name)                    -- toujours enregistré sous forme canonique
    and name !~ '[[:cntrl:]]'                                 -- ni retour à la ligne ni caractère de contrôle
    and name !~ '[\u061c\u180e\u200e\u200f\u202a-\u202e\u2066-\u2069]'  -- ni commande de sens d'écriture (usurpation visuelle)
  ),
  created_at timestamptz not null default now()
);

-- Doublon = même clé (casse, espaces, forme Unicode et accents combinants ignorés).
create unique index product_categories_name_key on public.product_categories (private.category_key(name));

-- ---------------------------------------------------------------------------
-- RLS et privilèges (liste blanche)
-- ---------------------------------------------------------------------------

alter table public.product_categories enable row level security;

create policy "admin lit les catégories" on public.product_categories
  for select to authenticated using ((select private.is_admin()));
-- Aucune politique d'écriture : seule admin_create_category() écrit.

revoke all on table public.product_categories from anon, authenticated;
revoke all on sequence public.product_categories_id_seq from anon, authenticated;
grant select on public.product_categories to authenticated; -- RLS : administrateur

-- ---------------------------------------------------------------------------
-- Création d'une catégorie (administrateur)
-- ---------------------------------------------------------------------------

-- Renvoie { ok: true, id, name } avec le nom tel qu'enregistré, ou { ok: false, code, error } :
--   invalid_input   : nom vide, trop court (< 2), trop long (> 60) ou contenant un caractère de contrôle ou de sens d'écriture ;
--   category_exists : une catégorie portant déjà ce nom (casse, espaces, forme Unicode et accents combinants ignorés) existe.
-- Un utilisateur non administrateur reçoit l'erreur 42501 (comme les fonctions de produits).
create function public.admin_create_category(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_name text := private.category_name(p_name);
  v_id   bigint;
begin
  if not (select private.is_admin()) then
    raise exception 'réservé aux administrateurs' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 60
     or v_name ~ '[[:cntrl:]]'
     or v_name ~ '[\u061c\u180e\u200e\u200f\u202a-\u202e\u2066-\u2069]' then
    return private.err('invalid_input', 'Le nom de la catégorie doit contenir de 2 à 60 caractères.');
  end if;

  -- Atomique : si deux administrateurs créent le même nom au même instant, un seul insert aboutit.
  insert into public.product_categories (name) values (v_name)
  on conflict (private.category_key(name)) do nothing
  returning id into v_id;
  if v_id is null then
    return private.err('category_exists', 'Cette catégorie existe déjà.');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'name', v_name);
end
$$;

revoke all on function public.admin_create_category(text) from public, anon, authenticated;
grant execute on function public.admin_create_category(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Amorçage (idempotent : rejouable sans doublon, n'écrase rien, ne peut pas échouer sur une catégorie historique atypique)
-- ---------------------------------------------------------------------------

-- 1. Les 7 catégories proposées jusqu'ici par le code (src/data/products.ts).
insert into public.product_categories (name)
select n from (values
  ('Soins du visage'), ('Nettoyants'), ('Hydratation'), ('Sérums et soins ciblés'),
  ('Soins du corps'), ('Coffrets beauté'), ('Routines beauté')
) as s(n)
on conflict (private.category_key(name)) do nothing;

-- 2. Catégories réellement utilisées par des produits existants (lecture seule de products : aucun produit n'est modifié).
--    Une catégorie historique qui ne peut pas devenir un nom valide (caractère de contrôle ou de sens d'écriture) est IGNORÉE
--    au lieu de faire échouer la migration ; le produit concerné garde sa catégorie, que l'administration continue d'afficher.
insert into public.product_categories (name)
select distinct on (private.category_key(t.n)) t.n
from (select private.category_name(category) as n from public.products) as t
where char_length(t.n) between 2 and 60
  and t.n !~ '[[:cntrl:]]'
  and t.n !~ '[\u061c\u180e\u200e\u200f\u202a-\u202e\u2066-\u2069]'
order by private.category_key(t.n), t.n
on conflict (private.category_key(name)) do nothing;
