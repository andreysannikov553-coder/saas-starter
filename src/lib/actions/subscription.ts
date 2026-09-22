"use server";

import { getCurrentUser } from "@/lib/auth";
import { handleServerAction } from "@/lib/utils/error";
import { prisma } from "@/lib/db";
import { getOrCreateCustomer, cancelSubscription, resumeSubscription } from "@/lib/stripe/billing";
import { createCheckoutSession, createBillingPortalSession } from "@/lib/stripe/checkout";
import { createCheckoutSessionSchema } from "@/lib/validation/subscription";
import { isPurchasablePriceId } from "@/lib/stripe/pricing";
import { AuthenticationError, NotFoundError, ValidationError } from "@/lib/utils/error";

/**
 * Create checkout session for subscription
 */
export async function createSubscriptionCheckout(priceId: string) {
  return handleServerAction(async () => {
    const user = await getCurrentUser();
    if (!user) {
      throw new AuthenticationError();
    }

    const validatedData = createCheckoutSessionSchema.parse({ priceId });

    // Never hand a caller-supplied price straight to Stripe: without this the
    // user picks what they pay, including archived or internal prices.
    if (!isPurchasablePriceId(validatedData.priceId)) {
      throw new ValidationError("Этот тариф недоступен для оформления");
    }

    const customerId = await getOrCreateCustomer(user.id, user.email!);

    const session = await createCheckoutSession({
      userId: user.id,
      userEmail: user.email!,
      priceId: validatedData.priceId,
      customerId,
    });

    return { url: session.url };
  });
}

/**
 * Create billing portal session
 */
export async function createPortalSession() {
  return handleServerAction(async () => {
    const user = await getCurrentUser();
    if (!user) {
      throw new AuthenticationError();
    }

    const subscription = await prisma.subscription.findUnique({
      where: { userId: user.id },
      select: { stripeCustomerId: true },
    });

    if (!subscription?.stripeCustomerId) {
      throw new NotFoundError("Подписка не найдена");
    }

    const session = await createBillingPortalSession(subscription.stripeCustomerId);

    return { url: session.url };
  });
}

/**
 * Cancel subscription
 */
export async function cancelUserSubscription() {
  return handleServerAction(async () => {
    const user = await getCurrentUser();
    if (!user) {
      throw new AuthenticationError();
    }

    const subscription = await prisma.subscription.findUnique({
      where: { userId: user.id },
    });

    if (!subscription?.stripeSubscriptionId) {
      throw new NotFoundError("Активная подписка не найдена");
    }

    await cancelSubscription(subscription.stripeSubscriptionId);

    await prisma.subscription.update({
      where: { userId: user.id },
      data: { cancelAtPeriodEnd: true },
    });

    return { success: true };
  });
}

/**
 * Resume subscription
 */
export async function resumeUserSubscription() {
  return handleServerAction(async () => {
    const user = await getCurrentUser();
    if (!user) {
      throw new AuthenticationError();
    }

    const subscription = await prisma.subscription.findUnique({
      where: { userId: user.id },
    });

    if (!subscription?.stripeSubscriptionId) {
      throw new NotFoundError("Подписка не найдена");
    }

    await resumeSubscription(subscription.stripeSubscriptionId);

    await prisma.subscription.update({
      where: { userId: user.id },
      data: { cancelAtPeriodEnd: false },
    });

    return { success: true };
  });
}

/**
 * Get subscription details
 */
export async function getSubscriptionDetails() {
  return handleServerAction(async () => {
    const user = await getCurrentUser();
    if (!user) {
      throw new AuthenticationError();
    }

    const subscription = await prisma.subscription.findUnique({
      where: { userId: user.id },
    });

    return subscription;
  });
}
