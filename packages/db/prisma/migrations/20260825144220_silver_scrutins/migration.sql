-- CreateTable
CREATE TABLE "silver"."parliamentary_ballot" (
    "id" TEXT NOT NULL,
    "natural_key" TEXT NOT NULL,
    "legislature_id" TEXT,
    "number" TEXT,
    "date" TIMESTAMP(3),
    "title" TEXT,
    "vote_type_code" TEXT,
    "vote_type_label" TEXT,
    "outcome_code" TEXT,
    "outcome_label" TEXT,
    "publication_mode" TEXT,
    "official_for" INTEGER,
    "official_against" INTEGER,
    "official_abstention" INTEGER,
    "official_non_voting" INTEGER,

    CONSTRAINT "parliamentary_ballot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silver"."ballot_position" (
    "id" TEXT NOT NULL,
    "natural_key" TEXT NOT NULL,
    "ballot_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "by_delegation" BOOLEAN NOT NULL DEFAULT false,
    "body_id_at_vote" TEXT,

    CONSTRAINT "ballot_position_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parliamentary_ballot_natural_key_key" ON "silver"."parliamentary_ballot"("natural_key");

-- CreateIndex
CREATE INDEX "parliamentary_ballot_date_idx" ON "silver"."parliamentary_ballot"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ballot_position_natural_key_key" ON "silver"."ballot_position"("natural_key");

-- CreateIndex
CREATE INDEX "ballot_position_person_id_idx" ON "silver"."ballot_position"("person_id");

-- CreateIndex
CREATE INDEX "ballot_position_ballot_id_idx" ON "silver"."ballot_position"("ballot_id");

-- AddForeignKey
ALTER TABLE "silver"."parliamentary_ballot" ADD CONSTRAINT "parliamentary_ballot_legislature_id_fkey" FOREIGN KEY ("legislature_id") REFERENCES "silver"."legislature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."ballot_position" ADD CONSTRAINT "ballot_position_ballot_id_fkey" FOREIGN KEY ("ballot_id") REFERENCES "silver"."parliamentary_ballot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "silver"."ballot_position" ADD CONSTRAINT "ballot_position_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "silver"."person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
