-- gold.deputy_card et gold.deputy_vote (Plan 4, Task 3).
--
-- Prisma ne modélise pas les vues matérialisées : ce fichier est écrit à la
-- main. Les deux vues sont rafraîchies ensemble par refreshGold()
-- (packages/ingestion/src/gold/refresh.ts), appelée en fin d'import réussi
-- et exposée seule via `poligraph gold refresh`.
--
-- Population des deux vues : les députés *actuellement* en exercice de la
-- 17e législature, c'est-à-dire les personnes ayant un mandat parlementaire
-- (silver.mandate, kind='PARLIAMENTARY', institution Assemblée nationale,
-- législature 17) encore ouvert (end_date IS NULL). Mesuré sur les données
-- réelles : 567 personnes — moins que les 577 sièges de l'hémicycle, l'écart
-- s'expliquant par des sièges dont le remplacement (démission, nomination
-- au gouvernement) n'a pas encore de mandat de suppléant importé au moment
-- de la mesure. Restreindre aux mandats "ouverts" plutôt qu'à toute personne
-- ayant jamais siégé sous cette législature (648 dans les données réelles)
-- est un choix délibéré : une fiche n'a de sens que pour un député qui siège.

CREATE MATERIALIZED VIEW gold.deputy_card AS
WITH current_mandate AS (
  -- Le mandat parlementaire actuellement ouvert de la 17e législature, un
  -- par personne : c'est cette ouverture qui définit la population de la
  -- vue (voir commentaire d'en-tête).
  SELECT DISTINCT ON (m.person_id)
    m.person_id,
    m.start_date,
    m.territory_id
  FROM silver.mandate m
  JOIN silver.institution i ON i.id = m.institution_id AND i.code = 'ASSEMBLEE_NATIONALE'
  JOIN silver.legislature l ON l.id = m.legislature_id AND l.number = 17
  WHERE m.kind = 'PARLIAMENTARY' AND m.end_date IS NULL
  ORDER BY m.person_id, m.start_date DESC NULLS LAST
),

mandate_intervals AS (
  -- Tous les mandats parlementaires de la 17e législature de la personne,
  -- passés et actuel (potentiellement plusieurs : un député nommé au
  -- gouvernement puis revenu siéger a deux intervalles disjoints). Sert au
  -- dénominateur de participation ci-dessous — jamais à la population de la
  -- vue, qui reste `current_mandate`.
  SELECT m.person_id, m.start_date, m.end_date
  FROM silver.mandate m
  JOIN silver.institution i ON i.id = m.institution_id AND i.code = 'ASSEMBLEE_NATIONALE'
  JOIN silver.legislature l ON l.id = m.legislature_id AND l.number = 17
  WHERE m.kind = 'PARLIAMENTARY'
),

mandate_flags AS (
  -- Un intervalle de mandat sans date de début connue rend le dénominateur
  -- de participation invérifiable pour cette personne : on ne peut pas dire
  -- depuis quand elle pouvait voter. Dans les données réelles, ce cas ne se
  -- produit jamais (0 mandat sans start_date sur la 17e législature) ; il
  -- est traité ici pour ne jamais publier un ratio dont l'un des intervalles
  -- est de fenêtre inconnue.
  SELECT person_id, bool_or(start_date IS NULL) AS has_unknown_start
  FROM mandate_intervals
  GROUP BY person_id
),

current_group AS (
  -- Groupe parlementaire courant : l'appartenance à un organe de type
  -- PARLIAMENTARY_GROUP de la 17e législature, encore active en priorité
  -- (end_date NULL), sinon la plus récente.
  SELECT DISTINCT ON (bm.person_id)
    bm.person_id,
    b.id AS body_id,
    b.label,
    b.short_label,
    b.color
  FROM silver.body_membership bm
  JOIN silver.body b
    ON b.id = bm.body_id
   AND b.type = 'PARLIAMENTARY_GROUP'
   AND b.legislature_id = (SELECT id FROM silver.legislature WHERE number = 17)
  ORDER BY bm.person_id,
           (bm.end_date IS NULL) DESC,
           COALESCE(bm.end_date, bm.start_date) DESC NULLS LAST,
           bm.start_date DESC NULLS LAST
),

mandate_totals AS (
  -- Total des mandats parlementaires de la personne, toutes législatures
  -- confondues : c'est ce que la section « Mandats » de la fiche énumère
  -- (ex. Xavier Breton, 5 mandats depuis 2002 — pas seulement le mandat en
  -- cours). Vérifié sur les données réelles : mandate_count(Breton) = 5.
  SELECT m.person_id, COUNT(*) AS mandate_count
  FROM silver.mandate m
  JOIN silver.institution i ON i.id = m.institution_id AND i.code = 'ASSEMBLEE_NATIONALE'
  WHERE m.kind = 'PARLIAMENTARY'
  GROUP BY m.person_id
),

committee_totals AS (
  -- Même logique que mandate_totals : total carrière, pas seulement les
  -- commissions de la législature courante.
  SELECT bm.person_id, COUNT(*) AS committee_count
  FROM silver.body_membership bm
  JOIN silver.body b ON b.id = bm.body_id AND b.type = 'COMMITTEE'
  GROUP BY bm.person_id
),

raw_votes AS (
  -- Décompte brut : toutes les positions enregistrées pour un scrutin de la
  -- 17e législature, y compris celles issues d'un scrutin publié sans détail
  -- nominatif complet (où seuls dissidents et non-votants sont nommés). Ce
  -- chiffre alimente le total affiché en tête de fiche ; il n'entre pas dans
  -- le calcul de participation (voir eligible_ballots et les CTE de
  -- participation ci-dessous), qui exige un univers de scrutins fiable.
  SELECT bp.person_id, COUNT(*) AS vote_count
  FROM silver.ballot_position bp
  JOIN silver.parliamentary_ballot b ON b.id = bp.ballot_id
  JOIN silver.legislature l ON l.id = b.legislature_id AND l.number = 17
  GROUP BY bp.person_id
),

eligible_ballots AS (
  -- Seuls les scrutins publiés en détail nominatif complet ('DecompteNominatif')
  -- permettent de distinguer honnêtement une absence d'un non-vote publié :
  -- sur un scrutin publié en mode « dissidents et position de groupe »,
  -- l'absence d'une ligne de position pour un député signifie que la source
  -- ne l'a pas nommé (il a suivi la position de son groupe), pas qu'il
  -- était absent. Les compter contre lui mentirait sur sa participation.
  -- C'est exactement pour cette raison que publication_mode voyage aussi
  -- jusqu'à gold.deputy_vote (point 3 de la spec de tâche).
  SELECT b.id, b.date
  FROM silver.parliamentary_ballot b
  JOIN silver.legislature l ON l.id = b.legislature_id AND l.number = 17
  WHERE b.publication_mode = 'DecompteNominatif' AND b.date IS NOT NULL
),

eligible_ballot_denominator AS (
  -- Dénominateur honnête : seuls les scrutins tombant dans un intervalle de
  -- mandat réellement tenu par la personne comptent. Un député entré en
  -- cours de législature (ou parti puis revenu) ne pouvait pas voter les
  -- scrutins hors de ces intervalles ; les lui compter comme "manqués"
  -- sous-estimerait sa participation et la présenterait comme un fait
  -- (point 2 de la spec de tâche).
  --
  -- Volontairement séparée du numérateur (eligible_votes ci-dessous) plutôt
  -- que combinées en un seul JOIN + LEFT JOIN ballot_position : mesuré sur
  -- les données réelles, la version combinée (mandate_intervals × 8 434
  -- scrutins éligibles, puis LEFT JOIN vers 1,7 million de positions) prenait
  -- près de 9 minutes. Séparer un simple range join (petit × petit, jamais
  -- plus de quelques millions de paires en mémoire) d'un simple equi-join
  -- indexé sur ballot_id ramène le tout à quelques secondes — voir le
  -- rapport de tâche pour la mesure exacte (~5 s contre ~8 min 55 pour cette
  -- vue seule).
  SELECT mi.person_id, COUNT(*) AS eligible_ballot_count
  FROM mandate_intervals mi
  JOIN eligible_ballots eb
    ON eb.date >= mi.start_date
   AND (mi.end_date IS NULL OR eb.date <= mi.end_date)
  GROUP BY mi.person_id
),

eligible_votes AS (
  -- Numérateur : positions réellement enregistrées sur un scrutin éligible.
  -- Une jointure d'égalité sur ballot_id, indexée, contre eligible_ballots —
  -- jamais contre mandate_intervals — pour ne pas reproduire le coût du
  -- range join ci-dessus.
  SELECT bp.person_id, COUNT(DISTINCT bp.ballot_id) AS voted_ballot_count
  FROM silver.ballot_position bp
  JOIN eligible_ballots eb ON eb.id = bp.ballot_id
  GROUP BY bp.person_id
)

SELECT
  p.id AS person_id,
  ext.value AS an_id,
  p.display_name,
  p.first_name,
  p.last_name,
  p.civility,
  p.birth_date,
  t.code AS constituency_code,
  t.label AS constituency_label,
  split_part(t.code, '-', 1) AS department_code,
  cg.body_id AS current_group_id,
  cg.label AS current_group_label,
  cg.short_label AS current_group_short_label,
  cg.color AS current_group_color,
  -- --- à partir d'ici, données calculées : voir computed_status ---
  COALESCE(mt.mandate_count, 0) AS mandate_count,
  COALESCE(ct.committee_count, 0) AS committee_count,
  COALESCE(rv.vote_count, 0) AS vote_count,
  CASE WHEN mf.has_unknown_start THEN NULL ELSE ed.eligible_ballot_count END
    AS participation_ballot_count,
  CASE WHEN mf.has_unknown_start THEN NULL ELSE ev.voted_ballot_count END
    AS participation_vote_count,
  CASE
    WHEN mf.has_unknown_start THEN NULL
    WHEN COALESCE(ed.eligible_ballot_count, 0) = 0 THEN NULL
    ELSE ROUND(COALESCE(ev.voted_ballot_count, 0)::numeric / ed.eligible_ballot_count, 4)
  END AS participation_rate,
  'COMPUTED'::text AS computed_status,
  now() AS refreshed_at
FROM current_mandate cm
JOIN silver.person p ON p.id = cm.person_id
LEFT JOIN silver.territory t ON t.id = cm.territory_id
LEFT JOIN current_group cg ON cg.person_id = cm.person_id
LEFT JOIN mandate_totals mt ON mt.person_id = cm.person_id
LEFT JOIN committee_totals ct ON ct.person_id = cm.person_id
LEFT JOIN raw_votes rv ON rv.person_id = cm.person_id
LEFT JOIN eligible_ballot_denominator ed ON ed.person_id = cm.person_id
LEFT JOIN eligible_votes ev ON ev.person_id = cm.person_id
LEFT JOIN mandate_flags mf ON mf.person_id = cm.person_id
LEFT JOIN silver.external_identifier ext
  ON ext.owner_type = 'Person' AND ext.owner_id = p.id
 AND ext.source_id = 'AN' AND ext.kind = 'ACTEUR_UID';

-- Documente l'invariance « une personne ne peut apparaître qu'une fois » et
-- rendrait REFRESH MATERIALIZED VIEW CONCURRENTLY possible. refreshGold()
-- (packages/ingestion/src/gold/refresh.ts) utilise volontairement un
-- rafraîchissement plein : mesuré sur les données réelles, CONCURRENTLY est
-- 2 à 3 fois plus lent (voir le commentaire de refreshGold() pour le
-- chiffrage exact). L'index reste créé : il documente l'invariance et
-- permettrait de revenir à CONCURRENTLY si le profil d'usage change.
CREATE UNIQUE INDEX deputy_card_person_id_idx ON gold.deputy_card (person_id);

COMMENT ON MATERIALIZED VIEW gold.deputy_card IS
  'Une ligne par député actuellement en exercice de la 17e législature. Les colonnes à partir de mandate_count sont calculées par cette vue (voir computed_status), pas publiées telles quelles par une source.';
COMMENT ON COLUMN gold.deputy_card.computed_status IS
  'Toujours ''COMPUTED''. Marque mandate_count, committee_count, vote_count et les colonnes participation_* comme des agrégats produits par cette vue, distincts des faits OFFICIAL/NORMALIZED publiés par une source (spec §5.7). Les colonnes qui précèdent (identité, circonscription, groupe courant) sont un simple report de silver, chacune traçable via silver.provenance.';
COMMENT ON COLUMN gold.deputy_card.participation_rate IS
  'voted_ballot_count / eligible_ballot_count, restreint aux scrutins de la 17e législature publiés en détail nominatif complet et tombant dans un intervalle de mandat réellement tenu par le député. NULL si aucun scrutin éligible n''est encore tombé dans son mandat, ou si un intervalle de mandat a une date de début inconnue (dénominateur non vérifiable) : jamais un zéro trompeur.';

-- gold.deputy_vote : une ligne par position de vote d'un député actuel de la
-- 17e législature, jointe à son scrutin. Alimente l'onglet « activité de
-- vote », paginé. Restreinte à la population de deputy_card — c'est la
-- seule population que l'API sert en V1 (spec §8.1) — mais couvre les
-- positions de TOUTES les législatures où la personne a siégé : un député
-- réélu depuis la 15e législature garde son historique de vote complet,
-- filtrable côté GraphQL par législature.
--
-- publication_mode voyage jusqu'ici sans transformation : sur un scrutin
-- publié hors détail nominatif complet, l'absence d'une ligne pour un
-- scrutin donné (le JOIN silver.ballot_position ne produit aucune ligne)
-- signifie que la source ne l'a pas nommé, jamais qu'il était absent. Sans
-- ce mode sur chaque ligne, l'API ne peut pas faire cette distinction pour
-- les scrutins où une ligne existe malgré tout (ex. un dissident nommé).
-- Mesuré sur les données réelles : 150 des 1 731 841 lignes portent un
-- publication_mode autre que 'DecompteNominatif' (héritées de la 14e
-- législature, dont 710 scrutins sont publiés sans détail nominatif complet
-- — voir packages/ingestion/src/checks/recount-ballots.ts).
CREATE MATERIALIZED VIEW gold.deputy_vote AS
SELECT
  bp.id AS ballot_position_id,
  bp.person_id,
  bp.ballot_id,
  b.date AS ballot_date,
  b.title AS ballot_title,
  b.number AS ballot_number,
  l.number AS legislature_number,
  bp.position,
  bp.by_delegation,
  bp.body_id_at_vote AS group_id_at_vote,
  grp.label AS group_label_at_vote,
  grp.short_label AS group_short_label_at_vote,
  grp.color AS group_color_at_vote,
  b.publication_mode
FROM silver.ballot_position bp
JOIN silver.parliamentary_ballot b ON b.id = bp.ballot_id
LEFT JOIN silver.legislature l ON l.id = b.legislature_id
LEFT JOIN silver.body grp ON grp.id = bp.body_id_at_vote
WHERE bp.person_id IN (
  SELECT m.person_id
  FROM silver.mandate m
  JOIN silver.institution i ON i.id = m.institution_id AND i.code = 'ASSEMBLEE_NATIONALE'
  JOIN silver.legislature cl ON cl.id = m.legislature_id AND cl.number = 17
  WHERE m.kind = 'PARLIAMENTARY' AND m.end_date IS NULL
);

-- Requise pour l'unicité (une position de vote apparaît exactement une fois)
-- et rendrait REFRESH MATERIALIZED VIEW CONCURRENTLY possible ; voir le
-- commentaire équivalent sur deputy_card_person_id_idx ci-dessus pour
-- pourquoi refreshGold() ne l'utilise pas.
CREATE UNIQUE INDEX deputy_vote_ballot_position_id_idx ON gold.deputy_vote (ballot_position_id);
CREATE INDEX deputy_vote_person_id_idx ON gold.deputy_vote (person_id);
CREATE INDEX deputy_vote_ballot_date_idx ON gold.deputy_vote (ballot_date);

COMMENT ON MATERIALIZED VIEW gold.deputy_vote IS
  'Une ligne par position de vote (silver.ballot_position) d''un député actuel de la 17e législature, jointe à son scrutin. Simple report de faits OFFICIAL/NORMALIZED de silver — aucune colonne calculée, donc pas de marqueur computed_status ici (contrairement à gold.deputy_card).';
COMMENT ON COLUMN gold.deputy_vote.publication_mode IS
  'Mode de publication du scrutin par l''Assemblée nationale (ex. DecompteNominatif, DecompteDissidentsPositionGroupe). Sur un mode autre que DecompteNominatif, l''absence de ligne pour un scrutin donné signifie que la source n''a pas nommé ce député, jamais qu''il était absent : ne pas interpréter un scrutin manquant comme un NON_VOTANT.';
