# Migration `20261024000000_init_schema.sql` (v2) : notes de conception

**Statut : non appliquée.** Testée sur un PostgreSQL local en mémoire (PGlite), jamais sur le projet Supabase distant.
Les données de démonstration sont dans `supabase/seed.sql` (jouées par `supabase db reset`, pas par `db push`).

## Décisions appliquées

| # | Décision | Où |
|---|---|---|
| 1 | Réservations sans compte autorisées | `create_booking` / `get_booking` / `cancel_booking` accessibles à `anon`, `user_id` nul |
| 2 | Téléphone : 8 à 15 chiffres, séparateurs `espace . + -` seulement | `create_booking`, CHECK sur `bookings.phone` |
| 3 | Nom : 2 caractères minimum (100 maximum), espaces réduits, caractères de contrôle retirés | `create_booking`, CHECK |
| 4 | Fuseau `Africa/Abidjan` | `salon_settings.timezone` verrouillé par CHECK ; heures stockées en heure locale (`timestamp`) |
| 5 | Réservation au moins 2 h à l'avance, 180 jours maximum | `salon_settings.min_notice_hours`, `max_days_ahead` |
| 6 | Annulation jusqu'à 2 h avant, ensuite « contactez le salon » | `salon_settings.cancel_notice_hours`, code `too_late` |
| 7 | Administrateur seul rôle privilégié, extensible | enum `app_role` + `private.has_role()` |
| 8 | Supabase source de vérité des créneaux | table `time_slots`, fonction `get_availability` |
| 9 | Atomicité des réservations concurrentes | contrainte d'exclusion `bookings_no_overlap` (aucun « lire puis écrire ») |
| 10 | Validations strictes, limitation des abus | voir « Anti-abus » |

Les règles chiffrées (2 h, 180 jours, 3 rendez-vous par numéro) sont dans `salon_settings` : l'administrateur peut les changer sans migration.

## Durées et capacité

**Durée opérationnelle.** `services.duration_min` est le temps réellement bloqué ; `duration_label` n'est qu'un libellé.
« Nattes et tresses » est affichée « 2 h et + » : la durée réelle est inconnue. **Hypothèse retenue : 180 min** (seed, marquée `is_demo`).
- Un rendez-vous de nattes à 09:00 bloque 09:00 → 12:00, donc aussi le créneau de 10:30. Le créneau de 12:00 reste libre (fin exclusive).
- Trop court (2 h) : risque de chevauchement avec la cliente suivante. Trop long : des créneaux sont refusés à tort. **À faire confirmer par le salon**, puis corriger `duration_min` depuis l'administration.
- Le modèle ne sait pas dire « durée à confirmer » : si une prestation est vraiment ouverte (« et + »), il faudra soit une durée maximale, soit un statut « en attente de confirmation » (décision à prendre).

**Capacité, solution simple (implémentée).** Le salon traite un rendez-vous à la fois : la contrainte
`exclude using gist (tsrange(starts_at, ends_at) with &&) where (status = 'confirmed')` interdit tout chevauchement.
Aucune donnée sur les employées ni les cabines n'existe, donc aucune capacité n'est inventée.

**Capacité, solution évolutive (non implémentée).** Quand le nombre d'employées ou de cabines sera connu :
1. `create extension btree_gist;` et une table `resources (id, name, active)` (une ligne « Salon » au départ).
2. `bookings.resource_id` (nullable, rempli avec la ressource par défaut, puis `not null`).
3. Remplacer la contrainte par `exclude using gist (resource_id with =, tsrange(starts_at, ends_at) with &&) where (status = 'confirmed')`.
4. `create_booking` choisit la première ressource libre ; `get_availability` renvoie « disponible » si au moins une l'est.
Migration non destructive : les réservations existantes sont rattachées à la ressource par défaut.

**Horaires d'ouverture.** Aucune donnée : la fin d'un soin long (17:00 + 180 min = 20:00) n'est pas comparée à une heure de fermeture. Point ouvert.

## Sécurité

