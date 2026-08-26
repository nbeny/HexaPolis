-- AlterTable
ALTER TABLE "silver"."candidacy" ADD COLUMN     "elected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "round" INTEGER,
ADD COLUMN     "vote_pct_expressed" DECIMAL(6,2),
ADD COLUMN     "vote_pct_registered" DECIMAL(6,2),
ADD COLUMN     "votes" INTEGER;

-- CreateTable
CREATE TABLE "silver"."election_turnout" (
    "id" TEXT NOT NULL,
    "natural_key" TEXT NOT NULL,
    "election_id" TEXT NOT NULL,
    "territory_id" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "registered" INTEGER NOT NULL,
    "voters" INTEGER NOT NULL,
    "abstentions" INTEGER NOT NULL,
    "expressed" INTEGER NOT NULL,
    "blank" INTEGER NOT NULL,
    "null_votes" INTEGER NOT NULL,

    CONSTRAINT "election_turnout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bronze"."election_result_raw" (
    "id" BIGSERIAL NOT NULL,
    "import_run_id" TEXT NOT NULL,
    "ligne" INTEGER NOT NULL,
    "rang" INTEGER NOT NULL,
    "code_departement" TEXT,
    "code_circonscription" TEXT,
    "libelle_circonscription" TEXT,
    "inscrits" TEXT,
    "votants" TEXT,
    "exprimes" TEXT,
    "blancs" TEXT,
    "nuls" TEXT,
    "nuance" TEXT,
    "nom" TEXT,
    "prenom" TEXT,
    "sexe" TEXT,
    "voix" TEXT,
    "pct_inscrits" TEXT,
    "pct_exprimes" TEXT,
    "elu" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "election_result_raw_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "election_turnout_natural_key_key" ON "silver"."election_turnout"("natural_key");

-- CreateIndex
CREATE INDEX "election_turnout_territory_id_idx" ON "silver"."election_turnout"("territory_id");

-- CreateIndex
CREATE UNIQUE INDEX "election_turnout_election_id_territory_id_round_key" ON "silver"."election_turnout"("election_id", "territory_id", "round");

-- CreateIndex
CREATE INDEX "election_result_raw_code_circonscription_idx" ON "bronze"."election_result_raw"("code_circonscription");

-- CreateIndex
CREATE UNIQUE INDEX "election_result_raw_import_run_id_ligne_rang_key" ON "bronze"."election_result_raw"("import_run_id", "ligne", "rang");

-- AddForeignKey
ALTER TABLE "silver"."election_turnout" ADD CONSTRAINT "election_turnout_election_id_fkey" FOREIGN KEY ("election_id") REFERENCES "silver"."election"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."election_turnout" ADD CONSTRAINT "election_turnout_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "silver"."territory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
