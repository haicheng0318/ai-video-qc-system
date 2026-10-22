BEGIN;

ALTER TABLE "evaluation_jobs"
  DROP CONSTRAINT "evaluation_jobs_stage_check",
  DROP CONSTRAINT "evaluation_jobs_target_check";

ALTER TABLE "evaluation_jobs"
  ADD CONSTRAINT "evaluation_jobs_stage_check"
    CHECK (stage IN ('content', 'result', 'final', 'v11_content')),
  ADD CONSTRAINT "evaluation_jobs_target_check" CHECK (
    (stage = 'content' AND content_review_id IS NOT NULL
      AND result_review_id IS NULL AND final_evaluation_id IS NULL AND v11_run_id IS NULL)
    OR (stage = 'result' AND result_review_id IS NOT NULL
      AND content_review_id IS NULL AND final_evaluation_id IS NULL AND v11_run_id IS NULL)
    OR (stage = 'final' AND final_evaluation_id IS NOT NULL
      AND content_review_id IS NULL AND result_review_id IS NULL AND v11_run_id IS NULL)
    OR (stage = 'v11_content' AND v11_run_id IS NOT NULL
      AND content_review_id IS NULL AND result_review_id IS NULL AND final_evaluation_id IS NULL)
  );

COMMIT;
