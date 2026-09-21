"use server";

import { requireUserId } from "@/lib/auth";
import { handleServerAction } from "@/lib/utils/error";
import { generateCompletion, type CompletionResult } from "@/lib/ai/client";
import { assertWithinLimit, trackUsage, saveGeneratedContent } from "@/lib/ai/utils";
import { getEntitlements } from "@/lib/billing/entitlements";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  SYSTEM_PROMPTS,
  codeGenerationPrompt,
  summarizationPrompt,
  translationPrompt,
} from "@/lib/ai/prompts";
import {
  generateContentSchema,
  generateCodeSchema,
  summarizeSchema,
  translateSchema,
} from "@/lib/validation/ai";

/**
 * Record what a completion actually cost and hand back its text.
 *
 * Every AI action funnels through here so that no entry point can skip
 * metering — which is how `summarizeContent` and `translateText` ended up
 * unmetered.
 */
async function recordCompletion(
  userId: string,
  result: CompletionResult,
  description: string
): Promise<number> {
  await trackUsage(userId, result.totalTokens, description, {
    model: result.model,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
  });
  return result.totalTokens;
}

/**
 * Generate content using AI
 */
export async function generateContent(formData: FormData) {
  return handleServerAction(async () => {
    const userId = await requireUserId();

    const maxTokensRaw = formData.get("maxTokens");
    const temperatureRaw = formData.get("temperature");

    const validatedData = generateContentSchema.parse({
      prompt: formData.get("prompt"),
      model: formData.get("model") || undefined,
      maxTokens: maxTokensRaw ? Number(maxTokensRaw) : undefined,
      temperature: temperatureRaw ? Number(temperatureRaw) : undefined,
    });

    await checkRateLimit("ai", userId, { limit: 20, windowSeconds: 60 });
    await assertWithinLimit(userId, (await getEntitlements(userId)).aiTokenLimit);

    const result = await generateCompletion(validatedData.prompt, {
      model: validatedData.model,
      maxTokens: validatedData.maxTokens,
      temperature: validatedData.temperature,
      systemPrompt: SYSTEM_PROMPTS.contentGeneration,
    });

    const tokens = await recordCompletion(userId, result, "Content generation");
    await saveGeneratedContent(userId, validatedData.prompt, result.content, result.model, tokens);

    return { content: result.content, tokens };
  });
}

/**
 * Generate code using AI
 */
export async function generateCode(task: string, language: string, context?: string) {
  return handleServerAction(async () => {
    const userId = await requireUserId();
    const validatedData = generateCodeSchema.parse({ task, language, context });

    await checkRateLimit("ai", userId, { limit: 20, windowSeconds: 60 });
    await assertWithinLimit(userId, (await getEntitlements(userId)).aiTokenLimit);

    const prompt = codeGenerationPrompt(
      validatedData.task,
      validatedData.language,
      validatedData.context
    );

    const result = await generateCompletion(prompt, {
      model: validatedData.model,
      systemPrompt: SYSTEM_PROMPTS.codeGeneration,
    });

    const tokens = await recordCompletion(userId, result, "Code generation");
    await saveGeneratedContent(userId, prompt, result.content, result.model, tokens);

    return { code: result.content, tokens };
  });
}

/**
 * Summarize content using AI
 */
export async function summarizeContent(content: string, maxLength?: number) {
  return handleServerAction(async () => {
    const userId = await requireUserId();
    const validatedData = summarizeSchema.parse({ content, maxLength });

    await checkRateLimit("ai", userId, { limit: 20, windowSeconds: 60 });
    await assertWithinLimit(userId, (await getEntitlements(userId)).aiTokenLimit);

    const prompt = summarizationPrompt(validatedData.content, validatedData.maxLength);

    const result = await generateCompletion(prompt, {
      model: validatedData.model,
      systemPrompt: SYSTEM_PROMPTS.summarization,
      maxTokens: validatedData.maxLength ? validatedData.maxLength * 2 : 500,
    });

    const tokens = await recordCompletion(userId, result, "Summarization");

    return { summary: result.content, tokens };
  });
}

/**
 * Translate text using AI
 */
export async function translateText(text: string, targetLanguage: string) {
  return handleServerAction(async () => {
    const userId = await requireUserId();
    const validatedData = translateSchema.parse({ text, targetLanguage });

    await checkRateLimit("ai", userId, { limit: 20, windowSeconds: 60 });
    await assertWithinLimit(userId, (await getEntitlements(userId)).aiTokenLimit);

    const prompt = translationPrompt(validatedData.text, validatedData.targetLanguage);

    const result = await generateCompletion(prompt, {
      model: validatedData.model,
      systemPrompt: SYSTEM_PROMPTS.translation,
    });

    const tokens = await recordCompletion(userId, result, "Translation");

    return { translation: result.content, tokens };
  });
}
