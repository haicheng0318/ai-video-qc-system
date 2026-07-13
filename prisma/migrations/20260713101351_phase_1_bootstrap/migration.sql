-- AlterTable
ALTER TABLE "ai_content_reviews" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_model_configs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ai_result_reviews" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "content_review_scores" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "final_video_evaluations" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "operation_logs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "platform_benchmarks" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "rule_engine_results" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "supervisor_reviews" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "video_result_metrics" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "videos" ALTER COLUMN "id" DROP DEFAULT;
