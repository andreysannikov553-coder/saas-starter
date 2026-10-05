/**
 * "Virality Skill" — scans current health/fitness news (Google News RSS,
 * free and keyless) and tops up the Topic queue with what it finds, via the
 * configured LLM fallback chain to turn headlines into researchable topics.
 * Safe to re-run — only inserts titles not already present for the org.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/scan-trends.ts [orgId]
 */
import { prisma } from "../src/lib/db";
import { seedTrendingTopicQueue } from "../src/lib/content-engine/topics/seed-queue";

async function main() {
  const orgIdArg = process.argv[2];
  const result = await seedTrendingTopicQueue(orgIdArg);
  console.log(
    `Org ${result.orgId}: scanned ${result.headlinesScanned} headlines, ` +
      `added ${result.created} new topic(s), ${result.skipped} already existed.`
  );
}

main()
  .catch((err) => {
    console.error("Failed to scan trends:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
