ALTER TABLE "v11_evaluation_groups" ADD COLUMN "parent_group_id" UUID;

CREATE TABLE "v11_workflow_holds" (
  "id" UUID NOT NULL,
  "video_id" UUID NOT NULL,
  "workflow_revision_id" UUID NOT NULL,
  "group_id" UUID,
  "hold_type" VARCHAR(40) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'active',
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  CONSTRAINT "v11_workflow_holds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "v11_appeals" (
  "id" UUID NOT NULL,
  "video_id" UUID NOT NULL,
  "workflow_revision_id" UUID NOT NULL,
  "stage" VARCHAR(30) NOT NULL,
  "result_id" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "timestamps" JSONB,
  "status" VARCHAR(20) NOT NULL DEFAULT 'active',
  "submitted_by_id" UUID NOT NULL,
  "rerun_group_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  CONSTRAINT "v11_appeals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "v11_evaluation_groups_parent_group_id_idx" ON "v11_evaluation_groups"("parent_group_id");
CREATE INDEX "v11_workflow_holds_video_id_status_idx" ON "v11_workflow_holds"("video_id", "status");
CREATE INDEX "v11_workflow_holds_workflow_revision_id_idx" ON "v11_workflow_holds"("workflow_revision_id");
CREATE UNIQUE INDEX "v11_workflow_holds_one_active_per_revision" ON "v11_workflow_holds"("workflow_revision_id") WHERE "status" = 'active';
CREATE INDEX "v11_appeals_video_id_status_idx" ON "v11_appeals"("video_id", "status");
CREATE INDEX "v11_appeals_result_id_idx" ON "v11_appeals"("result_id");
CREATE UNIQUE INDEX "v11_appeals_one_active_per_result" ON "v11_appeals"("result_id") WHERE "status" = 'active';

ALTER TABLE "v11_evaluation_groups" ADD CONSTRAINT "v11_evaluation_groups_parent_group_id_fkey" FOREIGN KEY ("parent_group_id") REFERENCES "v11_evaluation_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_workflow_holds" ADD CONSTRAINT "v11_workflow_holds_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_workflow_holds" ADD CONSTRAINT "v11_workflow_holds_workflow_revision_id_fkey" FOREIGN KEY ("workflow_revision_id") REFERENCES "v11_workflow_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_workflow_holds" ADD CONSTRAINT "v11_workflow_holds_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_workflow_holds" ADD CONSTRAINT "v11_workflow_holds_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "v11_evaluation_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_appeals" ADD CONSTRAINT "v11_appeals_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_appeals" ADD CONSTRAINT "v11_appeals_workflow_revision_id_fkey" FOREIGN KEY ("workflow_revision_id") REFERENCES "v11_workflow_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_appeals" ADD CONSTRAINT "v11_appeals_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_appeals" ADD CONSTRAINT "v11_appeals_rerun_group_id_fkey" FOREIGN KEY ("rerun_group_id") REFERENCES "v11_evaluation_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
