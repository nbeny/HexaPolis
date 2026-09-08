-- CreateTable
CREATE TABLE "bronze"."geo_circonscription_raw" (
    "id" BIGSERIAL NOT NULL,
    "import_run_id" TEXT NOT NULL,
    "ligne" INTEGER NOT NULL,
    "code_circonscription" TEXT,
    "code_departement" TEXT,
    "nom_circonscription" TEXT,
    "nom_departement" TEXT,
    "geometry" JSONB NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "geo_circonscription_raw_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "geo_circonscription_raw_code_circonscription_idx" ON "bronze"."geo_circonscription_raw"("code_circonscription");

-- CreateIndex
CREATE UNIQUE INDEX "geo_circonscription_raw_import_run_id_ligne_key" ON "bronze"."geo_circonscription_raw"("import_run_id", "ligne");
