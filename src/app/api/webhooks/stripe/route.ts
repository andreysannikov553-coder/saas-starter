import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { constructWebhookEvent, handleWebhookEvent } from "@/lib/stripe/webhook";
import { logger } from "@/lib/utils/logger";

export async function POST(req: Request) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  // A bad signature is permanent: answer 4xx so Stripe stops retrying.
  let event;
  try {
    event = constructWebhookEvent(body, signature);
  } catch (error) {
    logger.warn("Rejected Stripe webhook with invalid signature", error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // A processing failure is usually transient (database, network). Answer 5xx
  // so Stripe retries — a 4xx here would drop the event permanently.
  try {
    await handleWebhookEvent(event);
  } catch {
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
