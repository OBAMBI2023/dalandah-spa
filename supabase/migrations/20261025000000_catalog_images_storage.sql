-- Photos du catalogue : bucket Supabase Storage « catalog-images » et politiques d'accès.
-- Reflète EXACTEMENT ce qui est déjà déployé sur le projet ylixnbhpgbyofhvnfzqw (bucket public, 5 Mo, JPEG / PNG / WebP ;
-- écriture réservée aux administrateurs via private.is_admin()). Sert à une installation propre : sur le projet actuel,
-- tout existe déjà et ce fichier ne crée rien (chaque objet n'est créé que s'il manque, sous le même nom).
--
-- Le schéma `storage` n'existe que sur Supabase : le bloc est ignoré dans les bases de test locales (PGlite).
-- Ne modifie aucune table de l'application. La colonne public.services.image_url existe déjà.
-- Lecture publique : l'URL publique des images fonctionne sans connexion (le bucket est public) ; la politique de lecture
-- déployée autorise aussi le listing du bucket, ce qui est sans conséquence pour des photos de catalogue publiques.

do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'schéma storage absent : photos du catalogue ignorées';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('catalog-images', 'catalog-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'catalog_images_public_read') then
    create policy catalog_images_public_read on storage.objects for select to public
      using (bucket_id = 'catalog-images');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'catalog_images_admin_insert') then
    create policy catalog_images_admin_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'catalog-images' and (select private.is_admin()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'catalog_images_admin_update') then
    create policy catalog_images_admin_update on storage.objects for update to authenticated
      using (bucket_id = 'catalog-images' and (select private.is_admin()))
      with check (bucket_id = 'catalog-images' and (select private.is_admin()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'catalog_images_admin_delete') then
    create policy catalog_images_admin_delete on storage.objects for delete to authenticated
      using (bucket_id = 'catalog-images' and (select private.is_admin()));
  end if;
end
$$;
