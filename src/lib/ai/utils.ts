import { prisma } from "@/lib/db";
import { RateLimitError } from "@/lib/utils/error";

/**
 * Start of the current usage period, in UTC.
 *
 * One definition for the whole app: this used to be computed in three places
 * in the server's local timezone, so the reported usage, the limit check and
 * the dashboard could each disagree about which month a call belonged to.
 */
export function currentPeriodStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Track AI usage for a user
 */
export async function trackUsage(
  userId: string,
  tokens: number,
  description?: string,
  metadata?: { model?: string; promptTokens?: number; completionTokens?: number }
): Promise<void> {
  await prisma.usage.create({
    data: {
      userId,
      type: "AI_GENERATION",
      amount: tokens,
      description,
      metadata: metadata ?? undefined,
    },
  });
}

/**
 * Get user's AI usage for the current period
 */
export async function getMonthlyUsage(userId: string): Promise<number> {
  const usage = await prisma.usage.aggregate({
    where: {
      userId,
      type: "AI_GENERATION",
      createdAt: { gte: currentPeriodStart() },
    },
    _sum: { amount: true },
  });

  return usage._sum.amount || 0;
}

/**
 * Check if user has exceeded their monthly limit.
 * A negative limit means unlimited.
 */
export async function hasExceededLimit(userId: string, limit: number): Promise<boolean> {
  if (limit < 0) return false;
  const usage = await getMonthlyUsage(userId);
  return usage >= limit;
}

/**
 * Refuse the call when the user is out of allowance.
 *
 * Every AI entry point goes through this. Two of them previously skipped the
 * check entirely, which made them an unmetered way to spend money at the
 * provider.
 */
export async function assertWithinLimit(userId: string, limit: number): Promise<void> {
  if (await hasExceededLimit(userId, limit)) {
    throw new RateLimitError(
      "Исчерпан месячный лимит. Перейдите на платный тариф, чтобы продолжить."
    );
  }
}

/**
 * Save generated content to database
 */
export async function saveGeneratedContent(
  userId: string,
  prompt: string,
  content: string,
  model: string,
  tokens: number
): Promise<void> {
  await prisma.generatedContent.create({
    data: { userId, prompt, content, model, tokens },
  });
}
