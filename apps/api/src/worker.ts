import 'reflect-metadata';
import './env';
import { NestFactory } from '@nestjs/core';
import { EvaluationWorkerModule } from './modules/evaluation-jobs/evaluation-worker.module';
import { EvaluationWorker } from './modules/evaluation-jobs/evaluation-worker';
import { configureOutboundProxy } from './outbound-proxy';

async function bootstrap() {
  configureOutboundProxy();
  const app = await NestFactory.createApplicationContext(EvaluationWorkerModule);
  const worker = app.get(EvaluationWorker);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    while (!stopping) {
      try {
        const worked = await worker.runOnce();
        if (!worked && !stopping) await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch {
        console.error('Evaluation queue unavailable; worker will retry.');
        if (!stopping) await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  } finally {
    await app.close();
  }
}

void bootstrap().catch(() => { console.error('Evaluation worker failed to start.'); process.exitCode = 1; });
