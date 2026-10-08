CREATE TABLE "evaluation_jobs" (
  "id" UUID PRIMARY KEY,
  "video_id" UUID NOT NULL REFERENCES "videos"("id") ON DELETE RESTRICT,
  "actor_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "stage" VARCHAR(20) NOT NULL CHECK (stage IN ('content', 'result', 'final')),
  "status" VARCHAR(30) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'retry_wait', 'succeeded', 'failed', 'needs_attention')),
  "content_review_id" UUID UNIQUE REFERENCES "ai_content_reviews"("id") ON DELETE RESTRICT,
  "result_review_id" UUID UNIQUE REFERENCES "ai_result_reviews"("id") ON DELETE RESTRICT,
  "final_evaluation_id" UUID UNIQUE REFERENCES "final_video_evaluations"("id") ON DELETE RESTRICT,
  "input_refs" JSONB NOT NULL DEFAULT '{}',
  "max_output_tokens" INTEGER NOT NULL DEFAULT 4000 CHECK (max_output_tokens > 0),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 5),
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMP(3),
  "worker_id" VARCHAR(150),
  "external_started_at" TIMESTAMP(3),
  "failure_code" VARCHAR(80),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT evaluation_jobs_target_check CHECK (
    (stage = 'content' AND content_review_id IS NOT NULL AND result_review_id IS NULL AND final_evaluation_id IS NULL) OR
    (stage = 'result' AND content_review_id IS NULL AND result_review_id IS NOT NULL AND final_evaluation_id IS NULL) OR
    (stage = 'final' AND content_review_id IS NULL AND result_review_id IS NULL AND final_evaluation_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX evaluation_jobs_active_video_stage ON evaluation_jobs(video_id, stage) WHERE status IN ('queued', 'running', 'retry_wait');
CREATE INDEX evaluation_jobs_status_available_at_created_at_idx ON evaluation_jobs(status, available_at, created_at);
CREATE INDEX evaluation_jobs_status_lease_expires_at_idx ON evaluation_jobs(status, lease_expires_at);
CREATE TABLE evaluation_job_attempts (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES evaluation_jobs(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL,
  fencing_token UUID NOT NULL UNIQUE,
  worker_id VARCHAR(150) NOT NULL,
  status VARCHAR(30) NOT NULL,
  started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  external_started_at TIMESTAMP(3),
  completed_at TIMESTAMP(3),
  failure_code VARCHAR(80),
  UNIQUE(job_id, attempt_number)
);
