-- CreateTable
CREATE TABLE "bronze"."an_acteur_raw" (
    "id" BIGSERIAL NOT NULL,
    "import_run_id" TEXT NOT NULL,
    "entry_name" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "civ" TEXT,
    "prenom" TEXT,
    "nom" TEXT,
    "alpha" TEXT,
    "trigramme" TEXT,
    "date_nais" TEXT,
    "ville_nais" TEXT,
    "dep_nais" TEXT,
    "pays_nais" TEXT,
    "date_deces" TEXT,
    "profession" TEXT,
    "uri_hatvp" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "an_acteur_raw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bronze"."an_mandat_raw" (
    "id" BIGSERIAL NOT NULL,
    "import_run_id" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "acteur_ref" TEXT NOT NULL,
    "legislature" TEXT,
    "type_organe" TEXT NOT NULL,
    "date_debut" TEXT,
    "date_fin" TEXT,
    "code_qualite" TEXT,
    "organe_ref" TEXT,
    "num_circo" TEXT,
    "num_departement" TEXT,
    "region" TEXT,
    "departement" TEXT,
    "cause_mandat" TEXT,
    "ref_circonscription" TEXT,
    "cause_fin" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "an_mandat_raw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bronze"."an_organe_raw" (
    "id" BIGSERIAL NOT NULL,
    "import_run_id" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "code_type" TEXT NOT NULL,
    "libelle" TEXT,
    "libelle_abrege" TEXT,
    "libelle_abrev" TEXT,
    "date_debut" TEXT,
    "date_fin" TEXT,
    "legislature" TEXT,
    "numero" TEXT,
    "region_libelle" TEXT,
    "departement_code" TEXT,
    "couleur_associee" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "an_organe_raw_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "an_acteur_raw_uid_idx" ON "bronze"."an_acteur_raw"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "an_acteur_raw_import_run_id_uid_key" ON "bronze"."an_acteur_raw"("import_run_id", "uid");

-- CreateIndex
CREATE INDEX "an_mandat_raw_acteur_ref_idx" ON "bronze"."an_mandat_raw"("acteur_ref");

-- CreateIndex
CREATE UNIQUE INDEX "an_mandat_raw_import_run_id_uid_key" ON "bronze"."an_mandat_raw"("import_run_id", "uid");

-- CreateIndex
CREATE INDEX "an_organe_raw_code_type_idx" ON "bronze"."an_organe_raw"("code_type");

-- CreateIndex
CREATE UNIQUE INDEX "an_organe_raw_import_run_id_uid_key" ON "bronze"."an_organe_raw"("import_run_id", "uid");
