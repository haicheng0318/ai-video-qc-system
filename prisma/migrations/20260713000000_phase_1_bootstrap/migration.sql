CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "UserRole" AS ENUM ('admin', 'content_owner', 'supervisor', 'director', 'operator', 'advertiser');
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled');
CREATE TYPE "VideoStatus" AS ENUM (
  'submitted',
  'ai_content_reviewing',
  'ai_content_failed',
  'pending_supervisor_review',
  'revision_required',
  'invalid_content',
  'approved_for_publish',
  'pending_result_data',
  'ai_result_reviewing',
  'ai_result_failed',
  'pending_rule_engine',
  'pending_final_evaluation',
  'final_evaluation_failed',
  'pending_final_confirmation',
  'final_effective',
  'final_low_effective',
  'final_invalid',
  'pending_data',
  'excellent_case',
  'negative_case'
);
CREATE TYPE "VideoType" AS ENUM ('product_card', 'qianchuan_ad', 'live_room_traffic', 'organic', 'brand_seeding', 'other');
CREATE TYPE "AiReviewStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');
CREATE TYPE "DataSufficiency" AS ENUM ('sufficient', 'insufficient', 'pending');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(100) NOT NULL,
  "account" VARCHAR(100) NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "role" "UserRole" NOT NULL,
  "department" VARCHAR(100),
  "manager_id" UUID,
  "status" "UserStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "videos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title" VARCHAR(255) NOT NULL,
  "original_file_name" VARCHAR(255) NOT NULL,
  "file_path" TEXT NOT NULL,
  "file_url" TEXT,
  "cover_url" TEXT,
  "mime_type" VARCHAR(100) NOT NULL,
  "file_size_bytes" BIGINT NOT NULL,
  "duration" INTEGER,
  "brand" VARCHAR(100),
  "product" VARCHAR(100),
  "platform" VARCHAR(100),
  "video_type" "VideoType" NOT NULL,
  "script_description" TEXT,
  "is_for_ads" BOOLEAN NOT NULL DEFAULT false,
  "is_event_video" BOOLEAN NOT NULL DEFAULT false,
  "event_name" VARCHAR(100),
  "related_requirement" TEXT,
  "creator_id" UUID NOT NULL,
  "status" "VideoStatus" NOT NULL DEFAULT 'submitted',
  "parent_video_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_content_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "video_id" UUID NOT NULL,
  "model_provider" VARCHAR(50) NOT NULL,
  "model_name" VARCHAR(100) NOT NULL,
  "content_summary" TEXT,
  "total_score" INTEGER,
  "content_grade" VARCHAR(20),
  "is_publishable_recommendation" BOOLEAN,
  "main_problems" JSONB,
  "revision_suggestions" JSONB,
  "compliance_risks" JSONB,
  "usable_scenarios" JSONB,
  "raw_response" JSONB,
  "status" "AiReviewStatus" NOT NULL DEFAULT 'pending',
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_content_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "content_review_scores" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ai_content_review_id" UUID NOT NULL,
  "dimension" VARCHAR(100) NOT NULL,
  "score" INTEGER NOT NULL,
  "max_score" INTEGER NOT NULL,
  "comment" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_review_scores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supervisor_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "video_id" UUID NOT NULL,
  "reviewer_id" UUID NOT NULL,
  "review_result" VARCHAR(50) NOT NULL,
  "adjusted_content_grade" VARCHAR(20),
  "is_allowed_to_publish" BOOLEAN,
  "comment" TEXT,
  "revision_focus" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supervisor_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "video_result_metrics" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "video_id" UUID NOT NULL,
  "video_type" "VideoType" NOT NULL,
  "publish_url" TEXT,
  "publish_date" TIMESTAMP(3),
  "data_start_date" TIMESTAMP(3),
  "data_end_date" TIMESTAMP(3),
  "campaign_name" VARCHAR(255),
  "impressions" INTEGER,
  "views" INTEGER,
  "clicks" INTEGER,
  "ctr" DECIMAL(12,4),
  "product_clicks" INTEGER,
  "product_ctr" DECIMAL(12,4),
  "spend" DECIMAL(14,2),
  "cpc" DECIMAL(14,4),
  "cpm" DECIMAL(14,4),
  "orders" INTEGER,
  "gmv" DECIMAL(14,2),
  "conversion_rate" DECIMAL(12,4),
  "cvr" DECIMAL(12,4),
  "roi" DECIMAL(12,4),
  "live_room_entries" INTEGER,
  "entry_rate" DECIMAL(12,4),
  "entry_cost" DECIMAL(14,4),
  "avg_stay_seconds" INTEGER,
  "interactions" INTEGER,
  "live_orders" INTEGER,
  "live_gmv" DECIMAL(14,2),
  "three_second_view_rate" DECIMAL(12,4),
  "completion_rate" DECIMAL(12,4),
  "avg_watch_seconds" INTEGER,
  "likes" INTEGER,
  "comments" INTEGER,
  "shares" INTEGER,
  "saves" INTEGER,
  "followers_gain" INTEGER,
  "brand_search_growth" INTEGER,
  "positive_comments_count" INTEGER,
  "comment_keywords" TEXT,
  "operator_note" TEXT,
  "delivery_note" TEXT,
  "plan_status" VARCHAR(100),
  "data_screenshot_url" TEXT,
  "submitted_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "video_result_metrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_result_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "video_id" UUID NOT NULL,
  "result_metric_id" UUID,
  "model_provider" VARCHAR(50) NOT NULL,
  "model_name" VARCHAR(100) NOT NULL,
  "data_score" INTEGER,
  "data_grade" VARCHAR(20),
  "data_sufficiency" "DataSufficiency" NOT NULL DEFAULT 'pending',
  "is_business_effective_recommendation" BOOLEAN,
  "result_summary" TEXT,
  "performance_problems" JSONB,
  "attribution_analysis" JSONB,
  "optimization_suggestions" JSONB,
  "raw_response" JSONB,
  "status" "AiReviewStatus" NOT NULL DEFAULT 'pending',
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_result_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rule_engine_results" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "video_id" UUID NOT NULL,
  "content_grade" VARCHAR(20),
  "data_grade" VARCHAR(20),
  "data_sufficiency" "DataSufficiency" NOT NULL DEFAULT 'pending',
  "rule_code" VARCHAR(100) NOT NULL,
  "rule_result" VARCHAR(100) NOT NULL,
  "rule_reason" TEXT NOT NULL,
  "recommended_boundary" VARCHAR(150) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rule_engine_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "final_video_evaluations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "video_id" UUID NOT NULL,
  "content_review_id" UUID,
  "result_review_id" UUID,
  "rule_engine_result_id" UUID,
  "model_provider" VARCHAR(50),
  "model_name" VARCHAR(100),
  "content_grade" VARCHAR(20),
  "data_grade" VARCHAR(20),
  "final_grade" VARCHAR(20),
  "final_status" VARCHAR(50),
  "is_effective_final" BOOLEAN,
  "is_excellent_case" BOOLEAN NOT NULL DEFAULT false,
  "is_negative_case" BOOLEAN NOT NULL DEFAULT false,
  "can_be_used_for_performance" BOOLEAN NOT NULL DEFAULT false,
  "final_attribution" JSONB,
  "final_suggestion" TEXT,
  "raw_response" JSONB,
  "confirmed_by" UUID,
  "confirmed_at" TIMESTAMP(3),
  "manual_adjust_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "final_video_evaluations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "operation_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "video_id" UUID,
  "action_type" VARCHAR(100) NOT NULL,
  "before_value" JSONB,
  "after_value" JSONB,
  "comment" TEXT,
  "ip_address" VARCHAR(80),
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operation_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_model_configs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agent_type" VARCHAR(80) NOT NULL,
  "provider" VARCHAR(50) NOT NULL,
  "model_name" VARCHAR(100) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "temperature" DECIMAL(4,2),
  "max_tokens" INTEGER,
  "json_schema" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_model_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_benchmarks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "platform" VARCHAR(100) NOT NULL,
  "brand" VARCHAR(100),
  "video_type" "VideoType" NOT NULL,
  "metric_name" VARCHAR(100) NOT NULL,
  "s_threshold" DECIMAL(14,4),
  "a_threshold" DECIMAL(14,4),
  "b_threshold" DECIMAL(14,4),
  "c_threshold" DECIMAL(14,4),
  "direction" VARCHAR(20) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_benchmarks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_account_key" ON "users"("account");
