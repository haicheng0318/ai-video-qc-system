ALTER TABLE "ai_content_reviews"
  ADD COLUMN "scoring_version" VARCHAR(80),
  ADD COLUMN "prompt_version" VARCHAR(80);

UPDATE "ai_content_reviews"
SET "scoring_version" = 'legacy-model-score-v1',
    "prompt_version" = 'phase-2-content-review-v2-qwen-omni'
WHERE "status" = 'succeeded'
  AND "scoring_version" IS NULL;
