CREATE TABLE "v11_workflow_gate_decisions" (
  "id" UUID NOT NULL,
  "video_id" UUID NOT NULL,
  "workflow_revision_id" UUID NOT NULL,
  "stage" VARCHAR(30) NOT NULL,
  "decision" VARCHAR(50) NOT NULL,
  "decision_source" VARCHAR(20) NOT NULL,
  "actor_id" UUID,
  "reason" VARCHAR(500) NOT NULL,
  "performance_eligible" BOOLEAN NOT NULL DEFAULT false,
  "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "v11_workflow_gate_decisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "v11_workflow_gate_decisions_workflow_revision_id_stage_key" ON "v11_workflow_gate_decisions"("workflow_revision_id", "stage");
CREATE INDEX "v11_workflow_gate_decisions_video_id_decided_at_idx" ON "v11_workflow_gate_decisions"("video_id", "decided_at");
ALTER TABLE "v11_workflow_gate_decisions" ADD CONSTRAINT "v11_workflow_gate_decisions_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_workflow_gate_decisions" ADD CONSTRAINT "v11_workflow_gate_decisions_workflow_revision_id_fkey" FOREIGN KEY ("workflow_revision_id") REFERENCES "v11_workflow_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v11_workflow_gate_decisions" ADD CONSTRAINT "v11_workflow_gate_decisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
