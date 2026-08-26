-- gold.deputy_card : rendre cohérents le numérateur de participation et le
-- taux qui en découle.
--
-- Défaut corrigé (relevé du 26 août 2026, tâche 8 du plan 6). La vue créée par
-- 20260825204803_gold_views laissait `participation_vote_count` à NULL quand le
-- LEFT JOIN sur `eligible_votes` ne trouvait aucune ligne, mais appliquait
-- `COALESCE(ev.voted_ballot_count, 0)` au *même* numérateur pour calculer
-- `participation_rate`. Les deux colonnes disaient donc l'inverse l'une de
-- l'autre à partir de la même donnée : sur Chantal Bouloux (PA793528, 22-2),
-- `participation_vote_count` valait NULL — la fiche affichait « Aucun scrutin
-- publié en décompte nominatif ne recoupe un mandat tenu par ce député » — et
-- `participation_rate` valait 0.0000, soit « 0,00 % » affiché deux lignes plus
-- bas avec le badge « Calculé par PoliGraph ». Une seule ligne sur 567 était
-- concernée ; une seule suffit, il s'agit d'une personne nommée.
--
-- Pourquoi NULL et non zéro. Le numérateur compte les scrutins éligibles sur
-- lesquels la source *nomme* le député, quelle que soit sa position — y compris
-- NON_VOTANT : `stage-scrutins.ts` parcourt toutes les clés de
-- `VOTE_CATEGORY_KEYS` (`pour`, `contre`, `abstention`, `nonVotant` et leurs
-- pluriels) et `normalize-scrutins.ts` reporte `raw.categorie` sans filtre.
-- Mesuré sur les données réelles : 38 323 positions NON_VOTANT en base, dont
-- 23 383 sur des scrutins de la 17e législature publiés en décompte nominatif.
-- Un député qui siège sans jamais voter a donc bien une ligne par scrutin.
-- L'absence totale de lignes ne peut donc pas signifier « il n'a participé à
-- aucun scrutin » : elle signifie que la source ne le nomme nulle part. Le cas
-- est vérifié sur Bouloux — `bronze.an_position_raw` ne porte que 1 349 lignes
-- pour PA793528, toutes de la 16e législature, aucune de la 17e alors que son
-- mandat du 2024-07-07 est ouvert. Publier « 0 % de participation » sur une
-- personne réelle à partir d'un silence de la source serait une affirmation
-- que la donnée ne soutient pas. C'est d'ailleurs ce que le commentaire de
-- colonne promettait déjà : « jamais un zéro trompeur ».
--
-- Règle implémentée : `participation_rate` n'est calculé que lorsque le
-- numérateur ET le dénominateur existent tous les deux. Les trois colonnes
-- `participation_*` sont désormais NULL ou renseignées ensemble, à ceci près
-- que le dénominateur seul reste publié quand il est connu — c'est un fait
-- vérifiable (8 434 scrutins éligibles recoupent le mandat de Bouloux) et c'est
-- lui qui rend l'absence explicable côté fiche.
--
-- Prisma ne modélise pas les vues matérialisées : la vue est redéfinie à la
-- main ici. La migration 20260825204803_gold_views n'est pas modifiée — elle
-- est appliquée sur les deux bases, et réécrire un historique déjà appliqué a
-- déjà provoqué un incident réel sur un plan antérieur.
--
-- gold.deputy_vote n'est pas concernée et n'est pas retouchée.

DROP MATERIALIZED VIEW gold.deputy_card;

CREATE MATERIALIZED VIEW gold.deputy_card AS
WITH current_mandate AS (
  -- Le mandat parlementaire actuellement ouvert de la 17e législature, un
  -- par personne : c'est cette ouverture qui définit la population de la vue.
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
  -- confondues : c'est ce que la section « Mandats » de la fiche énumère.
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
  -- nominatif complet. Ce chiffre alimente le total affiché en tête de fiche ;
  -- il n'entre pas dans le calcul de participation.
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
  SELECT b.id, b.date
  FROM silver.parliamentary_ballot b
  JOIN silver.legislature l ON l.id = b.legislature_id AND l.number = 17
  WHERE b.publication_mode = 'DecompteNominatif' AND b.date IS NOT NULL
),

