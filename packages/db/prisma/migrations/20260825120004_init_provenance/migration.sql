-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "bronze";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "gold";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "silver";

-- CreateEnum
CREATE TYPE "silver"."ImportRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED_UNCHANGED');

-- CreateTable
CREATE TABLE "silver"."source" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "homepage" TEXT,

    CONSTRAINT "source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."dataset" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."dataset_resource" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "format" TEXT NOT NULL,

    CONSTRAINT "dataset_resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."import_run" (
    "id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" "silver"."ImportRunStatus" NOT NULL DEFAULT 'RUNNING',
    "staged" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "pending" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "import_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."import_rejection" (
    "id" TEXT NOT NULL,
    "import_run_id" TEXT NOT NULL,
    "bronze_table" TEXT NOT NULL,
    "bronze_ref" TEXT,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,

    CONSTRAINT "import_rejection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dataset_source_id_external_id_key" ON "silver"."dataset"("source_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_resource_dataset_id_external_id_key" ON "silver"."dataset_resource"("dataset_id", "external_id");

-- CreateIndex
CREATE INDEX "import_rejection_import_run_id_idx" ON "silver"."import_rejection"("import_run_id");

-- AddForeignKey
ALTER TABLE "silver"."dataset" ADD CONSTRAINT "dataset_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "silver"."source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."dataset_resource" ADD CONSTRAINT "dataset_resource_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "silver"."dataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."import_run" ADD CONSTRAINT "import_run_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "silver"."dataset_resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."import_rejection" ADD CONSTRAINT "import_rejection_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "silver"."import_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
