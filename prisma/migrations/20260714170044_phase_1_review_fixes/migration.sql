-- AlterTable
ALTER TABLE "operation_logs" ADD COLUMN     "result" VARCHAR(50),
ADD COLUMN     "target_id" VARCHAR(100),
ADD COLUMN     "target_type" VARCHAR(50);

-- CreateIndex
CREATE INDEX "operation_logs_target_type_target_id_idx" ON "operation_logs"("target_type", "target_id");
