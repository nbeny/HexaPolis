-- CreateTable
CREATE TABLE "silver"."person" (
    "id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "match_key" TEXT NOT NULL,
    "civility" TEXT,
    "birth_date" TIMESTAMP(3),
    "birth_place" TEXT,
    "death_date" TIMESTAMP(3),
    "profession" TEXT,

    CONSTRAINT "person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."person_name_variant" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,

    CONSTRAINT "person_name_variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."external_identifier" (
    "id" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "external_identifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."institution" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."legislature" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),

    CONSTRAINT "legislature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."territory" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parent_id" TEXT,

    CONSTRAINT "territory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."body" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "short_label" TEXT,
    "legislature_id" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "color" TEXT,

    CONSTRAINT "body_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."body_membership" (
    "id" TEXT NOT NULL,
    "natural_key" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "body_id" TEXT NOT NULL,
    "quality" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),

    CONSTRAINT "body_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."mandate" (
    "id" TEXT NOT NULL,
    "natural_key" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "legislature_id" TEXT,
    "territory_id" TEXT,
    "kind" TEXT NOT NULL,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "end_cause" TEXT,

    CONSTRAINT "mandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."provenance" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "field" TEXT,
    "import_run_id" TEXT NOT NULL,
    "bronze_table" TEXT NOT NULL,
    "bronze_ref" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OFFICIAL',

    CONSTRAINT "provenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "person_match_key_idx" ON "silver"."person"("match_key");

-- CreateIndex
CREATE UNIQUE INDEX "person_name_variant_person_id_form_source_id_key" ON "silver"."person_name_variant"("person_id", "form", "source_id");

-- CreateIndex
CREATE INDEX "external_identifier_owner_type_owner_id_idx" ON "silver"."external_identifier"("owner_type", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_identifier_source_id_kind_value_key" ON "silver"."external_identifier"("source_id", "kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "institution_code_key" ON "silver"."institution"("code");

-- CreateIndex
CREATE UNIQUE INDEX "legislature_number_key" ON "silver"."legislature"("number");

-- CreateIndex
CREATE UNIQUE INDEX "territory_type_code_key" ON "silver"."territory"("type", "code");

-- CreateIndex
CREATE UNIQUE INDEX "body_membership_natural_key_key" ON "silver"."body_membership"("natural_key");

-- CreateIndex
CREATE UNIQUE INDEX "mandate_natural_key_key" ON "silver"."mandate"("natural_key");

-- CreateIndex
CREATE INDEX "provenance_entity_type_entity_id_idx" ON "silver"."provenance"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "silver"."person_name_variant" ADD CONSTRAINT "person_name_variant_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "silver"."person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."territory" ADD CONSTRAINT "territory_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "silver"."territory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."body" ADD CONSTRAINT "body_legislature_id_fkey" FOREIGN KEY ("legislature_id") REFERENCES "silver"."legislature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."body_membership" ADD CONSTRAINT "body_membership_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "silver"."person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."body_membership" ADD CONSTRAINT "body_membership_body_id_fkey" FOREIGN KEY ("body_id") REFERENCES "silver"."body"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."mandate" ADD CONSTRAINT "mandate_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "silver"."person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."mandate" ADD CONSTRAINT "mandate_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "silver"."institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."mandate" ADD CONSTRAINT "mandate_legislature_id_fkey" FOREIGN KEY ("legislature_id") REFERENCES "silver"."legislature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."mandate" ADD CONSTRAINT "mandate_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "silver"."territory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
