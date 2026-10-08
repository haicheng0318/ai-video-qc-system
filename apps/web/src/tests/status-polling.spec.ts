import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startStatusPolling } from '../lib/status-polling';

function clock() {
  let time = 0;
  let sequence = 0;
  const timers = new Map<number, { task: () => void; delay: number }>();
  return {
    timers,
    now: () => time,
    advance: (ms: number) => { time += ms; },
    schedule: ((task: () => void, delay: number) => {
      timers.set(++sequence, { task, delay });
      return sequence;
    }) as unknown as typeof setTimeout,
    cancel: ((id: number) => { timers.delete(id); }) as unknown as typeof clearTimeout,
    async tick() {
      const next = timers.entries().next().value;
      assert.ok(next);
      timers.delete(next[0]);
      next[1].task();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

for (const status of ['succeeded', 'failed']) {
  test(`polling reports ${status} once and removes all timers`, async () => {
    const timer = clock();
    let calls = 0;
    let terminal = 0;
    const values: string[] = [];
    startStatusPolling({ ...timer,
      load: async () => ++calls === 1 ? 'running' : status,
      isTerminal: (value) => value !== 'running',
      onValue: (value) => values.push(value), onTerminal: () => { terminal++; },
      onPause: () => assert.fail('unexpected pause'),
    });
    await timer.tick();
    await timer.tick();
    assert.deepEqual(values, ['running', status]);
    assert.equal(terminal, 1);
    assert.equal(timer.timers.size, 0);
  });
}

test('network failures pause after the limit without creating a failed business result', async () => {
  const timer = clock();
  let reason = '';
  startStatusPolling({ ...timer, maxErrors: 2,
    load: async () => { throw new Error('offline'); }, isTerminal: () => false,
    onValue: () => assert.fail(), onTerminal: () => assert.fail(), onPause: (value) => { reason = value; },
  });
  await timer.tick();
  await timer.tick();
  assert.equal(reason, 'network');
  assert.equal(timer.timers.size, 0);
});

test('query duration is bounded independently of backend job status', async () => {
  const timer = clock();
  let reason = '';
  startStatusPolling({ ...timer, maxDurationMs: 10,
    load: async () => 'running', isTerminal: () => false,
    onValue: () => undefined, onTerminal: () => assert.fail(), onPause: (value) => { reason = value; },
  });
  timer.advance(11);
  await timer.tick();
  assert.equal(reason, 'timeout');
  assert.equal(timer.timers.size, 0);
});

test('a request deadline aborts a stalled fetch and reaches a visible paused state', async () => {
  const timer = clock();
  let paused = '';
  startStatusPolling({ ...timer, maxErrors: 1,
    load: (signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
    isTerminal: () => false, onValue: () => assert.fail(), onTerminal: () => assert.fail(),
    onPause: (reason) => { paused = reason; },
  });
  await timer.tick();
  await timer.tick();
  assert.equal(paused, 'network');
  assert.equal(timer.timers.size, 0);
});

test('cleanup aborts an in-flight request and ignores a late response', async () => {
  const timer = clock();
  let signal: AbortSignal | undefined;
  let resolve!: (value: string) => void;
  const stop = startStatusPolling({ ...timer,
    load: (value) => { signal = value; return new Promise<string>((done) => { resolve = done; }); },
    isTerminal: () => true, onValue: () => assert.fail('late response'),
    onTerminal: () => assert.fail('late terminal'), onPause: () => assert.fail('late pause'),
  });
  await timer.tick();
  stop();
  resolve('succeeded');
  await new Promise((done) => setImmediate(done));
  assert.equal(signal?.aborted, true);
  assert.equal(timer.timers.size, 0);
});

test('visibility changes do not overlap pending requests and detach on cleanup', async () => {
  const timer = clock();
  let listener: (() => void) | undefined;
  let calls = 0;
  let resolve!: (value: string) => void;
  const visibility = {
    hidden: true,
    addEventListener: (_: string, fn: () => void) => { listener = fn; },
    removeEventListener: () => { listener = undefined; },
  } as unknown as Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
  const stop = startStatusPolling({ ...timer, visibility,
    load: () => { calls++; return new Promise<string>((done) => { resolve = done; }); },
    isTerminal: () => false, onValue: () => undefined, onTerminal: () => undefined, onPause: () => undefined,
  });
  await timer.tick();
  Object.assign(visibility, { hidden: false });
  listener?.();
  listener?.();
  assert.equal(calls, 1);
  resolve('running');
  await new Promise((done) => setImmediate(done));
  assert.equal(timer.timers.size, 1);
  stop();
  assert.equal(listener, undefined);
});
