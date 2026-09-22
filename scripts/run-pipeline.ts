/**
 * PHASE 1 real integration test runner. Creates a minimal Organization +
 * Topic, then calls runContentPipeline(topicId) end to end with real
 * external calls (Europe PMC, Claude, ElevenLabs when configured), and
 * prints exactly where it stops and why — never simulates a result.
 *
 * Usage: npx tsx scripts/run-pipeline.ts ["Topic title"]
 */
import { prisma } from "../src/lib/db";
import { runContentPipeline } from "../src/lib/content-engine/pipeline";

async function main() {
  const title = process.argv[2] ?? "Как сон влияет на восстановление мышц после тренировки";

  const org = await prisma.organization.create({
    data: { name: `PHASE1 test run ${new Date().toISOString()}` },
  });
  console.log(`Created Organization ${org.id}`);

  const topic = await prisma.topic.create({
    data: { orgId: org.id, title },
  });
  console.log(`Created Topic ${topic.id}: "${title}"`);

  console.log("\nRunning pipeline (real calls where credentials/network allow)...\n");
  const result = await runContentPipeline(topic.id);

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(result, null, 2));

  if (result.stoppedAt) {
    console.log(`\nStopped at stage: ${result.stoppedAt}`);
  } else {
    console.log(
      "\nCompleted through hook generation. Pass { publish: {...} } to reach Voice/Telegram."
    );
  }
}

main()
  .catch((err) => {
    console.error("\nPipeline run failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
