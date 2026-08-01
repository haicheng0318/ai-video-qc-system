-- Phase 6 source bindings are safe because rule_engine_results is empty before migration.
ALTER TABLE "rule_engine_results"
ADD COLUMN "content_review_id" UUID NOT NULL,
ADD COLUMN "result_review_id" UUID NOT NULL,
ADD COLUMN "rule_version" VARCHAR(50) NOT NULL DEFAULT 'rule-engine-v1';

CREATE UNIQUE INDEX "rule_engine_results_result_review_id_rule_version_key"
ON "rule_engine_results"("result_review_id", "rule_version");

CREATE INDEX "rule_engine_results_content_review_id_idx"
ON "rule_engine_results"("content_review_id");

CREATE INDEX "rule_engine_results_result_review_id_idx"
ON "rule_engine_results"("result_review_id");

CREATE INDEX "rule_engine_results_video_id_created_at_id_idx"
ON "rule_engine_results"("video_id", "created_at", "id");

ALTER TABLE "rule_engine_results"
ADD CONSTRAINT "rule_engine_results_content_review_id_fkey"
FOREIGN KEY ("content_review_id") REFERENCES "ai_content_reviews"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rule_engine_results"
ADD CONSTRAINT "rule_engine_results_result_review_id_fkey"
FOREIGN KEY ("result_review_id") REFERENCES "ai_result_reviews"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
