-- Importer la date de prise de fonction publiée par l'Assemblée nationale.
--
-- Défaut corrigé (relevé du 26 août 2026, tâche 8 du plan 6, écart 11).
-- L'Assemblée publie deux dates par mandat et PoliGraph n'en importait qu'une :
--
--   dateDebut                     ouverture du mandat *du siège* — pour la 17e
--                                 législature, l'ouverture de la législature ;
--   mandature.datePriseFonction   date à laquelle *cette personne* est entrée
--                                 en fonction.
--
-- Elles coïncident (à un jour près) pour un député élu aux élections
-- générales. Elles divergent pour quiconque remplace un député nommé au
-- gouvernement ou en mission de plus de six mois, pour un suppléant appelé à
-- siéger, et pour un ancien membre du gouvernement qui reprend son mandat.
-- Mesuré sur le bronze : 4 531 mandats `typeOrgane = ASSEMBLEE` portent une
-- `datePriseFonction`, dont 2 853 postérieures à `dateDebut`. Aucune n'est
-- antérieure. Aucun des 180 246 mandats des autres types d'organe n'en porte.
--
-- Conséquence mesurée avant correction : `gold.deputy_card` ouvrait la fenêtre
-- de participation de chaque député à `start_date`, donc à l'ouverture de la
-- législature pour tout le monde. Marie-Sophie Bernadeau (PA793924), entrée en
-- fonction le 2026-07-20 en remplacement d'un député en mission au-delà de six
-- mois, était mesurée contre les 8 434 scrutins de deux ans de législature :
-- sa fiche affichait « 4 sur 8 434 — 0,05 % ». Le chiffre était calculé sans
-- erreur et disait d'une personne nommée qu'elle n'a presque jamais siégé.
--
-- Ce que fait cette migration : elle ajoute la colonne aux deux étages, et
-- rien d'autre. La vue `gold.deputy_card` est redéfinie par la migration
-- suivante (20260826201500_gold_participation_prise_fonction), séparée pour
-- que l'ajout de colonne reste rejouable indépendamment de la redéfinition de
-- vue.
--
-- --- bronze -----------------------------------------------------------------
--
-- `date_prise_fonction` rejoint les autres scalaires publiés, conservée en
-- `text` sans interprétation comme `date_debut` et `date_fin` (règle bronze,
-- spec §6.1 : « une valeur publiée est conservée telle quelle »).
--
-- Le remplissage des lignes déjà stagées ne demande aucun téléchargement : le
-- `payload` JSON archivé porte déjà `mandature.datePriseFonction`. C'est
-- exactement ce à quoi sert l'archivage du brut (spec §6.2). Sans ce
-- remplissage, `import an:acteurs --renormalize` relirait une colonne vide,
-- puisque `openImportRun` saute le stage quand le checksum est inchangé et
-- qu'aucune ligne bronze ne serait donc réécrite.

ALTER TABLE bronze.an_mandat_raw ADD COLUMN date_prise_fonction TEXT;

UPDATE bronze.an_mandat_raw
SET date_prise_fonction = payload -> 'mandature' ->> 'datePriseFonction'
WHERE payload -> 'mandature' ->> 'datePriseFonction' IS NOT NULL;

COMMENT ON COLUMN bronze.an_mandat_raw.date_prise_fonction IS
  'mandature.datePriseFonction, recopiée telle quelle. Date à laquelle la personne est effectivement entrée en fonction, distincte de date_debut qui est la date d''ouverture du mandat du siège. Publiée par l''Assemblée nationale sur les seuls mandats typeOrgane = ASSEMBLEE. NULL quand la source ne la publie pas.';

-- --- silver -----------------------------------------------------------------
--
-- Nom retenu : `taking_office_date`, décalque de `datePriseFonction`. Ni
-- `start_date` (déjà pris, par l'autre date) ni `effective_start_date` : le
-- mot « effective » suggérerait que `start_date` serait une date fictive, or
-- les deux sont publiées et vraies, elles répondent simplement à deux
-- questions différentes — « depuis quand le siège est-il ouvert » et « depuis
-- quand cette personne l'occupe-t-elle ».
--
-- Type `timestamp(3)` et nullable, comme `start_date` et `end_date`, pour deux
-- raisons distinctes qu'il ne faut pas confondre à la lecture :
--   - la source ne publie cette date que pour les mandats parlementaires ;
--   - même sur ceux-là, elle pourrait un jour manquer.
-- Dans les deux cas NULL signifie « la source ne le dit pas », jamais « la
-- personne est entrée en fonction à l'ouverture ». C'est le consommateur qui
-- décide de la retombée : `gold.deputy_card` retombe explicitement sur
-- `start_date` par un COALESCE, et le dit dans son commentaire de colonne.
--
-- `start_date` n'est pas modifiée et ne le sera pas : elle continue de porter
-- `dateDebut`. Écraser l'une par l'autre perdrait un fait publié.

ALTER TABLE silver.mandate ADD COLUMN taking_office_date TIMESTAMP(3);

COMMENT ON COLUMN silver.mandate.taking_office_date IS
  'Date à laquelle la personne est effectivement entrée en fonction (mandature.datePriseFonction de l''Assemblée nationale). Distincte de start_date, qui porte dateDebut, c''est-à-dire l''ouverture du mandat du siège — pour la 17e législature, l''ouverture de la législature, identique pour tous les députés. Les deux sont publiées et vraies. NULL signifie que la source ne publie pas cette date pour ce mandat, jamais que la personne serait entrée en fonction à start_date.';

-- --- clé naturelle ----------------------------------------------------------
--
-- La clé naturelle de `silver.mandate` n'est PAS modifiée : elle reste
-- personId::institutionId::kind::dateDebut. La spec §6.2 (« Limite connue :
-- changer la formule d'une clé naturelle ») décrit ce qui arriverait sinon —
-- les lignes déjà écrites conservent l'ancienne clé, la renormalisation ne les
-- retrouve plus et crée un jeu parallèle. L'incident est documenté : l'ajout
-- de la qualité à la clé de `BodyMembership` avait produit 1 382 lignes à côté
-- des 1 323 existantes. La correction d'un dénominateur ne justifie pas de
-- rejouer cet incident.
--
-- Conséquence assumée et mesurée : sur 4 531 mandats ASSEMBLEE du bronze,
-- 120 groupes (dont 27 sur la 17e législature) partagent la même clé
-- naturelle tout en portant des `datePriseFonction` différentes — typiquement
-- un député élu aux générales, nommé au gouvernement, puis reprenant son
-- mandat : l'Assemblée publie deux mandats de même `dateDebut`. Ces mandats
-- sont, aujourd'hui déjà et indépendamment de cette migration, fondus en une
-- seule ligne silver (3 832 lignes pour 3 954 uid bronze). `normalize.ts`
-- retient pour eux la **plus ancienne** `datePriseFonction` du groupe, calculée
-- en un passage préalable sur tout le bronze du run : c'est la seule valeur qui
-- ne retranche aucune période réellement exercée du dénominateur, et elle ne
-- dépend pas de l'ordre de lecture des lignes — un `min` ne bouge pas selon
-- l'ordre, contrairement à un « dernier écrit gagne » qui rendrait le
-- dénominateur non reproductible d'un import à l'autre.
--
-- La fusion de ces 120 mandats en une ligne est un défaut distinct, antérieur
-- à cette migration, qui n'est pas corrigé ici : il exige la migration de
-- données que la §6.2 décrit. Il est consigné dans le plan 6 comme constat
-- séparé.
