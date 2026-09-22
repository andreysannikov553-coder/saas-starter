import { env } from "@/env.mjs";
import { ClaudeProvider } from "./claude";
import { OpenAIProvider } from "./openai";
import type { LLMProvider } from "./types";

export * from "./types";
export { ClaudeProvider } from "./claude";
export { OpenAIProvider } from "./openai";

/**
 * Picks the LLM provider for a content-engine stage.
 *
 * Andrey chose to run both providers rather than commit to one (2026-09-21),
 * so LLM_PROVIDER selects per-deployment (or per-call, via the `provider`
 * argument — useful for an Experiment that A/B-tests providers on the same
 * stage). Defaults to Claude when unset, since OPENAI_API_KEY was already
 * required by the starter for the pre-existing AI features in src/lib/ai/.
 */
export function getLLMProvider(provider?: "claude" | "openai"): LLMProvider {
  const selected = provider ?? env.LLM_PROVIDER;

  if (selected === "openai") {
    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set but the openai provider was requested");
    }
    return new OpenAIProvider({ apiKey: env.OPENAI_API_KEY });
  }

  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set but the claude provider was requested");
  }
  return new ClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY });
}
