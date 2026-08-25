-- CreateTable
CREATE TABLE "bronze"."rne_elu_raw" (
    "id" BIGSERIAL NOT NULL,
    "import_run_id" TEXT NOT NULL,
    "ligne" INTEGER NOT NULL,
    "code_departement" TEXT,
    "libelle_departement" TEXT,
    "code_circonscription" TEXT,
    "libelle_circonscription" TEXT,
    "nom" TEXT,
    "prenom" TEXT,
    "code_sexe" TEXT,
    "date_naissance" TEXT,
    "code_csp" TEXT,
    "libelle_csp" TEXT,
    "date_debut_mandat" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "rne_elu_raw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bronze"."cnccfp_compte_raw" (
    "id" BIGSERIAL NOT NULL,
    "import_run_id" TEXT NOT NULL,
    "ligne" INTEGER NOT NULL,
    "candidat" TEXT,
    "nom" TEXT,
    "scrutin" TEXT,
    "circonscription" TEXT,
    "departement" TEXT,
    "code_departement" TEXT,
    "nuance" TEXT,
    "monnaie" TEXT,
    "depenses_declarees" TEXT,
    "recettes_declarees" TEXT,
    "dons_declares" TEXT,
    "apport_personnel" TEXT,
    "depenses_retenues" TEXT,
    "recettes_retenues" TEXT,
    "decision" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "cnccfp_compte_raw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."political_party" (
    "id" TEXT NOT NULL,
    "natural_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,

    CONSTRAINT "political_party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."election" (
    "id" TEXT NOT NULL,
    "natural_key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "year" INTEGER NOT NULL,

    CONSTRAINT "election_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."candidacy" (
    "id" TEXT NOT NULL,
    "natural_key" TEXT NOT NULL,
    "election_id" TEXT NOT NULL,
    "person_id" TEXT,
    "party_id" TEXT,
    "territory_id" TEXT,
    "nuance" TEXT,
    "display_name" TEXT NOT NULL,

    CONSTRAINT "candidacy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."campaign_account" (
    "id" TEXT NOT NULL,
    "candidacy_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "declared_expenses" DECIMAL(14,2),
    "declared_income" DECIMAL(14,2),
    "declared_donations" DECIMAL(14,2),
    "personal_funds" DECIMAL(14,2),
    "retained_expenses" DECIMAL(14,2),
    "retained_income" DECIMAL(14,2),
    "decision_code" TEXT,

    CONSTRAINT "campaign_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."identity_match" (
    "id" TEXT NOT NULL,
    "natural_key" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "person_id" TEXT,
    "confidence" TEXT NOT NULL,
    "evidence" TEXT[],
    "alternatives" TEXT[],
    "decided_by" TEXT NOT NULL DEFAULT 'AUTO',
    "resolved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_match_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rne_elu_raw_nom_prenom_idx" ON "bronze"."rne_elu_raw"("nom", "prenom");

-- CreateIndex
CREATE UNIQUE INDEX "rne_elu_raw_import_run_id_ligne_key" ON "bronze"."rne_elu_raw"("import_run_id", "ligne");

-- CreateIndex
CREATE INDEX "cnccfp_compte_raw_candidat_idx" ON "bronze"."cnccfp_compte_raw"("candidat");

-- CreateIndex
CREATE UNIQUE INDEX "cnccfp_compte_raw_import_run_id_ligne_key" ON "bronze"."cnccfp_compte_raw"("import_run_id", "ligne");

-- CreateIndex
CREATE UNIQUE INDEX "political_party_natural_key_key" ON "silver"."political_party"("natural_key");

-- CreateIndex
CREATE UNIQUE INDEX "election_natural_key_key" ON "silver"."election"("natural_key");

-- CreateIndex
CREATE UNIQUE INDEX "candidacy_natural_key_key" ON "silver"."candidacy"("natural_key");

-- CreateIndex
CREATE INDEX "candidacy_person_id_idx" ON "silver"."candidacy"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_account_candidacy_id_key" ON "silver"."campaign_account"("candidacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "identity_match_natural_key_key" ON "silver"."identity_match"("natural_key");

-- CreateIndex
CREATE INDEX "identity_match_confidence_idx" ON "silver"."identity_match"("confidence");

-- CreateIndex
CREATE INDEX "identity_match_source_id_confidence_idx" ON "silver"."identity_match"("source_id", "confidence");

-- AddForeignKey
ALTER TABLE "silver"."candidacy" ADD CONSTRAINT "candidacy_election_id_fkey" FOREIGN KEY ("election_id") REFERENCES "silver"."election"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."candidacy" ADD CONSTRAINT "candidacy_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "silver"."person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."candidacy" ADD CONSTRAINT "candidacy_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "silver"."political_party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."candidacy" ADD CONSTRAINT "candidacy_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "silver"."territory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."campaign_account" ADD CONSTRAINT "campaign_account_candidacy_id_fkey" FOREIGN KEY ("candidacy_id") REFERENCES "silver"."candidacy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
