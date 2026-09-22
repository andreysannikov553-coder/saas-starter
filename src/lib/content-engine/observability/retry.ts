/**
 * Generic retry-with-backoff for the pipeline's external HTTP calls (Europe
 * PMC, ElevenLabs, Telegram, Supabase Storage) — found missing entirely in
 * the pre-production audit (PRODUCTION_READINESS.md §8). The Anthropic and
 * OpenAI SDKs already retry transient failures on their own, so this is only
 * wired into the calls that go through bare `fetch`/the Supabase client.
 */

/**
 * Throw this instead of a plain Error inside a `withRetry`'d function to
 * signal "this failure is not transient, don't retry" (e.g. a 4xx from an
 * external API) — `shouldRetry` callers can check `instanceof` for it
 * without hand-rolling the same status-code check at every call site.
 */
export class NonRetryableError extends Error {}

export interface RetryOptions {
  /** Total attempts including the first. Default 3. */
  attempts?: number;
  /** Base delay before the first retry, doubled each subsequent attempt. Default 500ms. */
  baseDelayMs?: number;
  /** Return false to stop retrying and rethrow immediately. Default: always retry. */
  shouldRetry?: (error: unknown) => boolean;
  /** Injectable for tests — real callers never need to pass this. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn`, retrying on failure with exponential backoff. Rethrows the last
 * error once attempts are exhausted or `shouldRetry` says to stop.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const shouldRetry = options.shouldRetry ?? (() => true);
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === attempts || !shouldRetry(error)) {
        throw error;
      }
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  // Unreachable — the loop always returns or throws — but keeps tsc happy.
  throw new Error("withRetry: exhausted attempts without a result");
}
