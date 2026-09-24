import { env } from "@/env.mjs";
import { ClaudeProvider } from "./claude";
import { OpenAIProvider } from "./openai";
import { FallbackLLMProvider } from "./fallback";
import type { LLMProvider } from "./types";

export * from "./types";
export { ClaudeProvider } from "./claude";
export { OpenAIProvider } from "./openai";
export { FallbackLLMProvider } from "./fallback";

/**
 * Free OpenAI-compatible providers tried in this order when LLM_PROVIDER is
 * "fallback" (the default) — cheapest/most-generous-free-tier first, all the
 * way down to Claude (real money) as the last resort. Each is only included
 * if its API key env var is actually set, so adding a new one is just
 * signing up and setting the key — no code change needed to start using it.
 *
 * Model ids are current as of 2026-09-24 and drift as providers retire
 * models; override per-provider with the matching *_MODEL env var (same
 * pattern as OPENAI_MODEL) rather than editing this list.
 */
const FREE_PROVIDER_REGISTRY: {
  name: string;
  apiKey: string | undefined;
  baseURL: string;
  defaultModel: string;
  modelOverride: string | undefined;
}[] = [
  {
    name: "groq",
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL ?? "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-120b",
    modelOverride: env.OPENAI_MODEL,
  },
  {
    name: "cerebras",
    apiKey: env.CEREBRAS_API_KEY,
    baseURL: "https://api.cerebras.ai/v1",
    defaultModel: "llama-3.3-70b",
    modelOverride: env.CEREBRAS_MODEL,
  },
  {
    name: "gemini",
    apiKey: env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    // gemini-2.0-flash was retired; verified against a live call (2026-09-24).
    defaultModel: "gemini-3.6-flash",
    modelOverride: env.GEMINI_MODEL,
  },
  {
    name: "openrouter",
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    // OpenRouter's free catalog churns fast — verified against the live
    // /models list (2026-09-24) for structured_outputs support, not assumed.
    defaultModel: "nvidia/nemotron-3-super-120b-a12b:free",
    modelOverride: env.OPENROUTER_MODEL,
  },
  {
    name: "mistral",
    apiKey: env.MISTRAL_API_KEY,
    baseURL: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    modelOverride: env.MISTRAL_MODEL,
  },
  {
    // Free with any GitHub account — a Personal Access Token with "Models"
    // read permission, no separate signup. Proxies several vendors' models
    // (OpenAI, Meta, Mistral, ...) through one GitHub-hosted endpoint.
    name: "github",
    apiKey: env.GITHUB_MODELS_TOKEN,
    baseURL: "https://models.github.ai/inference",
    defaultModel: "openai/gpt-4o-mini",
    modelOverride: env.GITHUB_MODELS_MODEL,
  },
  {
    // Cloudflare Workers AI free daily allowance — needs both the account id
    // (in the URL) and an API token, unlike the single-key providers above.
    name: "cloudflare",
    apiKey: env.CLOUDFLARE_API_TOKEN,
    baseURL: env.CLOUDFLARE_ACCOUNT_ID
      ? `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`
      : "",
    defaultModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    modelOverride: env.CLOUDFLARE_MODEL,
  },
];

/**
 * Picks the LLM provider for a content-engine stage.
 *
 * Andrey chose to run both Claude and OpenAI-shaped providers rather than
 * commit to one (2026-09-21), so LLM_PROVIDER selects per-deployment (or
 * per-call, via the `provider` argument — useful for an Experiment that
 * A/B-tests providers on the same stage).
 *
 * "fallback" (the default) chains every configured free provider plus Claude
 * last — built 2026-09-24 after Groq's free-tier daily cap stopped the
 * pipeline mid-run with several other free tiers sitting unused. A pinned
 * "claude"/"openai" selection (explicit env var or per-call argument) skips
 * the chain and uses exactly that one provider, same as before — useful for
 * reproducing an issue against a specific provider.
 */
export function getLLMProvider(provider?: "claude" | "openai" | "fallback"): LLMProvider {
  const selected = provider ?? env.LLM_PROVIDER;

  if (selected === "openai") {
    return buildOpenAIProvider(env.OPENAI_API_KEY, env.OPENAI_BASE_URL, env.OPENAI_MODEL, "openai");
  }

  if (selected === "claude") {
    return buildClaudeProvider();
  }

  // "fallback": chain every free provider with a configured key (and, for
  // Cloudflare, an account id — its baseURL is empty without one), then Claude.
  const chain: LLMProvider[] = FREE_PROVIDER_REGISTRY.filter(
    (cfg) => cfg.apiKey && cfg.baseURL
  ).map((cfg) =>
    buildOpenAIProvider(cfg.apiKey, cfg.baseURL, cfg.modelOverride ?? cfg.defaultModel, cfg.name)
  );
  if (env.ANTHROPIC_API_KEY) {
    chain.push(buildClaudeProvider());
  }

  if (chain.length === 0) {
    throw new Error(
      "No LLM provider is configured — set at least one of OPENAI_API_KEY, CEREBRAS_API_KEY, " +
        "GEMINI_API_KEY, OPENROUTER_API_KEY, MISTRAL_API_KEY, or ANTHROPIC_API_KEY"
    );
  }
  if (chain.length === 1) {
    return chain[0];
  }
  return new FallbackLLMProvider(chain);
}

function buildOpenAIProvider(
  apiKey: string | undefined,
  baseURL: string | undefined,
  model: string | undefined,
  label: string
): OpenAIProvider {
  if (!apiKey) {
    throw new Error(`API key for provider "${label}" is not set`);
  }
  return new OpenAIProvider({ apiKey, baseURL, model });
}

function buildClaudeProvider(): ClaudeProvider {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set but the claude provider was requested");
  }
  return new ClaudeProvider({
    apiKey: env.ANTHROPIC_API_KEY,
    workspaceId: env.ANTHROPIC_WORKSPACE_ID,
  });
}
