import { prisma } from "@/lib/db";
import { AuthorizationError } from "@/lib/utils/error";
import { usageLimits } from "@/lib/config";
import { PRICING_PLANS, type PlanId } from "@/lib/stripe/pricing";
import type { Plan, SubscriptionStatus } from "@prisma/client";

/**
 * One place that answers "what does this user's subscription grant them".
 *
 * The token limit used to be hard-coded per AI action and identical for every
 * user; usage limits by plan were declared separately in `config.ts` and
 * never actually connected to a user's subscription. This is the connection.
 *
 * Everything here takes a `userId` rather than reading the session itself, so
 * this module has no dependency on `lib/auth.ts` — which itself depends on
 * this module for `hasActiveSubscription`.
 */

const STATUSES_WITH_ACCESS: ReadonlySet<SubscriptionStatus> = new Set(["ACTIVE", "TRIALING"]);

function toPlanId(plan: Plan): PlanId {
  return plan.toLowerCase() as PlanId;
}

export interface Entitlements {
  plan: PlanId;
  /** -1 means unlimited. */
  aiTokenLimit: number;
  apiCallLimit: number;
  storageLimit: number;
}

const FREE_ENTITLEMENTS: Entitlements = {
  plan: "free",
  aiTokenLimit: usageLimits.free.aiTokens,
  apiCallLimit: usageLimits.free.apiCalls,
  storageLimit: usageLimits.free.storage,
};

/**
 * A subscription grants its plan's entitlements only while it is actually in
 * force: active or trialing, and not past its paid period. A cancelled or
 * lapsed subscription — including one a missed webhook left stale — falls
 * back to free rather than keeping whatever plan it last had.
 */
export async function getEntitlements(userId: string): Promise<Entitlements> {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: { plan: true, status: true, currentPeriodEnd: true },
  });

  if (!subscription || !STATUSES_WITH_ACCESS.has(subscription.status)) {
    return FREE_ENTITLEMENTS;
  }

  if (subscription.currentPeriodEnd && subscription.currentPeriodEnd <= new Date()) {
    return FREE_ENTITLEMENTS;
  }

  const planId = toPlanId(subscription.plan);
  const limits = usageLimits[planId] ?? usageLimits.free;

  return {
    plan: planId,
    aiTokenLimit: limits.aiTokens,
    apiCallLimit: limits.apiCalls,
    storageLimit: limits.storage,
  };
}

/**
 * Gate an action behind a minimum plan. Throws rather than returning a
 * boolean, so a caller cannot forget to check the result.
 */
export async function requirePlan(userId: string, minimum: PlanId): Promise<Entitlements> {
  const entitlements = await getEntitlements(userId);
  const order = PRICING_PLANS.map((p) => p.id);

  if (order.indexOf(entitlements.plan) < order.indexOf(minimum)) {
    throw new AuthorizationError(
      `Эта функция доступна на тарифе ${minimum === "pro" ? "Pro" : "Business"} и выше`
    );
  }

  return entitlements;
}
