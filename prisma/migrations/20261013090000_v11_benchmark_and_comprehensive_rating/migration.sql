CREATE TABLE "v11_benchmark_profiles" (
  "id" UUID NOT NULL, "name" VARCHAR(120) NOT NULL, "version" INTEGER NOT NULL,
  "platform" VARCHAR(100) NOT NULL, "brand" VARCHAR(100), "video_type" "VideoType" NOT NULL,
  "primary_metric" VARCHAR(100) NOT NULL, "required_metrics" TEXT[] NOT NULL,
  "minimum_sample_metric" VARCHAR(100) NOT NULL, "minimum_sample_value" DECIMAL(18,4) NOT NULL,
  "observation_window_days" INTEGER NOT NULL, "guard_rules" JSONB NOT NULL DEFAULT '[]',
  "status" VARCHAR(20) NOT NULL DEFAULT 'draft', "enabled" BOOLEAN NOT NULL DEFAULT false,
  "created_by_id" UUID NOT NULL, "approved_by_id" UUID, "approved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "v11_benchmark_profiles_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "v11_benchmark_thresholds" (
  "id" UUID NOT NULL, "profile_id" UUID NOT NULL, "metric_name" VARCHAR(100) NOT NULL,
  "direction" VARCHAR(20) NOT NULL, "s_threshold" DECIMAL(18,4) NOT NULL,
  "a_plus_threshold" DECIMAL(18,4) NOT NULL, "a_threshold" DECIMAL(18,4) NOT NULL,
  "b_threshold" DECIMAL(18,4) NOT NULL, "b_minus_threshold" DECIMAL(18,4) NOT NULL,
  "c_threshold" DECIMAL(18,4) NOT NULL,
  CONSTRAINT "v11_benchmark_thresholds_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "v11_data_rating_decisions" (
  "id" UUID NOT NULL, "video_id" UUID NOT NULL, "workflow_revision_id" UUID NOT NULL,
  "result_metric_id" UUID NOT NULL, "benchmark_profile_id" UUID,
  "data_rating" VARCHAR(10), "data_sufficiency" VARCHAR(20) NOT NULL,
  "rating_version" VARCHAR(80) NOT NULL, "primary_metric" VARCHAR(100),
  "primary_metric_value" DECIMAL(18,4), "guard_applications" JSONB NOT NULL DEFAULT '[]',
  "explanation_review_id" UUID, "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "v11_data_rating_decisions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "v11_comprehensive_decisions" (
  "id" UUID NOT NULL, "video_id" UUID NOT NULL, "workflow_revision_id" UUID NOT NULL,
  "content_decision_id" UUID NOT NULL, "data_decision_id" UUID NOT NULL,
  "decision_revision" INTEGER NOT NULL DEFAULT 1,
  "comprehensive_rating" VARCHAR(10), "matrix_version" VARCHAR(80) NOT NULL,
  "requires_admin_review" BOOLEAN NOT NULL DEFAULT false, "business_conclusion" VARCHAR(30),
  "final_status" VARCHAR(50), "is_effective_final" BOOLEAN, "performance_eligible" BOOLEAN NOT NULL DEFAULT false,
  "decision_source" VARCHAR(20), "decision_actor_id" UUID,
  "is_excellent_case" BOOLEAN NOT NULL DEFAULT false, "is_negative_case" BOOLEAN NOT NULL DEFAULT false,
  "case_marked_by_id" UUID, "case_marked_at" TIMESTAMP(3), "case_note" VARCHAR(500), "explanation" JSONB,
  "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "v11_comprehensive_decisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "v11_benchmark_profiles_platform_brand_video_type_version_key" ON "v11_benchmark_profiles"("platform", "brand", "video_type", "version");
CREATE INDEX "v11_benchmark_profiles_platform_brand_video_type_status_ena_idx" ON "v11_benchmark_profiles"("platform", "brand", "video_type", "status", "enabled");
CREATE UNIQUE INDEX "v11_benchmark_profiles_one_enabled_exact" ON "v11_benchmark_profiles"("platform", COALESCE("brand", ''), "video_type") WHERE "status" = 'approved' AND "enabled" = true;
CREATE UNIQUE INDEX "v11_benchmark_thresholds_profile_id_metric_name_key" ON "v11_benchmark_thresholds"("profile_id", "metric_name");
CREATE UNIQUE INDEX "v11_data_rating_decisions_workflow_revision_id_result_metri_key" ON "v11_data_rating_decisions"("workflow_revision_id", "result_metric_id");
CREATE INDEX "v11_data_rating_decisions_video_id_decided_at_idx" ON "v11_data_rating_decisions"("video_id", "decided_at");
CREATE UNIQUE INDEX "v11_comprehensive_decisions_workflow_revision_id_content_de_key" ON "v11_comprehensive_decisions"("workflow_revision_id", "content_decision_id", "data_decision_id", "matrix_version", "decision_revision");
CREATE INDEX "v11_comprehensive_decisions_video_id_decided_at_idx" ON "v11_comprehensive_decisions"("video_id", "decided_at");
CREATE INDEX "v11_comprehensive_decisions_comprehensive_rating_idx" ON "v11_comprehensive_decisions"("comprehensive_rating");

ALTER TABLE "v11_benchmark_profiles" ADD CONSTRAINT "v11_benchmark_profiles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_benchmark_profiles" ADD CONSTRAINT "v11_benchmark_profiles_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_benchmark_thresholds" ADD CONSTRAINT "v11_benchmark_thresholds_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "v11_benchmark_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_data_rating_decisions" ADD CONSTRAINT "v11_data_rating_decisions_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_data_rating_decisions" ADD CONSTRAINT "v11_data_rating_decisions_workflow_revision_id_fkey" FOREIGN KEY ("workflow_revision_id") REFERENCES "v11_workflow_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_data_rating_decisions" ADD CONSTRAINT "v11_data_rating_decisions_result_metric_id_fkey" FOREIGN KEY ("result_metric_id") REFERENCES "video_result_metrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_data_rating_decisions" ADD CONSTRAINT "v11_data_rating_decisions_benchmark_profile_id_fkey" FOREIGN KEY ("benchmark_profile_id") REFERENCES "v11_benchmark_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_comprehensive_decisions" ADD CONSTRAINT "v11_comprehensive_decisions_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_comprehensive_decisions" ADD CONSTRAINT "v11_comprehensive_decisions_workflow_revision_id_fkey" FOREIGN KEY ("workflow_revision_id") REFERENCES "v11_workflow_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_comprehensive_decisions" ADD CONSTRAINT "v11_comprehensive_decisions_content_decision_id_fkey" FOREIGN KEY ("content_decision_id") REFERENCES "v11_evaluation_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_comprehensive_decisions" ADD CONSTRAINT "v11_comprehensive_decisions_data_decision_id_fkey" FOREIGN KEY ("data_decision_id") REFERENCES "v11_data_rating_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_comprehensive_decisions" ADD CONSTRAINT "v11_comprehensive_decisions_decision_actor_id_fkey" FOREIGN KEY ("decision_actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_comprehensive_decisions" ADD CONSTRAINT "v11_comprehensive_decisions_case_marked_by_id_fkey" FOREIGN KEY ("case_marked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
