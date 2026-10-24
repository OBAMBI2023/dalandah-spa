-- ⚠️ DONNÉES DE DÉMONSTRATION : prix, durées et créneaux fictifs (src/data/settings.ts : demoPrices = true).
-- Chaque ligne porte is_demo = true. Ce fichier est joué par `supabase db reset` (local/test) et
-- n'est PAS appliqué par `supabase db push` : à ne pas exécuter en production.
-- À remplacer par les tarifs et horaires officiels, saisis via l'administration.

insert into public.time_slots (slot, is_demo) values
  ('09:00', true), ('10:30', true), ('12:00', true), ('14:00', true), ('15:30', true), ('17:00', true);

-- duration_min = durée opérationnelle (créneau bloqué) ; duration_label = libellé affiché au client.
-- « Nattes et tresses » : libellé « 2 h et + » (durée réelle inconnue). Hypothèse retenue : 180 min bloquées.
insert into public.services (id, name, category, description, duration_min, duration_label, price_fcfa, sort_order, is_demo) values
  ('soin-visage-eclat',  'Soin du visage éclat',            'visage',   'Nettoyage, vapeur et masque pour une peau fraîche.',          60,  '60 min',   15000, 10, true),
  ('nettoyage-profond',  'Nettoyage de peau en profondeur', 'visage',   'Un soin complet pour purifier la peau du visage.',            75,  '75 min',   20000, 20, true),
  ('massage-relaxant',   'Massage relaxant',                'massage',  'Massage du corps aux gestes enveloppants.',                   60,  '60 min',   20000, 30, true),
  ('massage-dos',        'Massage dos et nuque',            'massage',  'Ciblé sur les zones de tension du haut du corps.',            30,  '30 min',   10000, 40, true),
  ('soin-corps-complet', 'Soin corps complet',              'corps',    'Gommage et enveloppement pour un corps doux et lumineux.',    60,  '60 min',   25000, 50, true),
  ('pedicure',           'Pédicure soin',                   'onglerie', 'Soin des pieds et des ongles, en douceur.',                   45,  '45 min',    8000, 60, true),
  ('manucure',           'Manucure soin',                   'onglerie', 'Soin des mains et des ongles.',                               40,  '40 min',    7000, 70, true),
  ('shampoing-soin',     'Shampoing et soin capillaire',    'coiffure', 'Lavage et soin pour des cheveux nourris.',                    45,  '45 min',    7000, 80, true),
  ('nattes',             'Nattes et tresses',               'coiffure', 'Nattes collées, tresses et coiffures protectrices.',          180, '2 h et +', 15000, 90, true),
  ('rituel-spa',         'Rituel spa complet',              'spa',      'Massage, soin du visage et soin des pieds réunis.',           120, '2 h',      40000, 100, true);
