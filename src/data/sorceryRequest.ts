/** All SorceryTCG traffic uses this queue. See docs/sorcery-request-policy.md. */
export const SORCERY_MIN_INTERVAL_MS = 3000;
export const SORCERY_LOW_REMAINING = 2;
export const SORCERY_SAFE_REMAINING = 5;
export const SORCERY_ERROR_COOLDOWN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

export interface SorceryRateState {
  nextAllowedAtMs: number;
  blockedUntilMs: number;
  reason: string;
}

export interface SorceryDelay {
  delayMs: number;
  reason: string;
  source: "client" | "server";
}

export interface SorceryRequestOptions {
  signal?: AbortSignal;
  /** Proxies leave the one permitted retry to their caller. */
  retry?: boolean;
  onDelay?: (delay: SorceryDelay) => void;
  onWait?: (wait: SorceryDelay & { remainingMs: number; deckId: string | null; requestKind: string | null }) => void;
  onHealth?: (health: {
    type: "response"; deckId: string | null; requestKind: string | null;
    status: number; ok: boolean; rateLimitLimit: number | null;
    rateLimitRemaining: number | null; rateLimitResetMs: number | null;
    retryAfterMs: number | null; proxyDelayMs: number | null; proxyDelayReason: string;
  }) => void;
  deckId?: string;
  requestKind?: string;
}

export type WithSorceryRateState = <T>(
  work: (state: SorceryRateState, persist: () => Promise<void>) => Promise<T>,
  signal?: AbortSignal,
) => Promise<T>;

export function emptySorceryRateState(): SorceryRateState {
  return { nextAllowedAtMs: 0, blockedUntilMs: 0, reason: "local-spacing" };
}

