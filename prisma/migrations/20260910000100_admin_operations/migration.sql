ALTER TABLE "evaluation_jobs" ADD COLUMN "retried_from_id" UUID;
CREATE UNIQUE INDEX "evaluation_jobs_retried_from_id_key" ON "evaluation_jobs"("retried_from_id");
CREATE TABLE "ai_usage_records" (
 "id" UUID NOT NULL, "job_id" UUID NOT NULL, "attempt_id" UUID NOT NULL, "user_id" UUID NOT NULL,
 "stage" VARCHAR(20) NOT NULL, "provider" VARCHAR(50) NOT NULL, "model_name" VARCHAR(100) NOT NULL,
 "status" VARCHAR(30) NOT NULL DEFAULT 'started', "input_tokens" INTEGER, "output_tokens" INTEGER,
 "estimated_cost" DECIMAL(20,8), "actual_cost" DECIMAL(20,8), "currency" VARCHAR(3),
 "rate_version" INTEGER, "rate_snapshot" JSONB, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "completed_at" TIMESTAMP(3), CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ai_usage_records_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "evaluation_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ai_usage_records_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "evaluation_job_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "usage_nonnegative" CHECK (("input_tokens" IS NULL OR "input_tokens" >= 0) AND ("output_tokens" IS NULL OR "output_tokens" >= 0) AND ("estimated_cost" IS NULL OR "estimated_cost" >= 0) AND ("actual_cost" IS NULL OR "actual_cost" >= 0))
);
CREATE UNIQUE INDEX "ai_usage_records_attempt_id_key" ON "ai_usage_records"("attempt_id");
CREATE INDEX "ai_usage_records_created_at_stage_user_id_idx" ON "ai_usage_records"("created_at", "stage", "user_id");
CREATE TABLE "runtime_settings" ("key" VARCHAR(80) NOT NULL, "value" JSONB NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "runtime_settings_pkey" PRIMARY KEY ("key"));
CREATE TABLE "configuration_revisions" ("id" UUID NOT NULL, "kind" VARCHAR(30) NOT NULL, "target_id" VARCHAR(100) NOT NULL, "version" INTEGER NOT NULL, "value" JSONB NOT NULL, "actor_id" UUID, "reason" VARCHAR(500) NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "configuration_revisions_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "configuration_revisions_kind_target_id_version_key" ON "configuration_revisions"("kind", "target_id", "version");
CREATE TABLE "worker_heartbeats" ("id" VARCHAR(150) NOT NULL, "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("id"));
CREATE TABLE "temporary_storage_records" ("id" UUID NOT NULL, "job_id" UUID, "provider" VARCHAR(20) NOT NULL, "object_path" TEXT NOT NULL, "status" VARCHAR(30) NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "temporary_storage_records_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "temporary_storage_records_object_path_key" ON "temporary_storage_records"("object_path");
