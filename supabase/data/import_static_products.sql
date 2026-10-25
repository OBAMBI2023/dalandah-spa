-- Import des 6 produits de démonstration du code (src/data/products.ts) dans public.products.
-- ⚠️ DONNÉES DE DÉMONSTRATION : prix, stocks et références (SKU) sont provisoires, tous marqués is_demo = true.
-- À remplacer par les vrais produits depuis l'administration (Boutique).
--
-- N'est PAS un seed : il n'est jamais joué par `supabase db reset` (hors de supabase/seed.sql et des migrations).
-- À exécuter une seule fois par le propriétaire du projet (éditeur SQL), APRÈS la migration 20261026000000_products_catalog.sql.
--
-- Rejouable sans risque :
--  * `on conflict do nothing` : un produit dont l'identifiant OU la référence existe déjà est ignoré. Rien n'est écrasé,
--    donc les modifications faites depuis l'administration sont conservées.
--  * Le mouvement de stock « initial » n'est créé que pour les produits réellement insérés par cette exécution : pas de doublon.
--  * Un produit à stock 0 (le coffret) est créé SANS mouvement : un mouvement de quantité 0 est de toute façon refusé par la base.
--  * Exécuté dans l'éditeur SQL en tant que propriétaire : il n'utilise pas les fonctions d'administration (qui exigent une
--    session d'administrateur) ; created_by reste donc vide pour ces mouvements initiaux.
--  * Aucune suppression. Aucune table existante n'est modifiée. Aucun prix d'achat n'est inventé (coût inconnu).
--  * Les photos restent celles du code : image_url est vide, l'application retombe sur l'image locale du même identifiant.
--  * Le seuil d'alerte (3) est un choix provisoire de démonstration.

with inserted as (
  insert into public.products
    (id, sku, name, category, short_description, description, features, sale_price, stock_qty, low_stock_threshold, active, is_demo)
  values
    ('savon-melisse-2en1', 'DAL-SAV-MEL', 'Savon Mélisse 2 en 1', 'Nettoyants',
     'Le savon de la gamme Dalanda Cosmétique.',
     'Savon Mélisse 2 en 1 de la gamme Dalanda Cosmétique, pour votre routine de toilette au quotidien.',
     array['Gamme Dalanda Cosmétique', 'Format pot'], 6000, 20, 3, true, true),
    ('mousse-nettoyante', 'DAL-MOU-NET', 'Mousse nettoyante', 'Soins du visage',
     'Une mousse légère pour le nettoyage du visage.',
     'Mousse nettoyante en flacon pompe de la gamme Dalanda Cosmétique.',
     array['Gamme Dalanda Cosmétique', 'Flacon pompe'], 5000, 15, 3, true, true),
    ('gel-douche', 'DAL-GEL-DOU', 'Gel douche', 'Soins du corps',
     'Gel douche pour un moment de douceur sous la douche.',
     'Gel douche de la gamme Dalanda Cosmétique.',
     array['Gamme Dalanda Cosmétique'], 5500, 12, 3, true, true),
    ('huile-caviar', 'DAL-HUI-CAV', 'Huile Caviar', 'Hydratation',
     'Huile de la gamme Dalanda Cosmétique.',
     'Huile Caviar en flacon pompe de la gamme Dalanda Cosmétique.',
     array['Gamme Dalanda Cosmétique', 'Flacon pompe'], 8000, 10, 3, true, true),
    ('savon-cristal', 'DAL-SAV-CRI', 'Savon cristal', 'Soins du corps',
     'Savon en cristaux de la gamme Dalanda.',
     'Savon cristal de la gamme Dalanda Cosmétique.',
     array['Gamme Dalanda Cosmétique', 'Format pot'], 5000, 8, 3, true, true),
    -- Indisponible dans le code (available: false) : stock 0.
    ('coffret-routine', 'DAL-COF-RTN', 'Coffret routine Dalanda', 'Coffrets beauté',
     'Une sélection de produits pour une routine complète.',
     'Coffret réunissant plusieurs produits Dalanda Cosmétique. Composition exacte à confirmer avec la boutique.',
     array['Plusieurs produits de la gamme', 'Composition à confirmer'], 25000, 0, 0, true, true)
  on conflict do nothing
  returning id, stock_qty
)
insert into public.stock_movements (product_id, type, quantity, stock_after, reason)
select id, 'initial', stock_qty, stock_qty, 'Stock initial (import des produits de démonstration)'
from inserted
where stock_qty > 0;
