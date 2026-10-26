CREATE TYPE "VideoRecordState" AS ENUM ('active', 'hidden', 'trashed');

ALTER TABLE "videos"
  ADD COLUMN "record_state" "VideoRecordState" NOT NULL DEFAULT 'active',
  ADD COLUMN "record_state_changed_at" TIMESTAMP(3),
  ADD COLUMN "record_state_changed_by_id" UUID,
  ADD COLUMN "cover_path" TEXT,
  ADD COLUMN "cover_source" VARCHAR(20);

CREATE INDEX "videos_record_state_created_at_idx" ON "videos"("record_state", "created_at");

ALTER TABLE "v11_evaluation_input_revisions"
  ADD COLUMN "fact_claim_version" VARCHAR(80);

ALTER TABLE "videos"
  ADD CONSTRAINT "videos_record_state_changed_by_id_fkey"
  FOREIGN KEY ("record_state_changed_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
