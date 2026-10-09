CREATE TABLE "v11_evaluation_input_revisions" (
  "id" UUID NOT NULL,
  "video_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "file_hash" CHAR(64) NOT NULL,
  "metadata_snapshot" JSONB NOT NULL,
  "metadata_snapshot_hash" CHAR(64) NOT NULL,
  "media_manifest" JSONB NOT NULL,
  "media_manifest_hash" CHAR(64) NOT NULL,
  "model_config_snapshot" JSONB NOT NULL,
  "prompt_version" VARCHAR(80) NOT NULL,
  "schema_version" VARCHAR(80) NOT NULL,
  "rubric_version" VARCHAR(80) NOT NULL,
  "rating_version" VARCHAR(80) NOT NULL,
  "preprocessing_version" VARCHAR(80) NOT NULL,
  "reference_set_version" VARCHAR(80) NOT NULL,
  "evaluation_fingerprint" CHAR(64) NOT NULL,
  "input_complete" BOOLEAN NOT NULL DEFAULT true,
  "incomplete_reasons" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "v11_evaluation_input_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "v11_workflow_revisions" (
  "id" UUID NOT NULL,
  "video_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'current',
  "active_content_decision_id" UUID,
  "policy_snapshot" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "superseded_at" TIMESTAMP(3),
  CONSTRAINT "v11_workflow_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "v11_evaluation_groups" (
  "id" UUID NOT NULL,
  "video_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "input_revision_id" UUID NOT NULL,
  "workflow_revision_id" UUID NOT NULL,
  "stage" VARCHAR(30) NOT NULL DEFAULT 'content',
  "status" VARCHAR(30) NOT NULL DEFAULT 'queued',
  "trigger_reason" VARCHAR(80) NOT NULL,
  "shadow_mode" BOOLEAN NOT NULL DEFAULT true,
  "valid_run_count" INTEGER NOT NULL DEFAULT 0,
  "technical_attempt_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "v11_evaluation_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "v11_evaluation_runs" (
  "id" UUID NOT NULL,
  "group_id" UUID NOT NULL,
  "run_number" INTEGER NOT NULL,
  "run_role" VARCHAR(30) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'pending',
  "blind_context_hash" CHAR(64) NOT NULL,
  "model_provider" VARCHAR(50) NOT NULL,
  "model_name" VARCHAR(100) NOT NULL,
  "model_config_snapshot" JSONB NOT NULL,
  "prompt_version" VARCHAR(80) NOT NULL,
  "schema_version" VARCHAR(80) NOT NULL,
  "rubric_version" VARCHAR(80) NOT NULL,
  "rating_version" VARCHAR(80) NOT NULL,
  "preprocessing_version" VARCHAR(80) NOT NULL,
  "reference_set_version" VARCHAR(80) NOT NULL,
  "structured_output" JSONB,
  "raw_response" JSONB,
  "total_score" DECIMAL(5,1),
  "content_rating" VARCHAR(10),
  "compliance_status" VARCHAR(20),
  "facts_hash" CHAR(64),
  "technical_attempts" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "stale" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "v11_evaluation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "v11_evaluation_decisions" (
  "id" UUID NOT NULL,
  "group_id" UUID NOT NULL,
  "workflow_revision_id" UUID NOT NULL,
  "source_run_ids" UUID[] NOT NULL,
  "adopted_dimensions" JSONB NOT NULL,
  "total_score" DECIMAL(5,1),
  "content_rating" VARCHAR(10),
  "compliance_status" VARCHAR(20) NOT NULL,
  "input_complete" BOOLEAN NOT NULL,
  "stable" BOOLEAN NOT NULL,
  "decision_source" VARCHAR(20) NOT NULL DEFAULT 'system',
  "adoption_method" VARCHAR(50) NOT NULL,
  "actor_id" UUID,
  "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "v11_evaluation_decisions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "evaluation_jobs" ADD COLUMN "v11_run_id" UUID;

CREATE UNIQUE INDEX "v11_evaluation_input_revisions_video_id_revision_key" ON "v11_evaluation_input_revisions"("video_id", "revision");
CREATE INDEX "v11_evaluation_input_revisions_owner_id_evaluation_fingerpr_idx" ON "v11_evaluation_input_revisions"("owner_id", "evaluation_fingerprint");
CREATE INDEX "v11_evaluation_input_revisions_video_id_created_at_idx" ON "v11_evaluation_input_revisions"("video_id", "created_at");
CREATE UNIQUE INDEX "v11_workflow_revisions_video_id_revision_key" ON "v11_workflow_revisions"("video_id", "revision");
CREATE UNIQUE INDEX "v11_workflow_revisions_one_current_per_video" ON "v11_workflow_revisions"("video_id") WHERE "status" = 'current';
CREATE INDEX "v11_workflow_revisions_video_id_status_idx" ON "v11_workflow_revisions"("video_id", "status");
CREATE INDEX "v11_evaluation_groups_video_id_created_at_idx" ON "v11_evaluation_groups"("video_id", "created_at");
CREATE INDEX "v11_evaluation_groups_owner_id_status_idx" ON "v11_evaluation_groups"("owner_id", "status");
CREATE INDEX "v11_evaluation_groups_input_revision_id_idx" ON "v11_evaluation_groups"("input_revision_id");
CREATE UNIQUE INDEX "v11_evaluation_groups_one_active_fingerprint" ON "v11_evaluation_groups"("owner_id", "input_revision_id", "stage") WHERE "status" IN ('queued','running','review_required');
CREATE UNIQUE INDEX "v11_evaluation_runs_group_id_run_number_key" ON "v11_evaluation_runs"("group_id", "run_number");
CREATE INDEX "v11_evaluation_runs_group_id_status_idx" ON "v11_evaluation_runs"("group_id", "status");
CREATE UNIQUE INDEX "v11_evaluation_decisions_group_id_key" ON "v11_evaluation_decisions"("group_id");
CREATE INDEX "v11_evaluation_decisions_workflow_revision_id_idx" ON "v11_evaluation_decisions"("workflow_revision_id");
CREATE UNIQUE INDEX "evaluation_jobs_v11_run_id_key" ON "evaluation_jobs"("v11_run_id");

ALTER TABLE "v11_evaluation_input_revisions" ADD CONSTRAINT "v11_evaluation_input_revisions_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_evaluation_input_revisions" ADD CONSTRAINT "v11_evaluation_input_revisions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_workflow_revisions" ADD CONSTRAINT "v11_workflow_revisions_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_workflow_revisions" ADD CONSTRAINT "v11_workflow_revisions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_evaluation_groups" ADD CONSTRAINT "v11_evaluation_groups_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_evaluation_groups" ADD CONSTRAINT "v11_evaluation_groups_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_evaluation_groups" ADD CONSTRAINT "v11_evaluation_groups_input_revision_id_fkey" FOREIGN KEY ("input_revision_id") REFERENCES "v11_evaluation_input_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_evaluation_groups" ADD CONSTRAINT "v11_evaluation_groups_workflow_revision_id_fkey" FOREIGN KEY ("workflow_revision_id") REFERENCES "v11_workflow_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_evaluation_runs" ADD CONSTRAINT "v11_evaluation_runs_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "v11_evaluation_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_evaluation_decisions" ADD CONSTRAINT "v11_evaluation_decisions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "v11_evaluation_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_evaluation_decisions" ADD CONSTRAINT "v11_evaluation_decisions_workflow_revision_id_fkey" FOREIGN KEY ("workflow_revision_id") REFERENCES "v11_workflow_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_evaluation_decisions" ADD CONSTRAINT "v11_evaluation_decisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evaluation_jobs" ADD CONSTRAINT "evaluation_jobs_v11_run_id_fkey" FOREIGN KEY ("v11_run_id") REFERENCES "v11_evaluation_runs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
