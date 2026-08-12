ALTER TABLE "final_video_evaluations"
ADD COLUMN "confirmation_comment" TEXT,
ADD COLUMN "case_marked_by_id" UUID,
ADD COLUMN "case_marked_at" TIMESTAMP(3),
ADD COLUMN "case_note" TEXT;

ALTER TABLE "final_video_evaluations"
ADD CONSTRAINT "final_video_evaluations_case_marked_by_id_fkey"
FOREIGN KEY ("case_marked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "final_video_evaluations_confirmed_at_idx" ON "final_video_evaluations"("confirmed_at");
CREATE INDEX "final_video_evaluations_final_grade_idx" ON "final_video_evaluations"("final_grade");
CREATE INDEX "final_video_evaluations_can_be_used_for_performance_idx" ON "final_video_evaluations"("can_be_used_for_performance");
CREATE INDEX "final_video_evaluations_is_excellent_case_idx" ON "final_video_evaluations"("is_excellent_case");
CREATE INDEX "final_video_evaluations_is_negative_case_idx" ON "final_video_evaluations"("is_negative_case");
CREATE INDEX "final_video_evaluations_case_marked_at_idx" ON "final_video_evaluations"("case_marked_at");
CREATE INDEX "final_video_evaluations_case_marked_by_id_idx" ON "final_video_evaluations"("case_marked_by_id");