export function sorcerySleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Request cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function numeric(value: string | null): number | null {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function retryDelay(value: string | null, now: number): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds >= 0 && Number.isFinite(seconds * 1000) ? seconds * 1000 : null;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

interface SorceryClientOptions {
  /** Inject only for offline tests; live callers use the shared singleton. */
  fetchImpl?: typeof fetch;
  nowImpl?: () => number;
  sleepImpl?: typeof sorcerySleep;
  withRateState?: WithSorceryRateState;
}

export function createSorceryClient(options: SorceryClientOptions = {}) {
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = options.nowImpl ?? (() => Date.now());
  const sleep = options.sleepImpl ?? sorcerySleep;
  const memoryState = emptySorceryRateState();
  const withState: WithSorceryRateState = options.withRateState
    ?? ((work) => work(memoryState, async () => undefined));
  let queue: Promise<unknown> = Promise.resolve();

  async function wait(state: SorceryRateState, request: SorceryRequestOptions) {
    const until = Math.max(state.nextAllowedAtMs, state.blockedUntilMs);
    const reason = state.blockedUntilMs > state.nextAllowedAtMs ? state.reason : "local-spacing";
    const delayMs = Math.max(0, until - now());
    if (delayMs > 0) request.onDelay?.({ delayMs, reason, source: "client" });
    while (now() < until) {
      request.signal?.throwIfAborted();
      const remainingMs = until - now();
      request.onWait?.({ delayMs, remainingMs, reason, source: "client",
        deckId: request.deckId ?? null, requestKind: request.requestKind ?? null });
      // Short ticks support progress, cancellation and very long Retry-After dates.
      await sleep(Math.min(1000, remainingMs), request.signal);
    }
    if (delayMs > 0) request.onWait?.({ delayMs, remainingMs: 0, reason, source: "client",
      deckId: request.deckId ?? null, requestKind: request.requestKind ?? null });
  }

  function recordResponse(response: Response, state: SorceryRateState, request: SorceryRequestOptions) {
    const time = now();
    const remaining = numeric(response.headers.get("x-ratelimit-remaining"));
    const reset = numeric(response.headers.get("x-ratelimit-reset"));
    const resetMs = reset === null ? null : reset > 1_000_000_000 ? reset * 1000 : time + reset * 1000;
    const retryAfterMs = retryDelay(response.headers.get("retry-after"), time);
    const block = (until: number, reason: string) => {
      if (until > state.blockedUntilMs) { state.blockedUntilMs = until; state.reason = reason; }
    };
    if (retryAfterMs !== null) block(time + retryAfterMs, "retry-after");
    if (remaining !== null && remaining <= SORCERY_LOW_REMAINING) {
      block(resetMs !== null && resetMs > time ? resetMs
        : time + (SORCERY_SAFE_REMAINING - remaining) * SORCERY_MIN_INTERVAL_MS, "rate-limit-low");
    }
    if ((response.status === 429 || response.status === 503) && retryAfterMs === null) {
      block(time + SORCERY_ERROR_COOLDOWN_MS, "upstream-unavailable");
    }
    const proxyDelayMs = numeric(response.headers.get("x-sorcery-proxy-delay-ms"));
    const proxyDelayReason = response.headers.get("x-sorcery-proxy-delay-reason") ?? "proxy-throttle";
    if (proxyDelayMs !== null) request.onDelay?.({ delayMs: proxyDelayMs, reason: proxyDelayReason, source: "server" });
    request.onHealth?.({ type: "response", deckId: request.deckId ?? null,
      requestKind: request.requestKind ?? null, status: response.status, ok: response.ok,
      rateLimitLimit: numeric(response.headers.get("x-ratelimit-limit")), rateLimitRemaining: remaining,
      rateLimitResetMs: resetMs, retryAfterMs, proxyDelayMs, proxyDelayReason });
    return retryAfterMs;
  }

  async function perform(url: string, init: RequestInit, request: SorceryRequestOptions): Promise<Response> {
    return withState(async (state, persist) => {
      for (let attempt = 0; ; attempt++) {
        await wait(state, request);
        request.signal?.throwIfAborted();
        const controller = new AbortController();
        const abort = () => controller.abort(request.signal?.reason);
        request.signal?.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(() => controller.abort(new DOMException("SorceryTCG request timed out", "TimeoutError")), REQUEST_TIMEOUT_MS);
        let response: Response;
        let retryAfterMs: number | null;
        try {
          // Reserve the full attempt before sending, so a killed maintenance
          // process cannot leave the next process free to send immediately.
          state.nextAllowedAtMs = now() + REQUEST_TIMEOUT_MS + SORCERY_MIN_INTERVAL_MS;
          await persist();
          request.signal?.throwIfAborted();
          response = await fetchImpl(url, { ...init, redirect: "error", signal: controller.signal });
          retryAfterMs = recordResponse(response, state, request);
          await persist();
          // Keep the queue/host lock until the entire body has arrived.
          const body = await response.arrayBuffer();
          response = new Response([204, 205, 304].includes(response.status) ? null : body, {
            status: response.status, statusText: response.statusText, headers: response.headers,
          });
        } finally {
          clearTimeout(timeout);
          request.signal?.removeEventListener("abort", abort);
          state.nextAllowedAtMs = now() + SORCERY_MIN_INTERVAL_MS;
          await persist();
        }
        // No network-error retries, speculative fallbacks or nested proxy retries.
        if (attempt > 0 || request.retry === false || retryAfterMs === null
          || (response.status !== 429 && response.status !== 503)) return response;
      }
    }, request.signal);
  }

  return {
    fetch(url: string, init: RequestInit = {}, request: SorceryRequestOptions = {}): Promise<Response> {
      const effectiveRequest = { ...request, signal: request.signal ?? init.signal ?? undefined };
      const signal = effectiveRequest.signal;
      if (signal?.aborted) return Promise.reject(signal.reason);
      return new Promise<Response>((resolve, reject) => {
        // Cancel queued callers immediately, but let an active attempt finish
        // releasing its host lock before its caller observes cancellation.
        const abortQueued = () => reject(signal?.reason);
        signal?.addEventListener("abort", abortQueued, { once: true });
        const result = queue.then(() => {
          signal?.removeEventListener("abort", abortQueued);
          signal?.throwIfAborted();
          return perform(url, init, effectiveRequest);
        });
        queue = result.catch(() => undefined);
        void result.then(resolve, reject);
      });
    },
  };
}

/** Cards, deck imports and searches share a single browser queue. */
export const sorceryClient = createSorceryClient();
