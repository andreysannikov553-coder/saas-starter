import { stripe } from "./client";
import { prisma } from "@/lib/db";
import { env } from "@/env.mjs";
import { logger } from "@/lib/utils/logger";
import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";

/**
 * Verify and construct Stripe webhook event
 */
export function constructWebhookEvent(payload: string | Buffer, signature: string): Stripe.Event {
  return stripe.webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
}

/**
 * Handle Stripe webhook events.
 *
 * Stripe delivers at-least-once and retries on any non-2xx response, so the
 * same event id will arrive more than once in normal operation. The event row
 * is keyed by Stripe's own `event.id`: inserting it is the deduplication
 * check, and an already-processed id returns without doing the work twice.
 */
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  const claimed = await claimEvent(event);
  if (!claimed) {
    logger.info(`Skipping already-processed Stripe event ${event.id} (${event.type})`);
    return;
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        logger.info(`Unhandled Stripe event type: ${event.type}`);
    }

    // Mark this one event processed — never a whole class of them by type.
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processed: true, processedAt: new Date(), error: null },
    });
  } catch (error) {
    logger.error(`Error processing Stripe event ${event.id} (${event.type})`, error);

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        processed: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });

    // Rethrow so the route answers 5xx and Stripe retries.
    throw error;
  }
}

/**
 * Record the event and report whether this delivery should do the work.
 *
 * `createMany` + `skipDuplicates` is a single atomic statement on the primary
 * key, so two deliveries racing each other cannot both claim the event.
 * Returns false only when the event is already recorded AND processed; a row
 * left behind by a failed attempt is retried.
 */
async function claimEvent(event: Stripe.Event): Promise<boolean> {
  const inserted = await prisma.webhookEvent.createMany({
    data: [
      {
        id: event.id,
        type: event.type,
        data: event.data as unknown as Prisma.InputJsonValue,
      },
    ],
    skipDuplicates: true,
  });

  if (inserted.count > 0) return true;

  const existing = await prisma.webhookEvent.findUnique({
    where: { id: event.id },
    select: { processed: true },
  });

  return existing ? !existing.processed : true;
}

/**
 * Resolve the local user a Stripe subscription belongs to.
 *
 * Checkout puts `userId` in the subscription metadata, but a subscription
 * created from the Stripe dashboard or by an older integration will not have
 * it — the customer id is then the only link back to us.
 */
async function resolveUserId(subscription: Stripe.Subscription): Promise<string | null> {
  const fromMetadata = subscription.metadata?.userId;
  if (fromMetadata) return fromMetadata;

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const existing = await prisma.subscription.findUnique({
    where: { stripeCustomerId: customerId },
    select: { userId: true },
  });

  return existing?.userId ?? null;
}

/**
 * Handle subscription created or updated
 */
async function handleSubscriptionUpdate(subscription: Stripe.Subscription): Promise<void> {
  const userId = await resolveUserId(subscription);
  if (!userId) {
    throw new Error(`No userId for Stripe subscription ${subscription.id}`);
  }

  const status = mapStripeStatus(subscription.status);
  const fields = {
    stripeSubscriptionId: subscription.id,
    stripePriceId: subscription.items.data[0]?.price.id ?? null,
    status,
    currentPeriodStart: new Date(subscription.current_period_start * 1000),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };

  await prisma.subscription.upsert({
    where: { userId },
    create: {
      userId,
      stripeCustomerId:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id,
      ...fields,
    },
    update: fields,
  });
}

/**
 * Handle subscription deleted.
 *
 * `updateMany` rather than `update`: a delete event for a subscription we have
 * no row for is not an error, and throwing here would make Stripe retry the
 * event until it gives up permanently.
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const result = await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: subscription.id },
    data: {
      status: "CANCELED",
      stripeSubscriptionId: null,
      cancelAtPeriodEnd: false,
    },
  });

  if (result.count === 0) {
    logger.warn(`No local subscription for deleted Stripe subscription ${subscription.id}`);
  }
}

/**
 * Handle successful invoice payment
 */
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = invoice.subscription as string | null;
  if (!subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await handleSubscriptionUpdate(subscription);
}

/**
 * Handle failed invoice payment
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = invoice.subscription as string | null;
  if (!subscriptionId) return;

  const result = await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: subscriptionId },
    data: { status: "PAST_DUE" },
  });

  if (result.count === 0) {
    logger.warn(`No local subscription for failed invoice on ${subscriptionId}`);
  }
}

/**
 * Map Stripe subscription status to our database enum
 */
export function mapStripeStatus(status: Stripe.Subscription.Status) {
  const statusMap: Record<
    Stripe.Subscription.Status,
    "ACTIVE" | "INACTIVE" | "PAST_DUE" | "CANCELED" | "TRIALING"
  > = {
    active: "ACTIVE",
    past_due: "PAST_DUE",
    canceled: "CANCELED",
    incomplete: "INACTIVE",
    incomplete_expired: "INACTIVE",
    trialing: "TRIALING",
    unpaid: "PAST_DUE",
    paused: "INACTIVE",
  };

  return statusMap[status] || "INACTIVE";
}
