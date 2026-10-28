-- Commandes de la boutique : enregistrement réel dans Supabase, suivi par l'administration, stock transactionnel.
--
-- Principes
--  * Aucune écriture directe : anon et authenticated n'ont aucun droit d'écriture sur ces tables. Tout passe par des fonctions
--    SECURITY DEFINER qui valident les données, relisent prix et stock dans public.products et écrivent dans UNE transaction.
--  * Les montants du navigateur ne sont jamais acceptés : seuls l'identifiant du produit et la quantité sont lus.
--  * Le stock est décrémenté à la création de la commande (journal stock_movements, type 'sale') et restitué à l'annulation
--    (type 'return'). Les lignes de produits sont verrouillées dans l'ordre de leur identifiant : pas d'interblocage, pas de stock négatif.
--  * Idempotence : une même clé (générée par le navigateur pour un panier) ne crée jamais deux commandes.
--  * Livraison : delivery_fee NULL = « à confirmer ». total_amount = sous-total + frais connus.
--  * Une commande n'est jamais supprimée (déclencheur) ; ses lignes conservent nom et prix au moment de l'achat.

-- ---------------------------------------------------------------------------
-- Types et tables
-- ---------------------------------------------------------------------------

create type public.order_status as enum ('pending', 'confirmed', 'preparing', 'delivering', 'delivered', 'cancelled');

create table public.orders (
  id                    uuid primary key default gen_random_uuid(),
  order_number          text not null unique check (order_number ~ '^CMD-[0-9A-Z]{10}$'),
  user_id               uuid references auth.users (id) on delete set null,   -- NULL : commande invitée
  customer_name         text not null check (char_length(customer_name) between 2 and 100),
  customer_phone        text not null check (customer_phone ~ '^[0-9 .+-]{8,30}$'),
  phone_key             text generated always as (private.normalize_phone(customer_phone)) stored,
  delivery_address      text not null check (char_length(delivery_address) between 3 and 300),
  delivery_area         text not null check (char_length(delivery_area) between 2 and 100),
  delivery_instructions text not null default '' check (char_length(delivery_instructions) <= 300),
  status                public.order_status not null default 'pending',
  subtotal              integer not null check (subtotal >= 0),
  delivery_fee          integer check (delivery_fee is null or delivery_fee >= 0),   -- NULL : à confirmer
  total_amount          integer generated always as (subtotal + coalesce(delivery_fee, 0)) stored,
  idempotency_key       text not null unique check (idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  cancel_reason         text not null default '' check (char_length(cancel_reason) <= 300),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  confirmed_at          timestamptz,
  preparing_at          timestamptz,
  delivering_at         timestamptz,
  delivered_at          timestamptz,
  cancelled_at          timestamptz
);
create index orders_status_idx on public.orders (status, created_at desc);
create index orders_phone_idx  on public.orders (phone_key);

create table public.order_items (
  id            bigint generated always as identity primary key,
  order_id      uuid not null references public.orders (id) on delete restrict,
  product_id    text not null references public.products (id),
  product_name  text not null check (char_length(product_name) between 2 and 120),   -- instantané au moment de la commande
  unit_price    integer not null check (unit_price >= 0),                              -- instantané, FCFA
  quantity      integer not null check (quantity between 1 and 99),
  line_total    integer generated always as (unit_price * quantity) stored,
  unique (order_id, product_id)
);
create index order_items_product_idx on public.order_items (product_id);

create trigger orders_touch before update on public.orders
  for each row execute function private.touch_updated_at();

create function private.orders_no_delete() returns trigger
language plpgsql set search_path = '' as
$$
begin
  raise exception 'les commandes ne se suppriment pas : annulez-les' using errcode = '42501';
end
$$;
create trigger orders_no_delete before delete on public.orders
  for each row execute function private.orders_no_delete();
create trigger order_items_no_delete before delete on public.order_items
  for each row execute function private.orders_no_delete();

-- ---------------------------------------------------------------------------
-- RLS et privilèges (liste blanche)
-- ---------------------------------------------------------------------------

alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

create policy "admin lit les commandes" on public.orders
  for select to authenticated using ((select private.is_admin()));
create policy "admin lit les lignes de commande" on public.order_items
  for select to authenticated using ((select private.is_admin()));
-- Aucune politique d'écriture : seules les fonctions ci-dessous (SECURITY DEFINER) écrivent.

revoke all on table public.orders, public.order_items from anon, authenticated;
revoke all on sequence public.order_items_id_seq from anon, authenticated;
grant select on public.orders, public.order_items to authenticated;   -- RLS : administrateur

-- ---------------------------------------------------------------------------
-- Création d'une commande (public : invités et comptes connectés)
-- ---------------------------------------------------------------------------

-- Résumé d'une commande, partagé par les fonctions ci-dessous.
create function private.order_json(p_id uuid) returns jsonb
language sql stable set search_path = '' as
$$
  select jsonb_build_object(
    'id', o.id, 'order_number', o.order_number, 'status', o.status,
    'customer_name', o.customer_name, 'customer_phone', o.customer_phone,
    'delivery_address', o.delivery_address, 'delivery_area', o.delivery_area,
    'delivery_instructions', o.delivery_instructions,
    'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee, 'total_amount', o.total_amount,
    'cancel_reason', o.cancel_reason, 'created_at', o.created_at, 'updated_at', o.updated_at,
    'confirmed_at', o.confirmed_at, 'preparing_at', o.preparing_at, 'delivering_at', o.delivering_at,
    'delivered_at', o.delivered_at, 'cancelled_at', o.cancelled_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'name', i.product_name,
                                          'unit_price', i.unit_price, 'quantity', i.quantity, 'line_total', i.line_total)
                       order by i.id)
      from public.order_items i where i.order_id = o.id), '[]'::jsonb))
  from public.orders o where o.id = p_id
