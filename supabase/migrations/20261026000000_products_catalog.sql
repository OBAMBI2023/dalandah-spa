-- Étape 1 de la gestion du spa : catalogue de produits de la boutique.
-- Non appliquée tant que le propriétaire du projet ne l'a pas validée. Ne modifie aucune table existante.
--
-- Contenu : products, product_costs (prix d'achat, réservé aux administrateurs), stock_movements (journal du stock,
-- en ajout seul) et quatre fonctions réservées aux administrateurs : liste complète, création, modification et photo.
--
-- Principes
--  * Tout est protégé par RLS ; les droits sur les tables sont en liste blanche (revoke all puis grant ciblés).
--  * Visiteurs (anon) ET comptes connectés (authenticated, administrateurs compris) lisent la TABLE products seulement
--    pour les produits ACTIFS et seulement les colonnes utiles à la boutique publique (droits par colonne : ni référence
--    interne, ni seuil d'alerte, ni indicateur de démonstration, ni dates). Les droits par colonne sont attachés au RÔLE,
--    pas à la personne : « authenticated » ne peut donc pas distinguer un administrateur d'un autre compte. La vue
--    complète de l'administrateur passe par la fonction admin_list_products() (contrôle du rôle admin à l'intérieur).
--    Conséquence : une requête sur la table doit nommer ses colonnes (`select *` est refusé) et ne pas filtrer sur
--    « active » (la RLS s'en charge). Le prix d'achat n'est jamais exposé : table séparée, lisible par un administrateur.
--  * Aucun client n'écrit directement dans ces tables : la création et la modification passent par des fonctions
--    SECURITY DEFINER qui vérifient le rôle admin, valident les valeurs et laissent une trace.
--  * Le stock (stock_qty) n'est jamais modifié sans mouvement correspondant dans stock_movements. À l'étape 1, seul le
--    stock initial existe (créé avec le produit) ; les entrées, sorties, ajustements et retours arrivent à l'étape 2.
--  * Montants en FCFA entiers. Un produit n'est jamais supprimé : on le désactive.
--
-- Limites de la protection du journal stock_movements (à connaître)
--  * Elle empêche les rôles applicatifs (anon, authenticated, y compris un administrateur de la boutique) de modifier
--    ou d'effacer l'historique : aucun droit d'écriture, aucune politique d'écriture, et un déclencheur qui refuse
--    UPDATE, DELETE et TRUNCATE (y compris à service_role).
--  * Elle n'est PAS une garantie absolue : le propriétaire de la base (rôle postgres) et tout superutilisateur peuvent
--    désactiver ou supprimer le déclencheur (ALTER TABLE ... DISABLE TRIGGER, DROP TRIGGER), changer session_replication_role
--    ou modifier les tables. service_role et le propriétaire peuvent aussi INSÉRER directement des lignes, sans passer par
--    les fonctions. Ces accès sont réservés au serveur (jamais à placer dans le navigateur) : la clé service_role et
--    l'accès à l'éditeur SQL doivent rester strictement confidentiels. Pour une preuve d'audit infalsifiable, il faudrait
--    un journal externe ou une signature des lignes, hors périmètre ici.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.products (
  id                  text primary key check (id ~ '^[a-z0-9-]{2,60}$'),   -- identifiant d'URL, comme public.services
  sku                 text not null unique check (sku ~ '^[A-Z0-9][A-Z0-9._-]{1,39}$'),
  name                text not null check (char_length(btrim(name)) between 2 and 120),
  category            text not null check (char_length(btrim(category)) between 2 and 60),
  short_description   text not null default '' check (char_length(short_description) <= 300),
  description         text not null default '' check (char_length(description) <= 2000),
  features            text[] not null default '{}' check (cardinality(features) <= 20),
  usage_tips          text check (usage_tips is null or char_length(usage_tips) <= 1000),
  volume              text check (volume is null or char_length(volume) <= 60),
  image_url           text check (image_url is null or (image_url ~ '^https://[^[:space:]]+$' and char_length(image_url) <= 500)),
  sale_price          integer not null check (sale_price >= 0),
  stock_qty           integer not null default 0 check (stock_qty >= 0),   -- jamais négatif, même en cas de concurrence
  low_stock_threshold integer not null default 0 check (low_stock_threshold >= 0),
  active              boolean not null default true,
  is_demo             boolean not null default false,                      -- true = donnée de démonstration, à remplacer
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index products_category_idx on public.products (category);

-- Prix d'achat : table séparée pour qu'aucun droit de lecture sur products ne puisse l'exposer.
-- Pas de ligne = coût inconnu (les marges ne sont calculées que lorsque le coût est connu).
create table public.product_costs (
  product_id text primary key references public.products (id),
  cost_price integer not null check (cost_price >= 0)
);

create type public.stock_movement_type as enum ('initial', 'purchase_receipt', 'sale', 'return', 'adjustment');

-- Journal du stock : une ligne par variation, jamais modifiée ni supprimée.
create table public.stock_movements (
  id          bigint generated always as identity primary key,
  product_id  text not null references public.products (id),
  type        public.stock_movement_type not null,
  quantity    integer not null check (quantity <> 0),            -- signée : + entrée, - sortie
  stock_after integer not null check (stock_after >= 0),
  reason      text not null default '' check (char_length(reason) <= 300),
  ref_type    text check (ref_type is null or char_length(ref_type) <= 40),   -- ex. 'sale', 'purchase_order'
  ref_id      text check (ref_id is null or char_length(ref_id) <= 80),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index stock_movements_product_idx on public.stock_movements (product_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Intégrité
-- ---------------------------------------------------------------------------

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as
$$
begin
  new.updated_at := now();
  return new;
end
$$;
create trigger products_touch before update on public.products
  for each row execute function private.touch_updated_at();

-- Le journal est en ajout seul pour tous les rôles applicatifs et pour service_role. Le propriétaire de la base peut
-- encore désactiver ce déclencheur : voir « Limites de la protection du journal » en tête de fichier.
create function private.stock_movements_append_only() returns trigger
language plpgsql set search_path = '' as
$$
begin
  raise exception 'stock_movements est en ajout seul' using errcode = '42501';
end
$$;
create trigger stock_movements_no_change before update or delete on public.stock_movements
  for each row execute function private.stock_movements_append_only();
create trigger stock_movements_no_truncate before truncate on public.stock_movements
  for each statement execute function private.stock_movements_append_only();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.products        enable row level security;
alter table public.product_costs   enable row level security;
alter table public.stock_movements enable row level security;

-- Visiteurs et comptes connectés : produits actifs uniquement. Les produits inactifs ne sont visibles de l'administrateur
-- que par admin_list_products().
create policy "produits actifs lisibles" on public.products
  for select to anon, authenticated using (active);
create policy "admin lit les coûts" on public.product_costs
  for select to authenticated using ((select private.is_admin()));
create policy "admin lit les mouvements" on public.stock_movements
  for select to authenticated using ((select private.is_admin()));
-- Aucune politique d'écriture : seules les fonctions ci-dessous (SECURITY DEFINER) écrivent.

-- ---------------------------------------------------------------------------
-- Privilèges SQL (liste blanche)
-- ---------------------------------------------------------------------------

revoke all on table public.products, public.product_costs, public.stock_movements from anon, authenticated;
revoke all on sequence public.stock_movements_id_seq from anon, authenticated;
-- Visiteurs et comptes connectés : seulement les colonnes de la boutique publique (la RLS limite en plus aux produits actifs ;
-- la colonne « active » n'a pas besoin d'être lisible pour que la politique s'applique).
grant select (id, name, category, short_description, description, features, usage_tips, volume, image_url, sale_price, stock_qty)
  on public.products to anon, authenticated;
grant select on public.product_costs, public.stock_movements to authenticated; -- RLS : administrateur

-- ---------------------------------------------------------------------------
-- Fonctions d'administration
-- ---------------------------------------------------------------------------

-- Validation commune. Renvoie un message d'erreur, ou null si tout est valide.
create function private.check_product(
  p_name text, p_sku text, p_category text, p_short text, p_description text, p_features text[],
  p_usage text, p_volume text, p_image_url text, p_sale_price integer, p_cost_price integer, p_threshold integer
) returns text
language plpgsql immutable set search_path = '' as
$$
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 120 then return 'Nom invalide (2 à 120 caractères).'; end if;
  if coalesce(p_sku, '') !~ '^[A-Z0-9][A-Z0-9._-]{1,39}$' then return 'Référence invalide (lettres, chiffres, . _ -, 2 à 40 caractères).'; end if;
  if char_length(btrim(coalesce(p_category, ''))) not between 2 and 60 then return 'Catégorie invalide.'; end if;
  if char_length(coalesce(p_short, '')) > 300 or char_length(coalesce(p_description, '')) > 2000 then return 'Description trop longue.'; end if;
  if cardinality(coalesce(p_features, '{}')) > 20
     or exists (select 1 from unnest(coalesce(p_features, '{}')) f where f is null or char_length(f) > 200) then return 'Caractéristiques invalides.'; end if;
  if char_length(coalesce(p_usage, '')) > 1000 or char_length(coalesce(p_volume, '')) > 60 then return 'Texte trop long.'; end if;
  if p_image_url is not null and (p_image_url !~ '^https://[^[:space:]]+$' or char_length(p_image_url) > 500) then return 'Adresse de photo invalide.'; end if;
  if p_sale_price is null or p_sale_price < 0 or p_sale_price > 100000000 then return 'Prix de vente invalide.'; end if;
  if p_cost_price is not null and (p_cost_price < 0 or p_cost_price > 100000000) then return 'Prix d''achat invalide.'; end if;
  if p_threshold is null or p_threshold < 0 or p_threshold > 1000000 then return 'Seuil d''alerte invalide.'; end if;
  return null;
end
$$;

-- Liste complète pour l'administration : toutes les colonnes, produits inactifs compris, avec le prix d'achat (null = inconnu).
-- Remplace la lecture directe de la table, dont les droits par colonne sont volontairement limités.
create function public.admin_list_products()
returns table (
  id text, sku text, name text, category text, short_description text, description text, features text[],
  usage_tips text, volume text, image_url text, sale_price integer, cost_price integer, stock_qty integer,
  low_stock_threshold integer, active boolean, is_demo boolean, created_at timestamptz, updated_at timestamptz
)
language plpgsql stable security definer set search_path = '' as
$$
#variable_conflict use_column
begin
  if not (select private.is_admin()) then
    raise exception 'réservé aux administrateurs' using errcode = '42501';
  end if;
  return query
    select p.id, p.sku, p.name, p.category, p.short_description, p.description, p.features, p.usage_tips, p.volume,
           p.image_url, p.sale_price, c.cost_price, p.stock_qty, p.low_stock_threshold, p.active, p.is_demo,
           p.created_at, p.updated_at
    from public.products p
    left join public.product_costs c on c.product_id = p.id
    order by p.name, p.id;
end
$$;

-- Création d'un produit (administrateur). Le stock initial crée un mouvement « initial ».
create function public.admin_create_product(
  p_id text, p_sku text, p_name text, p_category text, p_short text, p_description text, p_features text[],
  p_usage text, p_volume text, p_image_url text, p_sale_price integer, p_cost_price integer,
  p_threshold integer, p_initial_qty integer, p_active boolean default true
) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_sku text := upper(btrim(coalesce(p_sku, '')));
  v_bad text;
  v_constraint text;
begin
  if not (select private.is_admin()) then
    raise exception 'réservé aux administrateurs' using errcode = '42501';
  end if;
  if coalesce(p_id, '') !~ '^[a-z0-9-]{2,60}$' then return private.err('invalid_input', 'Identifiant invalide (minuscules, chiffres et tirets).'); end if;
  if p_initial_qty is null or p_initial_qty < 0 or p_initial_qty > 1000000 then return private.err('invalid_input', 'Stock initial invalide.'); end if;
  v_bad := private.check_product(p_name, v_sku, p_category, p_short, p_description, p_features, p_usage, p_volume,
                                 p_image_url, p_sale_price, p_cost_price, p_threshold);
  if v_bad is not null then return private.err('invalid_input', v_bad); end if;

  begin
    insert into public.products (id, sku, name, category, short_description, description, features, usage_tips, volume,
                                 image_url, sale_price, stock_qty, low_stock_threshold, active)
    values (p_id, v_sku, btrim(p_name), btrim(p_category), coalesce(p_short, ''), coalesce(p_description, ''),
            coalesce(p_features, '{}'), nullif(btrim(coalesce(p_usage, '')), ''), nullif(btrim(coalesce(p_volume, '')), ''),
            p_image_url, p_sale_price, p_initial_qty, p_threshold, coalesce(p_active, true));
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    return case when v_constraint = 'products_sku_key'
      then private.err('sku_taken', 'Cette référence existe déjà.')
      else private.err('id_taken', 'Un produit porte déjà cet identifiant.') end;
  end;

  if p_cost_price is not null then
    insert into public.product_costs (product_id, cost_price) values (p_id, p_cost_price);
  end if;
  if p_initial_qty > 0 then
    insert into public.stock_movements (product_id, type, quantity, stock_after, reason, created_by)
    values (p_id, 'initial', p_initial_qty, p_initial_qty, 'Stock initial', (select auth.uid()));
  end if;
  return jsonb_build_object('ok', true, 'id', p_id);
end
$$;

-- Modification d'un produit (administrateur). Ne touche jamais au stock ni à la photo : la photo ne change que par
-- admin_set_product_image(), pour qu'une simple modification du nom, du prix ou du statut ne puisse jamais l'effacer.
create function public.admin_update_product(
  p_id text, p_sku text, p_name text, p_category text, p_short text, p_description text, p_features text[],
  p_usage text, p_volume text, p_sale_price integer, p_cost_price integer,
  p_threshold integer, p_active boolean
) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_sku text := upper(btrim(coalesce(p_sku, '')));
  v_bad text;
begin
  if not (select private.is_admin()) then
    raise exception 'réservé aux administrateurs' using errcode = '42501';
  end if;
  v_bad := private.check_product(p_name, v_sku, p_category, p_short, p_description, p_features, p_usage, p_volume,
                                 null, p_sale_price, p_cost_price, p_threshold);   -- la photo n'est pas concernée ici
  if v_bad is not null then return private.err('invalid_input', v_bad); end if;
  if p_active is null then return private.err('invalid_input', 'Statut invalide.'); end if;

  begin
    update public.products set
      sku = v_sku, name = btrim(p_name), category = btrim(p_category), short_description = coalesce(p_short, ''),
      description = coalesce(p_description, ''), features = coalesce(p_features, '{}'),
      usage_tips = nullif(btrim(coalesce(p_usage, '')), ''), volume = nullif(btrim(coalesce(p_volume, '')), ''),
      sale_price = p_sale_price, low_stock_threshold = p_threshold, active = p_active
    where id = p_id;
  exception when unique_violation then
    return private.err('sku_taken', 'Cette référence existe déjà.');
  end;
  if not found then return private.err('not_found', 'Produit introuvable.'); end if;

  if p_cost_price is null then
    delete from public.product_costs where product_id = p_id;
  else
    insert into public.product_costs (product_id, cost_price) values (p_id, p_cost_price)
    on conflict (product_id) do update set cost_price = excluded.cost_price;
  end if;
  return jsonb_build_object('ok', true, 'id', p_id);
end
$$;

-- Photo d'un produit (administrateur) : n'écrit que image_url.
create function public.admin_set_product_image(p_id text, p_image_url text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
begin
  if not (select private.is_admin()) then
    raise exception 'réservé aux administrateurs' using errcode = '42501';
  end if;
  if p_image_url is not null and (p_image_url !~ '^https://[^[:space:]]+$' or char_length(p_image_url) > 500) then
    return private.err('invalid_input', 'Adresse de photo invalide.');
  end if;
  update public.products set image_url = p_image_url where id = p_id;
  if not found then return private.err('not_found', 'Produit introuvable.'); end if;
  return jsonb_build_object('ok', true);
end
$$;

-- Droits d'exécution : fermés par défaut, ouverts aux seuls comptes connectés (le rôle admin est vérifié dans la fonction).
revoke all on function private.touch_updated_at(), private.stock_movements_append_only() from public, anon, authenticated;
revoke all on function private.check_product(text, text, text, text, text, text[], text, text, text, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function
  public.admin_list_products(),
  public.admin_create_product(text, text, text, text, text, text, text[], text, text, text, integer, integer, integer, integer, boolean),
  public.admin_update_product(text, text, text, text, text, text, text[], text, text, integer, integer, integer, boolean),
  public.admin_set_product_image(text, text)
  from public, anon, authenticated;
grant execute on function
  public.admin_list_products(),
  public.admin_create_product(text, text, text, text, text, text, text[], text, text, text, integer, integer, integer, integer, boolean),
  public.admin_update_product(text, text, text, text, text, text, text[], text, text, integer, integer, integer, boolean),
  public.admin_set_product_image(text, text)
  to authenticated;
