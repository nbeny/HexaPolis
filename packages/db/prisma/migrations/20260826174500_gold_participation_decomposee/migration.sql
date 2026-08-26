-- gold.deputy_card : décomposer la participation au lieu de publier un taux
-- unique, illisible sans les chiffres qui le composent.
--
-- Défaut corrigé (relevé du 26 août 2026, tâche 8 du plan 6, écart 1). La vue
-- publiait `participation_rate` = scrutins éligibles sur lesquels la source
-- nomme le député / scrutins éligibles, et le front l'affichait sous
-- « Taux de participation » avec le badge « Calculé par PoliGraph ». Or le
-- numérateur comptait toutes les positions, NON_VOTANT comprise. Mesuré sur
-- les données réelles de la 17e législature :
--
--   Yaël Braun-Pivet    8 434 / 8 434 = 100,00 %, dont 8 341 NON_VOTANT
--   Sébastien Chenu     1 753 / 8 434 =  20,78 %, dont   776 NON_VOTANT
--   Alexis Corbière     1 610 / 8 434 =  19,09 %, dont     0 NON_VOTANT
--
-- Mme Braun-Pivet préside l'Assemblée nationale. Sa fiche affirmait qu'elle
-- avait participé à 100 % des scrutins alors qu'une position pour, contre ou
-- abstention n'est enregistrée pour elle que sur 93 des 8 434. Le chiffre
-- publié disait l'inverse de ce que la donnée porte.
--
-- Pourquoi ne pas simplement sortir NON_VOTANT du numérateur. Cela ramènerait
-- le taux de Mme Braun-Pivet à 1,10 % sous le même libellé : un député qui ne
-- siégerait jamais. Aussi faux, dans l'autre sens. Les deux lectures — « elle
-- participe à tout » et « elle ne participe à rien » — sont tirées du même
-- chiffre selon un fait que le chiffre ne contient pas. Aucun pourcentage seul
-- ne peut porter cette information.
--
-- Ce que fait cette migration : elle remplace le couple
-- (participation_vote_count, participation_rate) par une décomposition dont
-- chaque terme est un décompte observé, et un taux dont le libellé de colonne
-- dit exactement ce qu'il divise.
--
--   participation_ballot_count      dénominateur, inchangé
--   participation_named_count       scrutins éligibles où la source le nomme
--   participation_expressed_count   dont POUR, CONTRE ou ABSTENTION
--   participation_non_voting_count  dont NON_VOTANT
--   participation_expressed_rate    expressed / ballot_count
--
-- `participation_non_voting_count` est la colonne qui rend le cas lisible :
-- 8 341 pour Mme Braun-Pivet, 776 pour M. Chenu, 0 pour M. Corbière. Elle
-- remonte jusqu'à la fiche, elle ne reste pas en base.
--
-- Ce que PoliGraph n'écrit pas. NON_VOTANT recouvre des situations qui n'ont
-- rien à voir entre elles ; la source ne publie pas de motif et la vue n'en
-- déduit aucun. Aucun traitement particulier n'est appliqué à un député plutôt
-- qu'à un autre : les décomptes sont publiés tels quels, la lecture appartient
-- au lecteur.
--
-- Renommage plutôt que réutilisation. `participation_vote_count` et
-- `participation_rate` disparaissent au lieu de changer de sens sous le même
-- nom : un consommateur non mis à jour doit échouer bruyamment, pas lire
-- silencieusement autre chose que ce qu'il croit lire.
--
-- Règle conservée de 20260826150500_gold_participation_numerateur_absent : un
-- numérateur absent vaut NULL, jamais zéro. Elle s'étend ici à la
-- décomposition — quand la source ne nomme le député sur aucun scrutin
-- éligible, les quatre colonnes dérivées sont NULL ensemble. À l'intérieur
-- d'un député que la source nomme, en revanche, un zéro est un fait constaté
-- (M. Corbière : 0 NON_VOTANT sur 1 610 scrutins où il est nommé) et il est
-- publié comme tel. Le taux reste NULL dès que l'un de ses deux termes est
-- NULL.
--
-- Coût. `eligible_votes` reste une jointure d'égalité indexée sur ballot_id,
-- distincte du range join du dénominateur — la séparation établie par
-- 20260826150500 est ce qui tient le rafraîchissement en quelques secondes
-- plutôt qu'en minutes. Les trois décomptes sont des FILTER sur la même
-- agrégation : aucun parcours supplémentaire.
--
-- Prisma ne modélise pas les vues matérialisées : la vue est redéfinie à la
-- main ici. Les migrations 20260825204803_gold_views et
-- 20260826150500_gold_participation_numerateur_absent ne sont pas modifiées —
-- elles sont appliquées sur les deux bases, et réécrire un historique déjà
-- appliqué a déjà provoqué un incident réel sur un plan antérieur.
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
  -- Décomposition du numérateur. Trois décomptes issus d'une seule
  -- agrégation, sur une jointure d'égalité indexée contre eligible_ballots —
  -- jamais contre mandate_intervals, pour ne pas reproduire le coût du range
  -- join ci-dessus.
  --
  --   named       : scrutins éligibles où la source nomme le député, quelle
  --                 que soit la position enregistrée ;
  --   expressed   : ceux où la position est POUR, CONTRE ou ABSTENTION ;
  --   non_voting  : ceux où elle est NON_VOTANT.
  --
  -- `named` est compté à part plutôt que déduit de expressed + non_voting :
  -- si l'Assemblée publiait un jour une cinquième catégorie, la somme des
  -- deux sous-décomptes cesserait d'égaler `named` et l'écart serait visible,
  -- au lieu d'être silencieusement réparti dans l'une des deux. Sur les
  -- données réelles de la 17e législature, les positions se répartissent
  -- aujourd'hui entre CONTRE (620 352), POUR (555 568), ABSTENTION (71 173)
  -- et NON_VOTANT (23 383), et l'égalité est vérifiée sur les 566 députés
  -- que la source nomme.
  --
  -- COUNT(DISTINCT ballot_id) et non COUNT(*) : le décompte porte sur des
  -- scrutins, pas sur des lignes, et le dénominateur compte des scrutins.
  --
  -- L'absence de ligne ici n'est jamais ramenée à zéro (voir l'en-tête) :
  -- elle signifie que la source ne nomme le député sur aucun scrutin
  -- éligible, ce qui n'est pas la même chose que n'avoir participé à aucun.
  SELECT
    bp.person_id,
    COUNT(DISTINCT bp.ballot_id) AS named_ballot_count,
    COUNT(DISTINCT bp.ballot_id)
      FILTER (WHERE bp.position IN ('POUR', 'CONTRE', 'ABSTENTION'))
      AS expressed_ballot_count,
    COUNT(DISTINCT bp.ballot_id)
      FILTER (WHERE bp.position = 'NON_VOTANT')
      AS non_voting_ballot_count
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
  -- Les trois décomptes du numérateur sont NULL ensemble, ou renseignés
  -- ensemble : ils viennent de la même ligne de eligible_votes. Aucun
  -- COALESCE — c'est la règle posée par 20260826150500.
  CASE WHEN mf.has_unknown_start THEN NULL ELSE ev.named_ballot_count END
    AS participation_named_count,
  CASE WHEN mf.has_unknown_start THEN NULL ELSE ev.expressed_ballot_count END
    AS participation_expressed_count,
  CASE WHEN mf.has_unknown_start THEN NULL ELSE ev.non_voting_ballot_count END
    AS participation_non_voting_count,
  -- Le taux n'existe que si ses deux termes existent. Son numérateur est
  -- désormais le seul décompte des positions exprimées : le libellé de la
  -- colonne le dit, et la fiche affiche à côté les trois décomptes dont il
  -- est tiré, faute de quoi il se lirait de deux façons opposées.
  CASE
    WHEN mf.has_unknown_start THEN NULL
    WHEN ed.eligible_ballot_count IS NULL OR ed.eligible_ballot_count = 0 THEN NULL
    WHEN ev.expressed_ballot_count IS NULL THEN NULL
    ELSE ROUND(ev.expressed_ballot_count::numeric / ed.eligible_ballot_count, 4)
  END AS participation_expressed_rate,
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
  'Nombre de scrutins de la 17e législature publiés en détail nominatif complet et tombant dans un intervalle de mandat réellement tenu par le député. C''est le dénominateur de participation_expressed_rate. NULL si aucun tel scrutin n''existe, ou si un intervalle de mandat a une date de début inconnue (fenêtre non vérifiable). Ne mesure ni la présence ni le vote : seulement les scrutins que le député était en fonction pour voter.';
COMMENT ON COLUMN gold.deputy_card.participation_named_count IS
  'Nombre de ces mêmes scrutins éligibles sur lesquels l''Assemblée nationale nomme le député, quelle que soit la position enregistrée — POUR, CONTRE, ABSTENTION ou NON_VOTANT. Ne mesure pas la participation : être nommé n''implique pas avoir voté (voir participation_non_voting_count). L''écart avec participation_ballot_count ne mesure pas des absences : la source ne nomme pas tous les députés sur chaque scrutin, et son silence n''établit rien. NULL si la source ne nomme le député sur aucun scrutin éligible : c''est un silence de la source, jamais un zéro constaté.';
COMMENT ON COLUMN gold.deputy_card.participation_expressed_count IS
  'Sous-ensemble de participation_named_count : scrutins éligibles sur lesquels la position enregistrée pour le député est POUR, CONTRE ou ABSTENTION, c''est-à-dire une position exprimée sur le fond. C''est le numérateur de participation_expressed_rate. Zéro est ici un fait constaté (le député est nommé, sans qu''aucune position exprimée le soit) et non un silence. NULL uniquement quand participation_named_count est NULL.';
COMMENT ON COLUMN gold.deputy_card.participation_non_voting_count IS
  'Sous-ensemble de participation_named_count : scrutins éligibles sur lesquels l''Assemblée nationale enregistre le député en NON_VOTANT, catégorie qu''elle publie sans motif. Elle recouvre des situations sans rapport entre elles — sur la 17e législature, 8 341 des 8 434 scrutins éligibles pour la présidente de l''Assemblée, quelques dizaines pour d''autres députés. PoliGraph ne distingue pas ces situations, n''en publie aucune explication et n''applique aucun traitement particulier : le décompte est publié tel quel. Zéro est un fait constaté (0 sur les 1 610 scrutins où Alexis Corbière est nommé) et non un silence. NULL uniquement quand participation_named_count est NULL.';
COMMENT ON COLUMN gold.deputy_card.participation_expressed_rate IS
  'participation_expressed_count / participation_ballot_count : part des scrutins éligibles du mandat sur lesquels une position exprimée (POUR, CONTRE ou ABSTENTION) est enregistrée pour le député. Ne se lit pas seul et n''est jamais publié seul : un taux bas peut venir de scrutins NON_VOTANT comme de scrutins où la source ne nomme pas le député, et ces deux causes sont dans participation_non_voting_count et dans l''écart named/ballot. Remplace l''ancien participation_rate, qui comptait NON_VOTANT au numérateur et affichait 100,00 % pour un député dont 8 341 des 8 434 positions sont NON_VOTANT. NULL dès que l''un des deux termes est NULL : dénominateur invérifiable, ou source qui ne nomme le député sur aucun scrutin éligible. Jamais un zéro trompeur — un taux publié ici est toujours calculé sur deux termes réellement observés.';
