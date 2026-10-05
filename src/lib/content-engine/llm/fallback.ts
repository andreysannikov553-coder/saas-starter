import type { LLMProvider, StructuredRequest } from "./types";

/**
 * Tries each provider in order, falling through to the next on ANY failure —
 * not just a detected rate-limit, since a transient outage or an
 * auth/quota error should fail over the same way a 429 does. Built after
 * hitting Groq's free-tier daily cap mid-run (2026-09-24): a single-provider
 * setup means the whole pipeline stops for the rest of the day the moment
 * one free tier is exhausted, even though several other free tiers sit idle.
 *
 * Deliberately does not try to distinguish "worth retrying elsewhere" from
 * "this request itself is broken" — a genuinely malformed request will fail
 * the same way on every provider in the chain, so the caller still sees a
 * real error (the last provider's), just after trying every alternative
 * first instead of giving up on the first one.
 */
export class FallbackLLMProvider implements LLMProvider {
  readonly id: string;

  constructor(private readonly providers: LLMProvider[]) {
    if (providers.length === 0) {
      throw new Error("FallbackLLMProvider needs at least one provider");
    }
    this.id = `fallback(${providers.map((p) => p.id).join(",")})`;
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
    const errors: { providerId: string; message: string }[] = [];

    for (const provider of this.providers) {
      try {
        return await provider.generateStructured(request);
      } catch (error) {
        errors.push({
          providerId: provider.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    throw new Error(
      `All ${this.providers.length} LLM providers failed: ` +
        errors.map((e) => `${e.providerId}: ${e.message}`).join(" | ")
    );
  }
}
