-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'visitor';

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'archived';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "last_login_at" TIMESTAMP(3),
ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "videos" ADD COLUMN     "is_trial" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" VARCHAR(80),
    "user_agent" VARCHAR(500),

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_policies" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "period" VARCHAR(10) NOT NULL,
    "limit" BIGINT,

    CONSTRAINT "quota_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "business_key" VARCHAR(200) NOT NULL,
    "amount" BIGINT NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'reserved',
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quota_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_adjustments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "business_key" VARCHAR(200) NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quota_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_tickets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "object_path" TEXT NOT NULL,
    "final_object_path" TEXT,
    "cleaned_at" TIMESTAMP(3),
    "cleanup_error" VARCHAR(200),
    "cleanup_attempts" INTEGER NOT NULL DEFAULT 0,
    "file_size_bytes" BIGINT NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'reserved',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "video_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_sessions_user_id_revoked_at_idx" ON "user_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "quota_policies_user_id_kind_key" ON "quota_policies"("user_id", "kind");

-- CreateIndex
CREATE INDEX "quota_ledger_user_id_kind_window_start_state_idx" ON "quota_ledger"("user_id", "kind", "window_start", "state");

-- CreateIndex
CREATE UNIQUE INDEX "quota_ledger_user_id_kind_business_key_key" ON "quota_ledger"("user_id", "kind", "business_key");

-- CreateIndex
CREATE UNIQUE INDEX "quota_adjustments_user_id_business_key_key" ON "quota_adjustments"("user_id", "business_key");

-- CreateIndex
CREATE UNIQUE INDEX "upload_tickets_object_path_key" ON "upload_tickets"("object_path");
CREATE UNIQUE INDEX "upload_tickets_final_object_path_key" ON "upload_tickets"("final_object_path");

-- CreateIndex
CREATE UNIQUE INDEX "upload_tickets_video_id_key" ON "upload_tickets"("video_id");

-- CreateIndex
CREATE INDEX "upload_tickets_user_id_status_expires_at_idx" ON "upload_tickets"("user_id", "status", "expires_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_policies" ADD CONSTRAINT "quota_policies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_ledger" ADD CONSTRAINT "quota_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_adjustments" ADD CONSTRAINT "quota_adjustments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_tickets" ADD CONSTRAINT "upload_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE quota_policies ADD CONSTRAINT quota_policy_valid CHECK (kind IN ('upload_count','storage_bytes','content_evaluations') AND period IN ('daily','monthly','lifetime') AND ("limit" IS NULL OR "limit" >= 0));
ALTER TABLE quota_ledger ADD CONSTRAINT quota_ledger_valid CHECK (amount > 0 AND state IN ('reserved','committed','released'));
