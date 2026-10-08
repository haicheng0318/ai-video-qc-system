import { Injectable, Logger, Optional } from '@nestjs/common';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ContentReviewService } from '../ai/gemini/gemini.service';
import { ResultReviewsService } from '../result-reviews/result-reviews.service';
import { FinalEvaluationsService } from '../final-evaluations/final-evaluations.service';
import { EvaluationJobsService } from './evaluation-jobs.service';
import { UploadTicketMaintenance } from '../quotas/upload-ticket-maintenance';

@Injectable()
export class EvaluationWorker {
  private readonly logger = new Logger(EvaluationWorker.name);
  private readonly workerId = `${hostname().slice(0, 80)}:${process.pid}:${randomUUID()}`;
  private lastUploadSweep = 0;
  constructor(private readonly jobs: EvaluationJobsService,
    private readonly content: ContentReviewService,
    private readonly result: ResultReviewsService,
    private readonly final: FinalEvaluationsService,
    @Optional() private readonly uploadTickets?: UploadTicketMaintenance) {}

  async runOnce() {
    let publishing = false;
    const publish = async () => {
      if (publishing) return;
      publishing = true;
      try { await this.jobs.recordWorkerHeartbeat?.(this.workerId); }
      catch { this.logger.warn('Worker process heartbeat unavailable.'); }
      finally { publishing = false; }
    };
    const processHeartbeat = setInterval(() => { void publish(); }, 15000);
    try { return await this.executeOnce(); }
    finally { clearInterval(processHeartbeat); }
  }

  private async executeOnce() {
    await this.jobs.recordWorkerHeartbeat?.(this.workerId);
    if (this.uploadTickets && Date.now() - this.lastUploadSweep >= 60000) {
      await this.uploadTickets.sweep(); this.lastUploadSweep = Date.now();
    }
    await this.jobs.recoverExpired();
    await this.jobs.recoverOrphans();
    const lease = await this.jobs.claim(this.workerId);
    if (!lease) return false;
    // Never overlap renewals; the database rejects late renewals and stale result writes.
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void this.jobs.heartbeat(lease).catch(() => {
        this.logger.warn('Worker heartbeat unavailable; database fencing remains authoritative.');
      }).finally(() => { renewing = false; });
    }, 5000);
    try {
      await this.jobs.runWithLease(lease, async () => {
        if (lease.job.stage === 'content') await this.content.executeJob(lease.job);
        else if (lease.job.stage === 'result') await this.result.executeJob(lease.job);
        else if (lease.job.stage === 'final') await this.final.executeJob(lease.job);
        else throw new Error('Unsupported evaluation stage.');
      });
      // No-op for a terminal job; recovers missing/changed input if a stage returned early.
      await this.jobs.releaseAfterExecutionError(lease);
    } catch {
      this.logger.warn(`Evaluation execution interrupted: ${lease.job.id}.`);
      await this.jobs.releaseAfterExecutionError(lease);
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
}
