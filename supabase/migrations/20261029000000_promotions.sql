-- Promotions (module « Promotions » de l'administration, page publique /promotions, ancienne page « Offres »).
-- Non appliquée tant que le propriétaire du projet ne l'a pas validée. NON DESTRUCTIVE : elle ne crée que de nouveaux objets ; elle ne
-- modifie, ne lit et ne supprime aucune ligne de services, products, bookings ni d'aucune autre table, et ne touche pas à create_booking.
--
-- Principes
--  * Les promotions sont INFORMATIVES : une annonce avec prix ou pourcentage affichés. Aucun prix de services ou de products, aucun montant
--    de réservation n'en dépend. Les prix annoncés sont ceux SAISIS dans la promotion (jamais recalculés depuis les tarifs en base).
--  * Type : 'price' (prix initial + prix promotionnel annoncés, réduction calculée), 'percent' (pourcentage annoncé) ou 'announcement'
--    (simple annonce, sans prix). Les champs de prix et de pourcentage sont imposés par le type (contrainte de table).
--  * Lien facultatif vers UNE prestation (service_id) OU UN produit (product_id), jamais les deux. Une promotion peut aussi rester une
--    simple annonce sans lien.
--  * Période facultative : starts_on / ends_on sont des DATES (fin incluse) ; l'une, l'autre, les deux ou aucune peuvent être vides.
--    Abidjan est à UTC+0 toute l'année (pas d'heure d'été) : current_date de la base est la date d'Abidjan.
--  * Publication : status = 'draft' (brouillon), 'published' (publiée) ou 'disabled' (désactivée). Le statut AFFICHÉ (programmée, active,
--    expirée) est CALCULÉ à partir du statut et des dates ; il n'est jamais enregistré. Suppression LOGIQUE : deleted_at (aucune ligne
--    n'est jamais supprimée par l'application, aucun droit DELETE n'est accordé).
--  * RLS : le public (anon et authenticated) ne lit QUE les promotions publiées, non supprimées et dans leur période. Les administrateurs
--    lisent tout et sont les seuls à écrire (insert / update). ATTENTION : un administrateur connecté lit donc aussi les brouillons,
--    programmées, expirées et désactivées sur le site : l'application publique filtre elle aussi sur le statut calculé (voir src/lib/promotions.ts).
--  * Images : bucket existant « catalog-images », dossier promotions/<id>/ (politiques Storage existantes : écriture réservée aux administrateurs).

create table public.promotions (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null check (char_length(title) between 2 and 120 and title !~ '[[:cntrl:]]'),
  description         text not null default '' check (char_length(description) <= 1000),
  image_url           text check (image_url is null or char_length(image_url) <= 2000),
  kind                text not null check (kind in ('price', 'percent', 'announcement')),
  original_price_fcfa integer check (original_price_fcfa is null or original_price_fcfa between 1 and 100000000),
  promo_price_fcfa    integer check (promo_price_fcfa is null or promo_price_fcfa between 0 and 100000000),
  percent_off         integer check (percent_off is null or percent_off between 1 and 99),
  starts_on           date,
  ends_on             date,
  status              text not null default 'draft' check (status in ('draft', 'published', 'disabled')),
  service_id          text references public.services (id) on delete set null,
  product_id          text references public.products (id) on delete set null,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Champs imposés par le type
  constraint promotions_kind_fields check (
    (kind = 'price'        and original_price_fcfa is not null and promo_price_fcfa is not null and promo_price_fcfa < original_price_fcfa and percent_off is null)
    or (kind = 'percent'   and percent_off is not null and original_price_fcfa is null and promo_price_fcfa is null)
    or (kind = 'announcement' and percent_off is null and original_price_fcfa is null and promo_price_fcfa is null)
  ),
  constraint promotions_period check (starts_on is null or ends_on is null or ends_on >= starts_on),
  constraint promotions_one_link check (service_id is null or product_id is null)
);

create index promotions_service_idx on public.promotions (service_id) where service_id is not null;
create index promotions_product_idx on public.promotions (product_id) where product_id is not null;

-- Date de dernière modification tenue par la base (non modifiable depuis le navigateur).
create function private.touch_promotion() returns trigger
language plpgsql set search_path = '' as
$$
begin
  new.updated_at := now();
  new.created_at := old.created_at;
  return new;
end
$$;
revoke all on function private.touch_promotion() from public, anon, authenticated;

create trigger promotions_touch before update on public.promotions
  for each row execute function private.touch_promotion();

-- ---------------------------------------------------------------------------
-- RLS et privilèges (liste blanche)
-- ---------------------------------------------------------------------------

alter table public.promotions enable row level security;

create policy "promotions publiees lisibles" on public.promotions
  for select to anon, authenticated
  using (status = 'published' and deleted_at is null
         and (starts_on is null or starts_on <= current_date)
         and (ends_on is null or ends_on >= current_date));

create policy "admin lit les promotions" on public.promotions
  for select to authenticated using ((select private.is_admin()));
create policy "admin cree les promotions" on public.promotions
  for insert to authenticated with check ((select private.is_admin()));
create policy "admin modifie les promotions" on public.promotions
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
-- Aucune politique ni droit DELETE : la suppression est logique (deleted_at).

revoke all on table public.promotions from anon, authenticated;
grant select on public.promotions to anon;
grant select, insert, update on public.promotions to authenticated;