$$;

create function public.create_store_order(
  p_name text, p_phone text, p_address text, p_area text, p_instructions text,
  p_items jsonb, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_name     text;
  v_phone    text;
  v_digits   text;
  v_address  text;
  v_area     text;
  v_notes    text;
  v_key      text;
  v_pkey     text;
  v_existing uuid;
  v_el       jsonb;
  v_lines    jsonb := '[]'::jsonb;
  v_line     record;
  v_p        public.products%rowtype;
  v_subtotal integer := 0;
  v_id       uuid;
  v_number   text;
  v_try      integer := 0;
  v_after    integer;
  v_constraint text;
begin
  v_key := btrim(coalesce(p_idempotency_key, ''));
  if v_key !~ '^[A-Za-z0-9_-]{16,64}$' then
    return private.err('invalid_input', 'Commande invalide, rechargez la page et réessayez.');
  end if;

  -- Nouvel envoi de la même commande : on renvoie la commande déjà enregistrée, sans rien recréer.
  select o.id into v_existing from public.orders o where o.idempotency_key = v_key;
  if found then
    return jsonb_build_object('ok', true, 'replayed', true, 'order', private.order_json(v_existing));
  end if;

  if not private.rate_limit_hit('order:ip', private.client_ip(), 10, interval '1 hour') then
    return private.err('rate_limited', 'Trop de tentatives. Réessayez plus tard.');
  end if;

  v_name    := btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[\x01-\x1f\x7f]', ' ', 'g'), '\s+', ' ', 'g'));
  v_phone   := btrim(coalesce(p_phone, ''));
  v_digits  := regexp_replace(v_phone, '\D', '', 'g');
  v_address := btrim(regexp_replace(regexp_replace(coalesce(p_address, ''), '[\x01-\x1f\x7f]', ' ', 'g'), '\s+', ' ', 'g'));
  v_area    := btrim(regexp_replace(regexp_replace(coalesce(p_area, ''), '[\x01-\x1f\x7f]', ' ', 'g'), '\s+', ' ', 'g'));
  v_notes   := left(btrim(regexp_replace(coalesce(p_instructions, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', ' ', 'g')), 300);
  if char_length(v_name) not between 2 and 100 then
    return private.err('invalid_input', 'Nom invalide.');
  end if;
  if v_phone !~ '^[0-9 .+-]{8,30}$' or char_length(v_digits) not between 8 and 15 then
    return private.err('invalid_input', 'Téléphone invalide.');
  end if;
  if char_length(v_address) not between 3 and 300 then
    return private.err('invalid_input', 'Adresse de livraison invalide.');
  end if;
  if char_length(v_area) not between 2 and 100 then
    return private.err('invalid_input', 'Commune ou quartier invalide.');
  end if;

  v_pkey := private.normalize_phone(v_phone);

  -- Panier : tableau de {product_id, quantity}. Seuls ces deux champs sont lus ; les doublons sont regroupés.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    return private.err('invalid_input', 'Votre panier est vide ou invalide.');
  end if;
  for v_el in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_el) <> 'object'
       or coalesce(v_el->>'product_id', '') !~ '^[a-z0-9-]{2,60}$'
       or coalesce(v_el->>'quantity', '') !~ '^[1-9][0-9]{0,2}$' then
      return private.err('invalid_input', 'Votre panier est vide ou invalide.');
    end if;
  end loop;

  -- Comme create_booking : seules les tentatives au contenu valide comptent dans la limite par téléphone.
  if not private.rate_limit_hit('order:phone', v_pkey, 10, interval '1 hour') then
    return private.err('rate_limited', 'Trop de tentatives. Réessayez plus tard.');
  end if;

  -- Verrouillage dans l'ordre des identifiants (pas d'interblocage entre deux commandes simultanées).
  for v_line in
    select e->>'product_id' as product_id, sum((e->>'quantity')::integer) as qty
    from jsonb_array_elements(p_items) e
    group by 1 order by 1
  loop
    if v_line.qty > 99 then
      return private.err('invalid_input', 'Quantité trop élevée pour un produit.');
    end if;
    select * into v_p from public.products p where p.id = v_line.product_id and p.active for update;
    if not found then
      return private.err('product_unavailable', 'Un produit de votre panier n''est plus disponible.');
    end if;
    if v_p.stock_qty < v_line.qty then
      return jsonb_build_object('ok', false, 'code', 'out_of_stock',
        'error', format('Stock insuffisant pour « %s » (%s disponible).', v_p.name, v_p.stock_qty),
        'product_id', v_p.id, 'available', v_p.stock_qty);
    end if;
    v_lines    := v_lines || jsonb_build_object('id', v_p.id, 'name', v_p.name, 'price', v_p.sale_price, 'qty', v_line.qty);
    v_subtotal := v_subtotal + v_p.sale_price * v_line.qty;
  end loop;

  loop
    v_try := v_try + 1;
    v_number := 'CMD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    begin
      insert into public.orders
        (order_number, user_id, customer_name, customer_phone, delivery_address, delivery_area,
         delivery_instructions, subtotal, idempotency_key)
      values
        (v_number, (select auth.uid()), v_name, v_phone, v_address, v_area, v_notes, v_subtotal, v_key)
      returning id into v_id;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'orders_idempotency_key_key' then   -- envoi simultané de la même commande
        select o.id into v_existing from public.orders o where o.idempotency_key = v_key;
        return jsonb_build_object('ok', true, 'replayed', true, 'order', private.order_json(v_existing));
      end if;
      if v_try >= 5 then
        return private.err('server_error', 'Enregistrement impossible, réessayez.');
      end if;
    end;
  end loop;

  -- Lignes, stock et journal : même transaction que la commande.
  for v_line in
    select l->>'id' as id, l->>'name' as name, (l->>'price')::integer as price, (l->>'qty')::integer as qty
    from jsonb_array_elements(v_lines) l
  loop
    insert into public.order_items (order_id, product_id, product_name, unit_price, quantity)
    values (v_id, v_line.id, v_line.name, v_line.price, v_line.qty);
    update public.products set stock_qty = stock_qty - v_line.qty where id = v_line.id returning stock_qty into v_after;
    insert into public.stock_movements (product_id, type, quantity, stock_after, reason, ref_type, ref_id, created_by)
    values (v_line.id, 'sale', -v_line.qty, v_after, 'Commande ' || v_number, 'order', v_number, (select auth.uid()));
  end loop;

  return jsonb_build_object('ok', true, 'replayed', false, 'order', private.order_json(v_id));
exception when others then
  raise warning 'create_store_order: % (%)', sqlerrm, sqlstate;   -- journal serveur uniquement, sans donnée personnelle
  return private.err('server_error', 'Enregistrement impossible, réessayez.');
end
$$;

-- Suivi invité : numéro de commande ET téléphone requis (même principe que get_booking).
create function public.get_order(p_number text, p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_key    text;
  v_id     uuid;
begin
  if not private.rate_limit_hit('order-lookup:ip', private.client_ip(), 30, interval '1 hour') then
    return private.err('rate_limited', 'Trop de tentatives. Réessayez plus tard.');
  end if;
  if char_length(v_digits) not between 8 and 15 or p_number is null or char_length(p_number) > 30 then
    return private.err('not_found', 'Commande introuvable.');
  end if;
  v_key := private.normalize_phone(p_phone);
  if not private.rate_limit_hit('order-lookup:phoneip', v_key || '|' || private.client_ip(), 10, interval '1 hour')
     or not private.rate_limit_hit('order-lookup:phone', v_key, 100, interval '1 hour') then
    return private.err('rate_limited', 'Trop de tentatives. Réessayez plus tard.');
  end if;
  select o.id into v_id from public.orders o where o.order_number = upper(btrim(p_number)) and o.phone_key = v_key;
  if not found then
    return private.err('not_found', 'Commande introuvable.');
  end if;
  return jsonb_build_object('ok', true, 'order', private.order_json(v_id));
end
$$;

-- ---------------------------------------------------------------------------
-- Administration (rôle admin vérifié AVANT tout accès aux données ; sinon erreur 42501)
-- ---------------------------------------------------------------------------

create function public.admin_list_orders(p_status public.order_status default null, p_limit integer default 200)
returns jsonb
language plpgsql security definer set search_path = '' as
$$
begin
  if not (select private.is_admin()) then
    raise exception 'réservé aux administrateurs' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(private.order_json(x.id) order by x.created_at desc)
    from (select o.id, o.created_at from public.orders o
          where p_status is null or o.status = p_status
          order by o.created_at desc limit greatest(1, least(coalesce(p_limit, 200), 500))) x
  ), '[]'::jsonb);
end
$$;

-- Changement de statut. Transitions : pending → confirmed → preparing → delivering → delivered ;
-- annulation possible avant la livraison, avec restitution du stock. delivered et cancelled sont définitifs.
create function public.admin_update_order_status(p_id uuid, p_status public.order_status, p_reason text default '')
returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_o     public.orders%rowtype;
  v_item  record;
  v_after integer;
  v_ok    boolean;
begin
  if not (select private.is_admin()) then
    raise exception 'réservé aux administrateurs' using errcode = '42501';
  end if;
  select * into v_o from public.orders o where o.id = p_id for update;
  if not found then return private.err('not_found', 'Commande introuvable.'); end if;
  if v_o.status = p_status then return jsonb_build_object('ok', true, 'order', private.order_json(p_id)); end if;

  v_ok := case v_o.status
    when 'pending'    then p_status in ('confirmed', 'cancelled')
    when 'confirmed'  then p_status in ('preparing', 'cancelled')
    when 'preparing'  then p_status in ('delivering', 'cancelled')
    when 'delivering' then p_status in ('delivered', 'cancelled')
    else false end;
  if not v_ok then return private.err('invalid_transition', 'Ce changement de statut n''est pas possible.'); end if;

  if p_status = 'cancelled' then
    for v_item in select i.product_id, i.quantity from public.order_items i where i.order_id = p_id order by i.product_id loop
      update public.products set stock_qty = stock_qty + v_item.quantity where id = v_item.product_id returning stock_qty into v_after;
      insert into public.stock_movements (product_id, type, quantity, stock_after, reason, ref_type, ref_id, created_by)
      values (v_item.product_id, 'return', v_item.quantity, v_after, 'Annulation ' || v_o.order_number, 'order', v_o.order_number, (select auth.uid()));
    end loop;
  end if;

  update public.orders set
    status        = p_status,
    confirmed_at  = case when p_status = 'confirmed'  then now() else confirmed_at end,
    preparing_at  = case when p_status = 'preparing'  then now() else preparing_at end,
    delivering_at = case when p_status = 'delivering' then now() else delivering_at end,
    delivered_at  = case when p_status = 'delivered'  then now() else delivered_at end,
    cancelled_at  = case when p_status = 'cancelled'  then now() else cancelled_at end,
    cancel_reason = case when p_status = 'cancelled'  then left(btrim(coalesce(p_reason, '')), 300) else cancel_reason end
  where id = p_id;
  return jsonb_build_object('ok', true, 'order', private.order_json(p_id));
end
$$;

-- Frais de livraison (NULL = remettre « à confirmer »). Impossible une fois la commande livrée ou annulée.
create function public.admin_set_order_delivery_fee(p_id uuid, p_fee integer) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare v_o public.orders%rowtype;
begin
  if not (select private.is_admin()) then
    raise exception 'réservé aux administrateurs' using errcode = '42501';
  end if;
  if p_fee is not null and p_fee not between 0 and 1000000 then
    return private.err('invalid_input', 'Frais de livraison invalides.');
  end if;
  select * into v_o from public.orders o where o.id = p_id for update;
  if not found then return private.err('not_found', 'Commande introuvable.'); end if;
  if v_o.status in ('delivered', 'cancelled') then
    return private.err('invalid_transition', 'Cette commande n''est plus modifiable.');
  end if;
  update public.orders set delivery_fee = p_fee where id = p_id;
  return jsonb_build_object('ok', true, 'order', private.order_json(p_id));
end
$$;

-- ---------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------

revoke all on function private.orders_no_delete(), private.order_json(uuid) from public, anon, authenticated;
revoke all on function
  public.create_store_order(text, text, text, text, text, jsonb, text),
  public.get_order(text, text),
  public.admin_list_orders(public.order_status, integer),
  public.admin_update_order_status(uuid, public.order_status, text),
  public.admin_set_order_delivery_fee(uuid, integer)
  from public, anon, authenticated;
grant execute on function
  public.create_store_order(text, text, text, text, text, jsonb, text),
  public.get_order(text, text)
  to anon, authenticated;
grant execute on function
  public.admin_list_orders(public.order_status, integer),
  public.admin_update_order_status(uuid, public.order_status, text),
  public.admin_set_order_delivery_fee(uuid, integer)
  to authenticated;
