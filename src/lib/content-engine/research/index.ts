import { prisma } from "@/lib/db";
import { searchEuropePmc, type ResearchedSource } from "./europe-pmc";
import { withStageLog } from "../observability/logger";

export * from "./europe-pmc";

export interface ResearchTopicOptions {
  /** How many records to pull from Europe PMC before de-duplication. */
  pageSize?: number;
  openAccessOnly?: boolean;
  signal?: AbortSignal;
}

export interface ResearchTopicResult {
  found: number;
  created: number;
  skipped: number;
}

/**
 * Researches a topic and stores what it finds as sources for that topic.
 *
 * Sources are keyed by URL within a topic, so re-running this on the same
 * topic is safe: already-known papers are counted as skipped rather than
 * duplicated. (The same paper can end up as a separate Source row under a
 * different topic — Source.topicId is a single required field, not a join
 * table, so this is the deliberate tradeoff for keeping the schema simple.)
 * The topic moves to RESEARCHED only if at least one source landed — a search
 * that found nothing leaves it NEW so it can be retried with a better query.
 */
export async function researchTopic(
  topicId: string,
  options: ResearchTopicOptions = {}
): Promise<ResearchTopicResult> {
  return withStageLog(
    "research",
    { topicId },
    async () => {
      const topic = await prisma.topic.findUnique({ where: { id: topicId } });
      if (!topic) {
        throw new Error(`Topic ${topicId} not found`);
      }

      const found = await searchEuropePmc(topic.title, options);

      const existing = await prisma.source.findMany({
        where: { topicId: topic.id, url: { in: found.map((s) => s.url) } },
        select: { url: true },
      });
      const known = new Set(existing.map((s) => s.url));

      const fresh = dedupeByUrl(found).filter((source) => !known.has(source.url));

      if (fresh.length > 0) {
        await prisma.source.createMany({
          data: fresh.map((source) => ({ ...source, orgId: topic.orgId, topicId: topic.id })),
        });

        await prisma.topic.update({
          where: { id: topic.id },
          data: { status: "RESEARCHED" },
        });
      }

      return {
        found: found.length,
        created: fresh.length,
        skipped: found.length - fresh.length,
      };
    },
    (result) => ({ ...result })
  );
}

/** Europe PMC can return the same paper under several ids; keep the first. */
function dedupeByUrl(sources: ResearchedSource[]): ResearchedSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}
