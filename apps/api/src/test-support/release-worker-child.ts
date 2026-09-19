import { PrismaClient } from '@prisma/client';
import { configureLocalAcceptance } from './local-acceptance';

async function main() {
  configureLocalAcceptance(process.env.RELEASE_TEST_DATABASE_URL);
  const modulePath = '../../dist/modules/evaluation-jobs/evaluation-jobs.service';
  const { EvaluationJobsService } = await import(modulePath);
  const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  const jobs = new EvaluationJobsService(db, {});
  const stage = process.argv[2];
  if (stage === 'recover') {
    await jobs.recoverExpired();
    await db.$disconnect();
    return;
  }
  if (!['before_external', 'after_external'].includes(stage)) throw Error('Only local fault-fixture stages are allowed.');
  const lease = await jobs.claim('task5-child-fixture');
  if (!lease) throw Error('No fixture task available.');
  if (stage === 'after_external') await jobs.runWithLease(lease, () => jobs.markExternalStarted());
  process.stdout.write(`${JSON.stringify({ ready: true, jobId: lease.job.id })}\n`);
  // Parent deliberately kills this isolated child to exercise durable recovery.
  setInterval(() => undefined, 1000);
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