CREATE UNIQUE INDEX "ai_model_configs_agent_type_provider_model_name_key" ON "ai_model_configs"("agent_type", "provider", "model_name");

CREATE INDEX "videos_creator_id_idx" ON "videos"("creator_id");
CREATE INDEX "videos_status_idx" ON "videos"("status");
CREATE INDEX "videos_video_type_idx" ON "videos"("video_type");
CREATE INDEX "ai_content_reviews_video_id_idx" ON "ai_content_reviews"("video_id");
CREATE INDEX "content_review_scores_ai_content_review_id_idx" ON "content_review_scores"("ai_content_review_id");
CREATE INDEX "supervisor_reviews_video_id_idx" ON "supervisor_reviews"("video_id");
CREATE INDEX "supervisor_reviews_reviewer_id_idx" ON "supervisor_reviews"("reviewer_id");
CREATE INDEX "video_result_metrics_video_id_idx" ON "video_result_metrics"("video_id");
CREATE INDEX "video_result_metrics_submitted_by_idx" ON "video_result_metrics"("submitted_by");
CREATE INDEX "ai_result_reviews_video_id_idx" ON "ai_result_reviews"("video_id");
CREATE INDEX "ai_result_reviews_result_metric_id_idx" ON "ai_result_reviews"("result_metric_id");
CREATE INDEX "rule_engine_results_video_id_idx" ON "rule_engine_results"("video_id");
CREATE INDEX "final_video_evaluations_video_id_idx" ON "final_video_evaluations"("video_id");
CREATE INDEX "operation_logs_user_id_idx" ON "operation_logs"("user_id");
CREATE INDEX "operation_logs_video_id_idx" ON "operation_logs"("video_id");
CREATE INDEX "operation_logs_action_type_idx" ON "operation_logs"("action_type");
CREATE INDEX "platform_benchmarks_platform_brand_video_type_idx" ON "platform_benchmarks"("platform", "brand", "video_type");

ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "videos" ADD CONSTRAINT "videos_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "videos" ADD CONSTRAINT "videos_parent_video_id_fkey" FOREIGN KEY ("parent_video_id") REFERENCES "videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_content_reviews" ADD CONSTRAINT "ai_content_reviews_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "content_review_scores" ADD CONSTRAINT "content_review_scores_ai_content_review_id_fkey" FOREIGN KEY ("ai_content_review_id") REFERENCES "ai_content_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supervisor_reviews" ADD CONSTRAINT "supervisor_reviews_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supervisor_reviews" ADD CONSTRAINT "supervisor_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "video_result_metrics" ADD CONSTRAINT "video_result_metrics_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "video_result_metrics" ADD CONSTRAINT "video_result_metrics_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_result_reviews" ADD CONSTRAINT "ai_result_reviews_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_result_reviews" ADD CONSTRAINT "ai_result_reviews_result_metric_id_fkey" FOREIGN KEY ("result_metric_id") REFERENCES "video_result_metrics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rule_engine_results" ADD CONSTRAINT "rule_engine_results_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "final_video_evaluations" ADD CONSTRAINT "final_video_evaluations_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "final_video_evaluations" ADD CONSTRAINT "final_video_evaluations_content_review_id_fkey" FOREIGN KEY ("content_review_id") REFERENCES "ai_content_reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "final_video_evaluations" ADD CONSTRAINT "final_video_evaluations_result_review_id_fkey" FOREIGN KEY ("result_review_id") REFERENCES "ai_result_reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "final_video_evaluations" ADD CONSTRAINT "final_video_evaluations_rule_engine_result_id_fkey" FOREIGN KEY ("rule_engine_result_id") REFERENCES "rule_engine_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "final_video_evaluations" ADD CONSTRAINT "final_video_evaluations_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
