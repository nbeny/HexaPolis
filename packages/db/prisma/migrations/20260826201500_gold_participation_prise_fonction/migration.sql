-- gold.deputy_card : ouvrir la fenêtre de participation à la date où le député
-- est entré en fonction, et non à l'ouverture du mandat du siège.
--
-- Défaut corrigé (relevé du 26 août 2026, tâche 8 du plan 6, écart 11). La vue
-- ouvrait chaque intervalle de mandat à `m.start_date`, qui porte le `dateDebut`
-- publié par l'Assemblée nationale, c'est-à-dire l'ouverture du mandat du
-- siège — pour la 17e législature, le 2024-07-07 pour presque tout le monde.
-- Or l'Assemblée publie aussi `mandature.datePriseFonction`, la date à laquelle
-- *cette personne-là* est entrée en fonction. Les deux coïncident (à un jour
-- près) pour un député élu aux générales et divergent pour tout remplaçant.
-- La migration 20260826200500_mandat_date_prise_fonction importe la seconde ;
-- celle-ci s'en sert.
--
-- Mesuré sur les données réelles avant correction :
--
--   Marie-Sophie Bernadeau (PA793924), entrée en fonction le 2026-07-20 en
--   remplacement d'un député en mission au-delà de six mois, était mesurée
--   contre les 8 434 scrutins de la législature entière. Sa fiche affichait
--   « 4 sur 8 434 », soit 0,05 % : un chiffre calculé sans erreur qui disait
--   d'une personne nommée qu'elle ne s'est presque jamais présentée.
--
-- 47 des 577 députés en exercice ont un dénominateur changé par cette
-- migration. Aucun ne l'a augmenté : `datePriseFonction` n'est jamais
-- antérieure à `dateDebut` dans les données publiées (0 cas sur 4 531), donc
-- la fenêtre ne peut que se refermer. Les écarts les plus larges :
--
--   Chantal Bouloux        8 434 → NULL (entrée en fonction le 2026-08-05,
--                                        après le dernier scrutin éligible :
--                                        plus aucun ne tombe dans son mandat)
--   Marie-Sophie Bernadeau 8 434 →   17
--   Jean-Yves Bonnefoy     8 434 →  387
--   Dominique Paillat      8 434 → 1 535
--   onze députés           8 434 → 2 150
--
-- 577 et non 567 : la population de la vue a changé au même moment, pour une
-- raison voisine mais distincte. `normalize.ts` lisait les mandats bronze sans
-- `ORDER BY`, et plusieurs mandats publiés partagent la même clé naturelle
-- (voir 20260826200500) : le dernier upsert du groupe imposait son `endDate`,
-- et « le dernier » dépendait de l'ordre physique des lignes. Dix députés en
-- exercice — d'anciens membres du gouvernement revenus siéger — portaient la
-- date de fin de leur premier passage et étaient donc absents du site.
-- L'ordre de lecture est désormais imposé (date de prise de fonction
-- croissante, `uid` en départage) : le dernier état publié gagne, et la vue
-- compte exactement les 577 députés que la source déclare en mandat ouvert.
--
-- Témoins entrés en fonction à l'ouverture, inchangés : Yaël Braun-Pivet
-- (8 434), Sébastien Chenu (8 434), Alexis Corbière (8 434). Leur
-- `datePriseFonction` est le lendemain de leur `dateDebut` (2024-07-08 pour
-- les deux premiers cas, 2024-07-01 pour M. Chenu), mais le premier scrutin de
-- la 17e législature publié en décompte nominatif date du 2024-10-08 : le
-- décalage d'un jour ne déplace aucun scrutin.
--
-- COALESCE, pas de valeur par défaut en base. `taking_office_date` est NULL
-- quand la source ne publie pas la date. La vue retombe alors explicitement
-- sur `start_date`, ce qui reproduit le comportement d'avant cette migration
-- pour ces mandats — jamais une date inventée, et le commentaire de colonne le
-- dit. C'est la vue, consommatrice, qui décide de la retombée ; silver garde
-- le silence de la source tel quel.
--
-- Deux règles des migrations précédentes sont préservées et ont été revérifiées
-- sur les données réelles après rafraîchissement :
--
--   - 20260826150500 : un numérateur sans ligne correspondante vaut NULL,
--     jamais zéro. La fenêtre se resserrant, le dénominateur peut désormais
--     lui aussi devenir NULL (cas Bouloux : plus aucun scrutin éligible dans
--     le mandat). Les trois décomptes du numérateur sont donc gardés par
--     `ed.eligible_ballot_count IS NULL` en plus de leur propre absence : les
--     cinq colonnes participation_* restent NULL ensemble, et aucun « dont »
--     ne s'affiche sous un ensemble absent ;
--   - 20260826174500 : la participation reste décomposée en éligibles /
--     nommés / exprimés / non-votants, jamais réduite à un pourcentage.
--
-- Ce que cette migration ajoute à la fiche : `taking_office_date` remonte
-- jusqu'à la vue, dans la zone des colonnes reportées de silver (avant
-- `mandate_count`), et non parmi les colonnes calculées. Ce n'est pas un
-- agrégat : c'est la date publiée par la source pour le mandat en cours, et
-- elle ne porte donc pas le marquage COMPUTED. Sans elle, la fiche corrigée
-- afficherait « 4 sur 17 » sans que rien n'explique pourquoi 17 et pas 8 434 :
-- un taux calculé sur dix-sept jours se compare alors sans garde-fou au taux
-- d'un collègue calculé sur deux ans.
--
-- Prisma ne modélise pas les vues matérialisées : la vue est redéfinie à la
-- main ici. Les migrations 20260825204803_gold_views,
-- 20260826150500_gold_participation_numerateur_absent et
-- 20260826174500_gold_participation_decomposee ne sont pas modifiées — elles
-- sont appliquées sur les deux bases, et réécrire un historique déjà appliqué
-- a déjà provoqué un incident réel sur un plan antérieur.
--
-- gold.deputy_vote n'est pas concernée et n'est pas retouchée.

