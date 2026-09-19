ALTER TABLE "evaluation_jobs" ADD COLUMN "failure_category" VARCHAR(30);
ALTER TABLE "evaluation_job_attempts" ADD COLUMN "failure_category" VARCHAR(30);
ALTER TABLE "ai_usage_records" ADD COLUMN "is_trial" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "collection_status" VARCHAR(20) NOT NULL DEFAULT 'pending', ADD COLUMN "failure_category" VARCHAR(30);
UPDATE ai_usage_records u SET is_trial = v.is_trial FROM evaluation_jobs j JOIN videos v ON v.id = j.video_id WHERE u.job_id = j.id;
UPDATE ai_usage_records SET collection_status = CASE WHEN input_tokens IS NOT NULL AND output_tokens IS NOT NULL THEN 'collected' ELSE 'unknown' END;
