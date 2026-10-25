# Tests SQL de la migration Supabase

Ces scripts appliquent `supabase/migrations/*.sql` puis `supabase/seed.sql` sur une base PostgreSQL **locale en mémoire**
([PGlite](https://pglite.dev), dépendance de développement). Ils ne contactent jamais le projet Supabase distant.
Le moteur est un vrai PostgreSQL ; les rôles `anon`, `authenticated` et `service_role`, le schéma `auth` et les en-têtes HTTP sont simulés.

| Commande | Contenu |
|---|---|
| `bun run test:sql` | suite principale (droits, RLS, réservation, annulation, limites anti-abus) |
| `bun run test:sql:probe` | sondages (chevauchements, annulations, cas limites) et inventaire des droits |
| `bun run test:sql:guard` | garde des privilèges : liste blanche des fonctions exécutables, `SECURITY DEFINER`, RLS, droits sur les tables |
| `bun run test:sql:limits` | normalisation des numéros (+225, 00225, 8 et 10 chiffres), limites anti-abus, droits de la colonne générée, nattes à 180 min |
| `bun run test:sql:products` | boutique (étape 1) : produits, prix d'achat, journal du stock en ajout seul, fonctions d'administration et RLS |
| `bun run test:sql:products-audit` | audit de l'étape 1 : droits effectifs, contournements du stock et du journal, validations, objets existants inchangés, import des produits de démonstration |
| `bun run test:sql:categories` | catégories de produits : table, normalisation Unicode (NFC, espaces insécables, invisibles, sens d'écriture), unicité insensible à la casse et aux accents combinants, rafales d'équivalents, RLS, droits (anon, non-admin, admin, service_role), amorçage répétable, aucun produit ni stock modifié |
| `bun run test:sql:categories-mutations` | essais de fautes sur la migration des catégories : 19 protections supprimées une à une dans une copie temporaire, chacune doit faire échouer `test:sql:categories` |
| `bun run test:sql:mutations` | ajoute à une copie temporaire des migrations fautives et vérifie que le guard les détecte |
| `bun run test:sql:all` | les neuf, à la suite (code de sortie 0 si tout passe) |

`bun run test` (Vitest) reste réservé aux tests de l'application (`src/**`) et n'exécute pas ces scripts.

`SUPABASE_DIR=<dossier>` permet de lancer une suite sur une autre copie du dossier `supabase/` (par défaut : celui du dépôt).

## Règle pour toute nouvelle migration

Une fonction créée dans `public` est exécutable par `anon` tant qu'elle n'est pas fermée explicitement : les révocations par défaut
ne couvrent que les tables et les séquences. Fermer chaque fonction sensible dans sa migration
(`revoke all on function … from public, anon, authenticated`), l'ouvrir seulement aux rôles prévus, puis lancer
`bun run test:sql:all`. Le guard échoue si une fonction est restée ouverte.

## Ce que ces tests ne prouvent pas

- **Concurrence réelle** : PGlite n'a qu'une seule connexion, aucun appel n'est vraiment simultané.
  Test à faire sur Supabase local (Docker) ou un projet de test, avec au moins 20 appels simultanés sur le même créneau.
- **Couche API** (PostgREST, `request.headers`, `cf-connecting-ip`) : les en-têtes sont simulés.
- **Conseillers Supabase** (`get_advisors`, `supabase db lint`) : à lancer sur une vraie instance.
- **Les rôles et privilèges par défaut de Supabase** : reproduits de façon approchante.
- **La version de PostgreSQL** : PGlite embarque PostgreSQL 18, Supabase peut en utiliser une autre.

Un échec fait sortir le script avec le code 1.
