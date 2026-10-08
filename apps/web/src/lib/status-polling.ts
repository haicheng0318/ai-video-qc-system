export type PollingPauseReason = 'network' | 'timeout';

/** Read-only, non-overlapping polling. A paused connection is not a failed job. */
export function startStatusPolling<T>(options: {
  load: (signal: AbortSignal) => Promise<T>;
  isTerminal: (value: T) => boolean;
  onValue: (value: T) => void;
  onTerminal: (value: T) => void;
  onPause: (reason: PollingPauseReason) => void;
  onError?: () => void;
  intervalMs?: number;
  maxDurationMs?: number;
  requestTimeoutMs?: number;
  maxErrors?: number;
  now?: () => number;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
  visibility?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
}) {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  const visibility = options.visibility ?? (typeof document === 'undefined' ? undefined : document);
  const started = now();
  let stopped = false;
  let inFlight = false;
  let errors = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  let requestTimer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    stopped = true;
    if (timer !== undefined) cancel(timer);
    if (requestTimer !== undefined) cancel(requestTimer);
    request?.abort();
    visibility?.removeEventListener('visibilitychange', onVisibility);
  };
  const tick = async () => {
    if (stopped || inFlight) return;
    if (now() - started >= (options.maxDurationMs ?? 20 * 60_000)) {
      stop();
      options.onPause('timeout');
      return;
    }
    inFlight = true;
    const controller = new AbortController();
    request = controller;
    requestTimer = schedule(() => controller.abort(), options.requestTimeoutMs ?? 15_000);
    let value: T;
    try {
      value = await options.load(controller.signal);
    } catch {
      if (!stopped) {
        errors += 1;
        options.onError?.();
        if (errors >= (options.maxErrors ?? 5)) {
          stop();
          options.onPause('network');
        }
      }
      return;
    } finally {
      if (requestTimer !== undefined) cancel(requestTimer);
      requestTimer = undefined;
      inFlight = false;
      if (!stopped) {
        timer = schedule(() => { void tick(); }, visibility?.hidden ? 30_000 : (options.intervalMs ?? 3000));
      }
    }
    if (stopped) return;
    errors = 0;
    options.onValue(value);
    if (options.isTerminal(value)) {
      stop();
      options.onTerminal(value);
    }
  };
  function onVisibility() {
    if (stopped || visibility?.hidden) return;
    if (timer !== undefined) cancel(timer);
    void tick();
  }
  visibility?.addEventListener('visibilitychange', onVisibility);
  timer = schedule(() => { void tick(); }, 0);
  return stop;
}
