/**
 * Tops up the health/sport Topic queue that scripts/cron-publish-next.ts (and
 * the /api/cron/publish route) consume one at a time. Safe to re-run — only
 * inserts titles not already present for the org.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/seed-topics.ts [orgId]
 */
import { prisma } from "../src/lib/db";
import { seedHealthSportTopicQueue } from "../src/lib/content-engine/topics/seed-queue";

async function main() {
  const orgIdArg = process.argv[2];
  const result = await seedHealthSportTopicQueue(orgIdArg);
  console.log(
    `Org ${result.orgId}: added ${result.created} new topic(s), ${result.skipped} already existed.`
  );
}

main()
  .catch((err) => {
    console.error("Failed to seed topics:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
