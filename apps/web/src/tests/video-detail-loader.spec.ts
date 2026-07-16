import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadVideoDetailRequests } from '../lib/video-detail-loader';

test('video detail remains available when latest content review fails', async () => {
  let detail: { id: string } | undefined;
  let latestUnavailable = false;

  await loadVideoDetailRequests({
    loadDetail: async () => ({ id: 'video-id' }),
    loadLatest: async () => {
      throw new Error('latest unavailable');
    },
    onDetail: (value) => {
      detail = value;
    },
    onLatest: () => undefined,
    onLatestError: () => {
      latestUnavailable = true;
    },
  });

  assert.deepEqual(detail, { id: 'video-id' });
  assert.equal(latestUnavailable, true);
});