DROP MATERIALIZED VIEW gold.deputy_card;

CREATE MATERIALIZED VIEW gold.deputy_card AS
WITH current_mandate AS (
  -- Le mandat parlementaire actuellement ouvert de la 17e législature, un
  -- par personne : c'est cette ouverture qui définit la population de la vue.
  --
  -- Le départage se fait sur la date d'entrée en fonction quand elle est
  -- publiée, faute de quoi deux mandats ouverts de même `start_date` — cas
  -- possible dès lors que `start_date` vaut l'ouverture de la législature pour
  -- tout le monde — seraient départagés par un critère constant, donc au
  -- hasard.
  SELECT DISTINCT ON (m.person_id)
    m.person_id,
    m.start_date,
    m.taking_office_date,
    m.territory_id
  FROM silver.mandate m
  JOIN silver.institution i ON i.id = m.institution_id AND i.code = 'ASSEMBLEE_NATIONALE'
  JOIN silver.legislature l ON l.id = m.legislature_id AND l.number = 17
  WHERE m.kind = 'PARLIAMENTARY' AND m.end_date IS NULL
  ORDER BY m.person_id, COALESCE(m.taking_office_date, m.start_date) DESC NULLS LAST
),

mandate_intervals AS (
  -- Tous les mandats parlementaires de la 17e législature de la personne,
  -- passés et actuel (potentiellement plusieurs : un député nommé au
  -- gouvernement puis revenu siéger a deux intervalles disjoints). Sert au
  -- dénominateur de participation ci-dessous — jamais à la population de la
  -- vue, qui reste `current_mandate`.
  --
  -- L'intervalle s'ouvre à la date d'entrée en fonction publiée par
  -- l'Assemblée, et retombe sur la date de début du mandat quand elle ne l'est
  -- pas. C'est la correction portée par cette migration : `start_date` est
  -- l'ouverture du mandat du siège, pas la date à laquelle cette personne a pu
  -- commencer à voter.
  SELECT
    m.person_id,
    COALESCE(m.taking_office_date, m.start_date) AS start_date,
    m.end_date
  FROM silver.mandate m
  JOIN silver.institution i ON i.id = m.institution_id AND i.code = 'ASSEMBLEE_NATIONALE'
  JOIN silver.legislature l ON l.id = m.legislature_id AND l.number = 17
  WHERE m.kind = 'PARLIAMENTARY'
),

