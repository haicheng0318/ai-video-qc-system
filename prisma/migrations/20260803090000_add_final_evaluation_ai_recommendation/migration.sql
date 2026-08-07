DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "final_video_evaluations" LIMIT 1) THEN
    RAISE EXCEPTION 'Phase 7 migration requires final_video_evaluations to be empty';
  END IF;
END $$;

ALTER TABLE "final_video_evaluations"
ADD COLUMN "evaluation_version" VARCHAR(50) NOT NULL DEFAULT 'final-evaluation-v1',
ADD COLUMN "status" "AiReviewStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN "error_message" TEXT,
ADD COLUMN "triggered_by_id" UUID NOT NULL,
ADD COLUMN "recommended_final_grade" VARCHAR(30),
ADD COLUMN "recommended_final_status" VARCHAR(50),
ADD COLUMN "recommended_is_effective" BOOLEAN,
ADD COLUMN "recommendation_confidence" INTEGER,
ADD COLUMN "decision_summary" TEXT,
ADD COLUMN "evidence_assessment" JSONB,
ADD COLUMN "confirmation_focus" JSONB,
ADD COLUMN "risk_flags" JSONB,
ADD COLUMN "completed_at" TIMESTAMP(3),
ADD COLUMN "success_key" VARCHAR(150);

ALTER TABLE "final_video_evaluations"
ALTER COLUMN "content_review_id" SET NOT NULL,
ALTER COLUMN "result_review_id" SET NOT NULL,
ALTER COLUMN "rule_engine_result_id" SET NOT NULL,
ALTER COLUMN "model_provider" SET NOT NULL,
ALTER COLUMN "model_name" SET NOT NULL,
ALTER COLUMN "content_grade" SET NOT NULL,
ALTER COLUMN "data_grade" SET NOT NULL;

ALTER TABLE "final_video_evaluations"
DROP CONSTRAINT "final_video_evaluations_content_review_id_fkey",
DROP CONSTRAINT "final_video_evaluations_result_review_id_fkey",
DROP CONSTRAINT "final_video_evaluations_rule_engine_result_id_fkey";

ALTER TABLE "final_video_evaluations"
ADD CONSTRAINT "final_video_evaluations_content_review_id_fkey"
FOREIGN KEY ("content_review_id") REFERENCES "ai_content_reviews"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "final_video_evaluations_result_review_id_fkey"
FOREIGN KEY ("result_review_id") REFERENCES "ai_result_reviews"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "final_video_evaluations_rule_engine_result_id_fkey"
FOREIGN KEY ("rule_engine_result_id") REFERENCES "rule_engine_results"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "final_video_evaluations_success_key_key"
ON "final_video_evaluations"("success_key");

CREATE INDEX "final_video_evaluations_content_review_id_idx"
ON "final_video_evaluations"("content_review_id");

CREATE INDEX "final_video_evaluations_result_review_id_idx"
ON "final_video_evaluations"("result_review_id");

CREATE INDEX "final_video_evaluations_rule_engine_result_id_idx"
ON "final_video_evaluations"("rule_engine_result_id");

CREATE INDEX "final_video_evaluations_triggered_by_id_idx"
ON "final_video_evaluations"("triggered_by_id");

CREATE INDEX "final_video_evaluations_status_idx"
ON "final_video_evaluations"("status");

CREATE INDEX "final_video_evaluations_video_id_created_at_id_idx"
ON "final_video_evaluations"("video_id", "created_at", "id");

ALTER TABLE "final_video_evaluations"
ADD CONSTRAINT "final_video_evaluations_triggered_by_id_fkey"
FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
