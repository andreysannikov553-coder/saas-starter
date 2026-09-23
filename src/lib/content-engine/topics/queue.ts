import { prisma } from "@/lib/db";

/**
 * Oldest untouched Topic for the org — "untouched" meaning still `NEW`, since
 * research/scripts/generate.ts already advance status to RESEARCHED/SCRIPTED
 * as a topic moves through the pipeline (see prisma/schema.prisma
 * TopicStatus). No separate "claimed" flag is needed: the cron route runs at
 * most once per invocation, so there's no concurrent claimant to race.
 */
export async function getNextQueuedTopicId(orgId: string): Promise<string | null> {
  const topic = await prisma.topic.findFirst({
    where: { orgId, status: "NEW" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return topic?.id ?? null;
}