- **RLS partout.** `anon` lit seulement `services` actifs, `time_slots` actifs et `salon_settings`. Aucun accès direct à `bookings`, `profiles`, `user_roles`.
- **Privilèges en liste blanche.** `revoke all` puis `grant` ciblés ; `TRUNCATE`, `REFERENCES`, `TRIGGER` retirés. Le droit de modifier une réservation est limité aux colonnes `status`, `cancelled_at`, `cancelled_by` (administrateur uniquement par RLS) : un administrateur ne peut pas changer prix ou date par l'API.
- **`security definer`** : toutes avec `set search_path = ''`, objets qualifiés. Helpers (`is_admin`, `has_role`, limiteur) dans le schéma `private`, non exposé par l'API ; `anon` n'a ni `USAGE` ni `EXECUTE` dessus.
- **Pas d'escalade de rôle.** `user_roles` n'a aucune politique d'écriture : le premier administrateur s'ajoute à la main (éditeur SQL).
- **Valeurs de confiance.** Nom du soin, durée et prix viennent de `services` et sont copiés dans la réservation (instantané). Le navigateur n'envoie que l'identifiant.
- **Erreurs.** Messages génériques et codes stables (`invalid_input`, `slot_unavailable`, `too_early`, `too_far`, `phone_limit`, `rate_limited`, `not_found`, `not_active`, `too_late`, `service_not_found`, `server_error`). Les erreurs internes vont dans le journal serveur (`raise warning`), pas au client. Introuvable est identique pour une mauvaise référence et un mauvais téléphone.
- **Consultation et annulation invitées.** Référence **et** téléphone exigés. Le téléphone est comparé après normalisation (voir ci-dessous). Référence de 10 caractères hexadécimaux issus de `gen_random_uuid()`.
- **Droits EXECUTE.** Les révocations par défaut (`alter default privileges … revoke … from anon, authenticated`) protègent les tables et séquences, **pas les fonctions** : toute nouvelle fonction est exécutable par `PUBLIC` tant qu'on ne la ferme pas. Chaque fonction sensible doit donc être révoquée explicitement (`revoke all on function … from public, anon, authenticated`) puis ouverte aux seuls rôles prévus. Le guard (`bun run test:sql:guard`) échoue si une fonction reste exécutable par `anon` hors de la liste blanche. (Une révocation globale `alter default privileges revoke execute on functions from public` existe mais affecterait aussi les fonctions des extensions : non retenue.)
- **Colonne générée `phone_key`.** Elle appelle `private.normalize_phone` avec les droits de l'appelant : la fonction est donc exécutable par `authenticated` (administrateur) et `service_role`, sinon toute modification d'une réservation échoue. Elle est pure et ne manipule aucune donnée.

## Numéros de téléphone

`private.normalize_phone` : chiffres seuls, retrait d'un `00` initial, puis retrait de l'indicatif `225` **uniquement** s'il précède exactement 8 chiffres (ancien format) ou 10 chiffres (format actuel). Les numéros étrangers sont conservés en entier.
- `0707070707`, `07 07 07 07 07`, `+225 07 07 07 07 07`, `+2250707070707`, `00225 0707070707`, `225 0707070707` → même clé `0707070707`.
- `07070707`, `+225 07070707`, `00225 07070707` → même clé `07070707` (ancien format accepté).
- `0507070707`, `0107070707` et `0707070707` restent distincts (opérateurs différents) ; un numéro étranger ne fusionne jamais avec un numéro ivoirien.
- **Limite connue :** un ancien numéro à 8 chiffres n'est pas rapproché du même numéro écrit à 10 chiffres (il faut le ressaisir de la même façon). Hypothèse à confirmer : plan de numérotation ivoirien (8 chiffres avant 2021, 10 depuis).
- La clé sert à la limite de rendez-vous à venir : tous les formats d'un même numéro comptent ensemble.

## Anti-abus

Couches en base (testées, limites provisoires) :

| Opération | Par IP | Par numéro + IP | Par numéro (toutes IP) |
|---|---:|---:|---:|
| Consultation / annulation | 30 par heure | 10 par heure | 100 par heure |
| Création de réservation | 10 par heure | 5 par heure | 20 par heure |