mandate_flags AS (
  -- Un intervalle de mandat sans date d'ouverture connue rend le dénominateur
  -- de participation invérifiable pour cette personne : on ne peut pas dire
  -- depuis quand elle pouvait voter. Porte sur la date effectivement retenue
  -- par `mandate_intervals` (entrée en fonction, sinon début de mandat) : un
  -- mandat sans entrée en fonction publiée mais avec une date de début reste
  -- vérifiable, il ne doit pas basculer en NULL. Dans les données réelles, le
  -- cas des deux dates absentes ne se produit jamais (0 mandat sur la 17e
  -- législature) ; il est traité ici pour ne jamais publier un ratio dont l'un
  -- des intervalles est de fenêtre inconnue.
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
  -- mandat réellement tenu par la personne comptent. Un député entré en cours
  -- de législature (ou parti puis revenu) ne pouvait pas voter les scrutins
  -- hors de ces intervalles — et « entré en cours de législature » se lit
  -- désormais sur la date d'entrée en fonction, seule date que la source
  -- publie personne par personne.
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
  -- au lieu d'être silencieusement réparti dans l'une des deux.
  --
  -- COUNT(DISTINCT ballot_id) et non COUNT(*) : le décompte porte sur des
  -- scrutins, pas sur des lignes, et le dénominateur compte des scrutins.
  --
  -- Cette agrégation ne connaît pas les intervalles de mandat : elle compte
  -- tous les scrutins éligibles où la source nomme le député. Elle peut donc
  -- dépasser le dénominateur si la source nommait un député hors de son
  -- mandat — cas qui ne se produit pas dans les données réelles, et que le
  -- test d'invariance « un sous-décompte ne déborde pas son ensemble »
  -- surveille.
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
  -- Date publiée par la source pour le mandat en cours, reportée telle quelle
  -- comme la circonscription ci-dessus : ce n'est pas un agrégat, elle ne
  -- relève pas de computed_status. Elle est ce sur quoi s'ouvre le
  -- dénominateur juste en dessous, et c'est pourquoi elle remonte jusqu'à la
  -- fiche.
  cm.taking_office_date,
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
  --
  -- Ils sont en outre NULL dès que le dénominateur l'est. `eligible_votes` ne
  -- connaît pas les intervalles de mandat : si la source nommait un député sur
  -- un scrutin hors de sa fenêtre, il aurait un numérateur sans dénominateur,
  -- et la fiche afficherait « dont position exprimée : 1 » sous un « scrutins
  -- éligibles » absent — un sous-décompte sans l'ensemble qui le contient. Le
  -- cas ne se produit pas dans les données réelles (0 ligne sur 577), et la
  -- fenêtre se refermant avec cette migration, il devient possible : un député
  -- entré en fonction après le dernier scrutin éligible n'a plus de
  -- dénominateur du tout. La garde est explicite plutôt que laissée au hasard
  -- des données.
  CASE
    WHEN mf.has_unknown_start OR ed.eligible_ballot_count IS NULL THEN NULL
    ELSE ev.named_ballot_count
  END AS participation_named_count,
  CASE
    WHEN mf.has_unknown_start OR ed.eligible_ballot_count IS NULL THEN NULL
    ELSE ev.expressed_ballot_count
  END AS participation_expressed_count,
  CASE
    WHEN mf.has_unknown_start OR ed.eligible_ballot_count IS NULL THEN NULL
    ELSE ev.non_voting_ballot_count
  END AS participation_non_voting_count,
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
  'Une ligne par député actuellement en exercice de la 17e législature. Les colonnes à partir de mandate_count sont calculées par cette vue (voir computed_status), pas publiées telles quelles par une source. Celles qui précèdent — identité, circonscription, date de prise de fonction, groupe courant — sont un report de silver.';
COMMENT ON COLUMN gold.deputy_card.taking_office_date IS
  'Date à laquelle le député est entré en fonction pour son mandat en cours, telle que l''Assemblée nationale la publie (mandature.datePriseFonction). Report de silver.mandate.taking_office_date, pas un calcul : cette colonne ne relève pas de computed_status. Distincte de la date de début du mandat, qui vaut l''ouverture de la législature pour presque tous les députés et figure dans la section « Mandats » de la fiche. C''est à cette date que s''ouvre la fenêtre de participation_ballot_count. NULL quand la source ne la publie pas pour ce mandat : la fenêtre retombe alors sur la date de début du mandat.';
COMMENT ON COLUMN gold.deputy_card.computed_status IS
  'Toujours ''COMPUTED''. Marque mandate_count, committee_count, vote_count et les colonnes participation_* comme des agrégats produits par cette vue, distincts des faits OFFICIAL/NORMALIZED publiés par une source (spec §5.7). Les colonnes qui précèdent (identité, circonscription, date de prise de fonction, groupe courant) sont un simple report de silver, chacune traçable via silver.provenance.';
COMMENT ON COLUMN gold.deputy_card.participation_ballot_count IS
  'Nombre de scrutins de la 17e législature publiés en détail nominatif complet et tombant dans un intervalle de mandat réellement tenu par le député. L''intervalle s''ouvre à taking_office_date quand la source la publie, sinon à la date de début du mandat : mesurer un député entré en cours de législature contre les scrutins tenus avant son entrée en fonction produisait un taux proche de zéro sur une personne qui n''avait pas encore de siège. C''est le dénominateur de participation_expressed_rate. NULL si aucun tel scrutin n''existe — y compris pour un député entré en fonction après le dernier scrutin éligible connu — ou si un intervalle de mandat n''a ni date d''entrée en fonction ni date de début (fenêtre non vérifiable). Ne mesure ni la présence ni le vote : seulement les scrutins que le député était en fonction pour voter. Un dénominateur faible n''est pas comparable à un dénominateur élevé : il se lit avec taking_office_date.';
COMMENT ON COLUMN gold.deputy_card.participation_named_count IS
  'Nombre de ces mêmes scrutins éligibles sur lesquels l''Assemblée nationale nomme le député, quelle que soit la position enregistrée — POUR, CONTRE, ABSTENTION ou NON_VOTANT. Ne mesure pas la participation : être nommé n''implique pas avoir voté (voir participation_non_voting_count). L''écart avec participation_ballot_count ne mesure pas des absences : la source ne nomme pas tous les députés sur chaque scrutin, et son silence n''établit rien. NULL si la source ne nomme le député sur aucun scrutin éligible : c''est un silence de la source, jamais un zéro constaté.';
COMMENT ON COLUMN gold.deputy_card.participation_expressed_count IS
  'Sous-ensemble de participation_named_count : scrutins éligibles sur lesquels la position enregistrée pour le député est POUR, CONTRE ou ABSTENTION, c''est-à-dire une position exprimée sur le fond. C''est le numérateur de participation_expressed_rate. Zéro est ici un fait constaté (le député est nommé, sans qu''aucune position exprimée le soit) et non un silence. NULL uniquement quand participation_named_count est NULL.';
COMMENT ON COLUMN gold.deputy_card.participation_non_voting_count IS
  'Sous-ensemble de participation_named_count : scrutins éligibles sur lesquels l''Assemblée nationale enregistre le député en NON_VOTANT, catégorie qu''elle publie sans motif. Elle recouvre des situations sans rapport entre elles — sur la 17e législature, 8 341 des 8 434 scrutins éligibles pour la présidente de l''Assemblée, quelques dizaines pour d''autres députés. PoliGraph ne distingue pas ces situations, n''en publie aucune explication et n''applique aucun traitement particulier : le décompte est publié tel quel. Zéro est un fait constaté (0 sur les 1 610 scrutins où Alexis Corbière est nommé) et non un silence. NULL uniquement quand participation_named_count est NULL.';
COMMENT ON COLUMN gold.deputy_card.participation_expressed_rate IS
  'participation_expressed_count / participation_ballot_count : part des scrutins éligibles du mandat sur lesquels une position exprimée (POUR, CONTRE ou ABSTENTION) est enregistrée pour le député. Ne se lit pas seul et n''est jamais publié seul : un taux bas peut venir de scrutins NON_VOTANT comme de scrutins où la source ne nomme pas le député, et ces deux causes sont dans participation_non_voting_count et dans l''écart named/ballot. Ne se compare pas d''un député à l''autre sans regarder participation_ballot_count et taking_office_date : un taux calculé sur dix-sept scrutins et un taux calculé sur 8 434 n''ont pas la même portée, et le pourcentage seul ne le dit pas. NULL dès que l''un des deux termes est NULL. Jamais un zéro trompeur — un taux publié ici est toujours calculé sur deux termes réellement observés.';
