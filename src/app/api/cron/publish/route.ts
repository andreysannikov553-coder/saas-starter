import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/env.mjs";
import { runContentPipeline } from "@/lib/content-engine/pipeline";
import { getNextQueuedTopicId } from "@/lib/content-engine/topics/queue";

/**
 * Vercel Cron entry point — runs one queued Topic through the full pipeline
 * (research -> claims -> script -> hooks -> publish) and posts it to the
 * configured Telegram channel. One topic per invocation, not a batch: the
 * pipeline stages call real LLM/network APIs and can take minutes (see the
 * Groq run in this session — ~6 min for one topic end to end), well past
 * what's safe to pile into a single request.
 *
 * Schedule lives in vercel.json. Requires CRON_SECRET and
 * TELEGRAM_PLATFORM_ACCOUNT_ID to be set on the Vercel project — see
 * env.example.
 */
export async function GET(request: Request) {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!env.TELEGRAM_PLATFORM_ACCOUNT_ID) {
    return NextResponse.json(
      { error: "TELEGRAM_PLATFORM_ACCOUNT_ID is not configured" },
      { status: 500 }
    );
  }

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) {
    return NextResponse.json({ ok: true, message: "No organization yet — nothing to do" });
  }

  const topicId = await getNextQueuedTopicId(org.id);
  if (!topicId) {
    return NextResponse.json({
      ok: true,
      message: "Topic queue is empty — run scripts/seed-topics.ts to top it up",
    });
  }

  try {
    const result = await runContentPipeline(topicId, {
      publish: { telegramPlatformAccountId: env.TELEGRAM_PLATFORM_ACCOUNT_ID },
    });

    // researchTopic() deliberately leaves a zero-source topic as NEW so a
    // human can retry it with a better query (see research/index.ts) — fine
    // for the CLI script, but unattended cron would otherwise repick the
    // same dead-end topic forever and never advance the queue. Archive it
    // here instead; re-queue by resetting status back to NEW if the query
    // gets fixed later.
    if (result.stoppedAt === "research") {
      await prisma.topic.update({ where: { id: topicId }, data: { status: "ARCHIVED" } });
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, topicId, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
