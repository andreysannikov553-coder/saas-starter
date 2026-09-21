import { prisma } from "@/lib/db";
import { RateLimitError } from "@/lib/utils/error";
import { headers } from "next/headers";

/**
 * Fixed-window rate limiting backed by Postgres.
 *
 * A database row rather than an in-memory counter, because this runs in
 * serverless functions with no shared memory between invocations — an
 * in-process counter would reset on every cold start and never actually
 * limit anything. The row is upserted and incremented in one statement, so
 * concurrent requests racing the same window still count correctly.
 */
export async function checkRateLimit(
  scope: string,
  identifier: string,
  options: { limit: number; windowSeconds: number }
): Promise<void> {
  const key = `${scope}:${identifier}`;
  const now = new Date();
  const windowExpiresAt = new Date(now.getTime() + options.windowSeconds * 1000);

  // Postgres upsert: increment an unexpired window, or start a fresh one.
  // Prisma has no native "upsert with conditional increment", so this one
  // goes through $queryRaw — it is the one place in the app that does.
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "rate_limit_hits" ("key", "count", "expires_at")
    VALUES (${key}, 1, ${windowExpiresAt})
    ON CONFLICT ("key") DO UPDATE
    SET
      "count" = CASE
        WHEN "rate_limit_hits"."expires_at" <= ${now} THEN 1
        ELSE "rate_limit_hits"."count" + 1
      END,
      "expires_at" = CASE
        WHEN "rate_limit_hits"."expires_at" <= ${now} THEN ${windowExpiresAt}
        ELSE "rate_limit_hits"."expires_at"
      END
    RETURNING "count"
  `;

  const count = rows[0]?.count ?? 1;

  if (count > options.limit) {
    throw new RateLimitError("Слишком много попыток. Подождите немного и попробуйте снова.");
  }
}

/**
 * Best-effort caller identity for unauthenticated flows (sign-in, sign-up,
 * password reset). `x-forwarded-for` is set by the platform's edge/proxy
 * layer (Vercel included); trusting it here — rather than a raw socket
 * address, which serverless functions do not expose anyway — is standard for
 * a rate limiter, whose job is slowing down abuse, not authenticating it.
 */
export async function requestIp(): Promise<string> {
  const headersList = await headers();
  const forwardedFor = headersList.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

/** Drop expired windows. Call periodically (e.g. from a cron route); the
 * table works correctly without this, it just grows. */
export async function cleanupRateLimits(): Promise<number> {
  const result = await prisma.rateLimitHit.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return result.count;
}
