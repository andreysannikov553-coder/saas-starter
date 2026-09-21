"use server";

import { requireUserId } from "@/lib/auth";
import { handleServerAction } from "@/lib/utils/error";
import { prisma } from "@/lib/db";
import { getMonthlyUsage, currentPeriodStart } from "@/lib/ai/utils";
import { getEntitlements } from "@/lib/billing/entitlements";

/**
 * Everything the dashboard's overview cards need, in one round trip.
 *
 * Previously the page queried Prisma directly and computed "start of month"
 * inline in the server's local timezone — a third implementation of the same
 * calculation `lib/ai/utils.ts` already had, and one that could disagree with
 * it about which period a given call fell into.
 */
export async function getDashboardOverview() {
  return handleServerAction(async () => {
    const userId = await requireUserId();

    const [usage, subscription, entitlements] = await Promise.all([
      getMonthlyUsage(userId),
      prisma.subscription.findUnique({ where: { userId } }),
      getEntitlements(userId),
    ]);

    return {
      usage,
      subscription,
      entitlements,
      periodStart: currentPeriodStart(),
    };
  });
}