- La limite par numéro + IP bloque une même IP qui s'acharne ; le plafond par numéro, plus haut, bloque la force brute répartie sur beaucoup d'IP sans permettre à un tiers de verrouiller facilement une cliente (30 tentatives d'un tiers ne l'empêchent plus de consulter ni d'annuler).
- Consultation et annulation partagent les mêmes compteurs.
- 3 rendez-vous à venir maximum par numéro, tous formats confondus (verrou consultatif : pas de dépassement en concurrence).
- Les compteurs sont conservés même en cas de refus (les fonctions retournent un résultat, elles ne lèvent pas d'exception).
- **Risque résiduel :** un tiers disposant de nombreuses IP peut épuiser le plafond de 20 réservations par heure d'un numéro. Seule une vérification du numéro (code par SMS ou WhatsApp) le supprime.

**Avant la mise en production (obligatoire) : CAPTCHA.** Deux options équivalentes :
1. *Edge Function* `book` : vérifie un jeton Cloudflare Turnstile (secret côté serveur uniquement), puis appelle `create_booking` avec le rôle `service_role`. Retirer ensuite l'accès direct :
   `revoke execute on function public.create_booking(text,date,text,text,text,text) from anon, authenticated;`
   `grant execute on function public.create_booking(text,date,text,text,text,text) to service_role;`
   (Transmettre l'IP du client à la fonction, sinon le limiteur voit l'IP de l'Edge Function.)
2. *Connexion anonyme Supabase avec CAPTCHA* : chaque invité obtient un `user_id` stable ; limiter ensuite les fonctions à `authenticated`.

À vérifier sur le projet réel : l'en-tête `cf-connecting-ip` est bien présent dans `request.headers`. À défaut, le limiteur retombe sur `x-forwarded-for` puis `unknown` (compteur partagé, donc plus strict).

## Adaptations frontend nécessaires (non faites)

| Fichier | Aujourd'hui | À faire |
|---|---|---|
| `src/lib/bookings.ts` | stockage `localStorage`, anti-doublon local | appeler `get_availability`, `create_booking`, `get_booking`, `cancel_booking` ; garder localement seulement la liste `{ref, téléphone}` des réservations invitées |
| Référence | `DLD-` + 6 caractères base 36 générés côté client | utiliser celle du serveur : `DLD-` + 10 hexadécimaux ; supprimer `newRef` |
| Annulation | `cancelBooking(ref)` | `cancelBooking(ref, phone)` ; gérer `too_late`, `rate_limited` ; griser le bouton si `can_cancel` est faux |
| Champs | `duration`, `price`, `serviceName`, `slot` | `duration_label`, `price_fcfa`, `service_name` ; `slot` lu en `HH:MM:SS` hors RPC : couper à 5 caractères |
| Créneaux pris | `bookedSlots()` local | `get_availability(date, service)` : dépend du soin choisi |
| `src/data/services.ts` | tableau en dur | lire `public.services` ; les images restent locales (`id` → image) tant que `image_url` est vide |
| `src/data/settings.ts` | `timeSlots`, téléphones | `timeSlots` vient de `time_slots` ; lire `salon_settings` pour le préavis (2 h), les 180 jours, l'annulation |
| Dates | `new Date()` du navigateur | calculer « aujourd'hui » et le préavis en heure d'Abidjan ; plafonner le calendrier à 180 jours |
| Nom, téléphone | ≥ 2 caractères ; 8–15 chiffres | déjà identiques au serveur, rien à changer |
| « Mes rendez-vous » | liste locale | connecté : `select` sur `bookings` (RLS) ; invité : `get_booking` par réservation enregistrée, à la demande (10 consultations/h par couple numéro + IP, 100/h par numéro) |

## Tests

Exécutés sur PGlite (vrai moteur PostgreSQL compilé en WebAssembly), avec rôles `anon`, `authenticated`, `service_role`, schéma `auth` et en-têtes HTTP **simulés** (`bun run test:sql:all`) :

| Suite | Vérifications | Contenu |
|---|---:|---|
| `test.mjs` | 68 | droits, RLS, réservation, annulation, validations, limites par IP et par numéro, cliente connectée, administrateur |
| `probe.mjs` | 19 | chevauchements dans les deux sens, annulations, cas limites, inventaire des droits |
| `guard.mjs` | 14 | liste blanche des fonctions exécutables, `SECURITY DEFINER`, RLS, privilèges sur les tables |
| `limits.mjs` | 54 | normalisation (+225, 00225, 8 et 10 chiffres), limites 5/10/20/30/100, non-verrouillage d'une cliente, droits de la colonne générée, nattes à 180 min |
| `mutations.mjs` | 13 | le guard détecte 12 migrations fautives (fonction publique non fermée, table sans RLS, droit accordé à `anon`…) et laisse passer le témoin |

**Non couverts, à faire sur Supabase local (`supabase start`, Docker requis) ou un projet de test :**
- vraie concurrence (plusieurs connexions simultanées sur le même créneau) ;
- passage par PostgREST (droits, en-têtes `request.headers`, `cf-connecting-ip`) ;
- `get_advisors` (sécurité et performance) après application ;
- rejeu de la migration (elle n'est volontairement pas idempotente : base vierge uniquement).

## Exigences avant la mise en production

1. **MFA administrateur obligatoire.** Activer l'authentification multifacteur dans Supabase Auth, inscrire le premier administrateur, puis, dans une migration ultérieure, ajouter aux politiques « admin … » la condition `(select auth.jwt() ->> 'aal') = 'aal2'`. Ne l'ajouter qu'après l'inscription au MFA, sinon l'administrateur se verrouille. Non incluse dans cette migration.
2. **CAPTCHA** (Edge Function Turnstile ou connexion anonyme), avec transmission de l'IP réelle du client (voir « Anti-abus »).
3. **Vérification du numéro** par code, ou acceptation explicite du risque résiduel décrit plus haut.
4. **Tests sur PostgreSQL réel** : concurrence (au moins 20 appels simultanés sur le même créneau), API (PostgREST, `cf-connecting-ip`), `supabase db lint`, `get_advisors`. Docker n'est pas installé : à faire sur un projet de test.
5. **Remplacement du seed** par les tarifs, durées et créneaux officiels (`is_demo`).
6. Chaque nouvelle fonction sensible fermée explicitement, et `bun run test:sql:all` au vert avant toute migration.

## Points encore ouverts

1. Durée réelle de « Nattes et tresses » et d'éventuelles autres prestations « et + » (retenue : 180 min).
2. Horaires d'ouverture et de fermeture (non modélisés).
3. Capacité réelle : une seule prestation à la fois (retenu), ou plusieurs employées ou cabines.
4. Conservation des données d'une cliente supprimée (`user_id` passe à nul, nom et téléphone restent).
5. Rôle « gestionnaire » : à ajouter plus tard avec `alter type public.app_role add value 'manager'`.
6. Ancien numéro à 8 chiffres et numéro à 10 chiffres non rapprochés : faut-il imposer le format à 10 chiffres dans l'application ?
