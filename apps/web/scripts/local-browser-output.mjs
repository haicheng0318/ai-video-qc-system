import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function browserOutput(stage, run = process.env.QC_BROWSER_RUN_ID || Date.now().toString(36)) {
  if (!['workflow', 'operations', 'release'].includes(stage) || !/^[a-z0-9]+$/.test(run)) throw Error('Invalid local browser evidence scope.');
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  return resolve(root, '.superpowers/sdd/2026-09-07-v101-continuous/task5-browser', run, stage);
}
