ALTER TABLE "supervisor_reviews"
ADD COLUMN "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "supervisor_reviews_video_id_key"
ON "supervisor_reviews"("video_id");
