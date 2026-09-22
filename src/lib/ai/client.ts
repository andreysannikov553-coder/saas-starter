import OpenAI from "openai";
import { env } from "@/env.mjs";
import { DEFAULT_MODEL, type AllowedModel } from "@/lib/ai/models";

/** Fail fast rather than holding a server action open to the platform limit. */
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

export const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  timeout: REQUEST_TIMEOUT_MS,
  maxRetries: MAX_RETRIES,
});

export const DEFAULT_MAX_TOKENS = 2000;
export const DEFAULT_TEMPERATURE = 0.7;

export interface CompletionOptions {
  model?: AllowedModel;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface CompletionResult {
  content: string;
  model: string;
  /** Actual usage as reported by the provider, not an estimate. */
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Generate a text completion.
 *
 * Returns the provider's own token counts alongside the text. Billing used to
 * be derived from `text.length / 4`, which undercounts Cyrillic by roughly
 * half — the wrong direction for a usage limit to be wrong in.
 */
export async function generateCompletion(
  prompt: string,
  options?: CompletionOptions
): Promise<CompletionResult> {
  const model = options?.model ?? DEFAULT_MODEL;

  const response = await openai.chat.completions.create({
    model,
    messages: [
      ...(options?.systemPrompt
        ? [{ role: "system" as const, content: options.systemPrompt }]
        : []),
      { role: "user" as const, content: prompt },
    ],
    max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
  });

  const usage = response.usage;

  return {
    content: response.choices[0]?.message?.content ?? "",
    model: response.model ?? model,
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}
