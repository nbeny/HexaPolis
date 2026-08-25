-- CreateTable
CREATE TABLE "bronze"."an_scrutin_raw" (
    "id" BIGSERIAL NOT NULL,
    "import_run_id" TEXT NOT NULL,
    "entry_name" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "numero" TEXT,
    "legislature" TEXT,
    "organe_ref" TEXT,
    "session_ref" TEXT,
    "seance_ref" TEXT,
    "date_scrutin" TEXT,
    "code_type_vote" TEXT,
    "libelle_type_vote" TEXT,
    "type_majorite" TEXT,
    "sort_code" TEXT,
    "sort_libelle" TEXT,
    "titre" TEXT,
    "demandeur" TEXT,
    "mode_publication" TEXT,
    "nombre_votants" TEXT,
    "suffrages_exprimes" TEXT,
    "nbr_suffrages_requis" TEXT,
    "decompte_pour" TEXT,
    "decompte_contre" TEXT,
    "decompte_abstentions" TEXT,
    "decompte_non_votants" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "an_scrutin_raw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bronze"."an_position_raw" (
    "id" BIGSERIAL NOT NULL,
    "import_run_id" TEXT NOT NULL,
    "scrutin_uid" TEXT NOT NULL,
    "acteur_ref" TEXT NOT NULL,
    "mandat_ref" TEXT,
    "groupe_ref" TEXT,
    "categorie" TEXT NOT NULL,
    "par_delegation" TEXT,
    "num_place" TEXT,

    CONSTRAINT "an_position_raw_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "an_scrutin_raw_uid_idx" ON "bronze"."an_scrutin_raw"("uid");

-- CreateIndex
CREATE INDEX "an_scrutin_raw_legislature_idx" ON "bronze"."an_scrutin_raw"("legislature");

-- CreateIndex
CREATE UNIQUE INDEX "an_scrutin_raw_import_run_id_uid_key" ON "bronze"."an_scrutin_raw"("import_run_id", "uid");

-- CreateIndex
CREATE INDEX "an_position_raw_scrutin_uid_idx" ON "bronze"."an_position_raw"("scrutin_uid");

-- CreateIndex
CREATE INDEX "an_position_raw_acteur_ref_idx" ON "bronze"."an_position_raw"("acteur_ref");

-- CreateIndex
CREATE UNIQUE INDEX "an_position_raw_import_run_id_scrutin_uid_acteur_ref_catego_key" ON "bronze"."an_position_raw"("import_run_id", "scrutin_uid", "acteur_ref", "categorie");