eligible_ballot_denominator AS (
  -- Dénominateur honnête : seuls les scrutins tombant dans un intervalle de
  -- mandat réellement tenu par la personne comptent. Un député entré en
  -- cours de législature (ou parti puis revenu) ne pouvait pas voter les
  -- scrutins hors de ces intervalles.
  --
  -- Volontairement séparée du numérateur (eligible_votes ci-dessous) plutôt
  -- que combinées en un seul JOIN + LEFT JOIN ballot_position : mesuré sur
  -- les données réelles, la version combinée prenait près de 9 minutes contre
  -- quelques secondes ici.
  SELECT mi.person_id, COUNT(*) AS eligible_ballot_count
  FROM mandate_intervals mi
  JOIN eligible_ballots eb
    ON eb.date >= mi.start_date
   AND (mi.end_date IS NULL OR eb.date <= mi.end_date)
  GROUP BY mi.person_id
),

eligible_votes AS (
  -- Numérateur : scrutins éligibles sur lesquels la source nomme le député,
  -- quelle que soit la position enregistrée (NON_VOTANT compris). Une
  -- jointure d'égalité sur ballot_id, indexée, contre eligible_ballots —
  -- jamais contre mandate_intervals — pour ne pas reproduire le coût du
  -- range join ci-dessus.
  --
  -- L'absence de ligne ici n'est jamais ramenée à zéro (voir l'en-tête) :
  -- elle signifie que la source ne nomme le député sur aucun scrutin
  -- éligible, ce qui n'est pas la même chose que n'avoir participé à aucun.
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
  -- Le taux n'existe que si ses deux termes existent. Aucun COALESCE sur le
  -- numérateur : c'était précisément la source de la contradiction corrigée
  -- par cette migration.
  CASE
    WHEN mf.has_unknown_start THEN NULL
    WHEN ed.eligible_ballot_count IS NULL OR ed.eligible_ballot_count = 0 THEN NULL
    WHEN ev.voted_ballot_count IS NULL THEN NULL
    ELSE ROUND(ev.voted_ballot_count::numeric / ed.eligible_ballot_count, 4)
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
-- utilise volontairement un rafraîchissement plein (CONCURRENTLY est 2 à 3
-- fois plus lent sur les données réelles).
CREATE UNIQUE INDEX deputy_card_person_id_idx ON gold.deputy_card (person_id);

COMMENT ON MATERIALIZED VIEW gold.deputy_card IS
  'Une ligne par député actuellement en exercice de la 17e législature. Les colonnes à partir de mandate_count sont calculées par cette vue (voir computed_status), pas publiées telles quelles par une source.';
COMMENT ON COLUMN gold.deputy_card.computed_status IS
  'Toujours ''COMPUTED''. Marque mandate_count, committee_count, vote_count et les colonnes participation_* comme des agrégats produits par cette vue, distincts des faits OFFICIAL/NORMALIZED publiés par une source (spec §5.7). Les colonnes qui précèdent (identité, circonscription, groupe courant) sont un simple report de silver, chacune traçable via silver.provenance.';
COMMENT ON COLUMN gold.deputy_card.participation_ballot_count IS
  'Dénominateur : nombre de scrutins de la 17e législature publiés en détail nominatif complet et tombant dans un intervalle de mandat réellement tenu par le député. NULL si aucun tel scrutin n''existe, ou si un intervalle de mandat a une date de début inconnue (fenêtre non vérifiable).';
COMMENT ON COLUMN gold.deputy_card.participation_vote_count IS
  'Numérateur : nombre de ces mêmes scrutins éligibles sur lesquels la source nomme le député, quelle que soit la position enregistrée (NON_VOTANT compris — l''import ne filtre aucune catégorie de decompteNominatif). NULL si la source ne le nomme sur aucun : c''est un silence de la source, jamais un zéro constaté, et le distinguer est la raison d''être de cette colonne.';
COMMENT ON COLUMN gold.deputy_card.participation_rate IS
  'participation_vote_count / participation_ballot_count, restreint aux scrutins de la 17e législature publiés en détail nominatif complet et tombant dans un intervalle de mandat réellement tenu par le député. NULL dès que l''un des deux termes est NULL : aucun scrutin éligible dans son mandat, date de début de mandat inconnue (dénominateur non vérifiable), ou aucune position enregistrée sur un scrutin éligible (numérateur introuvable — la source ne le nomme pas, ce qui n''établit pas qu''il fut absent). Jamais un zéro trompeur : un taux publié ici est toujours calculé sur deux termes réellement observés.';
