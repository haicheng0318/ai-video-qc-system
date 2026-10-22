ALTER TABLE "supervisor_reviews"
ADD COLUMN "v11_content_decision_id" UUID;

CREATE INDEX "supervisor_reviews_v11_content_decision_id_idx"
ON "supervisor_reviews"("v11_content_decision_id");

ALTER TABLE "supervisor_reviews"
ADD CONSTRAINT "supervisor_reviews_v11_content_decision_id_fkey"
FOREIGN KEY ("v11_content_decision_id")
REFERENCES "v11_evaluation_decisions"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

-- Move only the former default Shadow policy to formal mode. Explicitly
-- disabled or otherwise customized policies remain untouched.
UPDATE "runtime_settings"
SET
  "value" = '{"enabled":true,"shadowMode":false}'::jsonb,
  "version" = "version" + 1,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'v11_content_shadow'
  AND "value" = '{"enabled":true,"shadowMode":true}'::jsonb;
