/**
 * Adds a real topic and runs the content pipeline against it, for real
 * production use (as opposed to scripts/run-pipeline.ts on
 * chore/real-integration-test, which creates a throwaway Organization on
 * every run and was only ever meant for the PHASE 1 integration test).
 *
 * Reuses one Organization across runs (the first one found, or a new
 * "Default" org on the very first run) instead of spawning a new one every
 * time, so topics accumulate under a single, real org.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/run-topic.ts "Topic title" [orgId] [flags]
 *
 * Flags:
 *   --publish=<platformAccountId>  Publish to this Telegram PlatformAccount
 *                                  (see scripts/add-telegram-account.ts) once
 *                                  hooks pass. Without it, the run stops
 *                                  after hook scoring.
 *   --voice=<ttsVoiceId>           Narrate with this ElevenLabs voice before
 *                                  publishing. Without it (but with
 *                                  --publish), the script publishes as text.
 */
import { prisma } from "../src/lib/db";
import { runContentPipeline } from "../src/lib/content-engine/pipeline";

function parseFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

async function main() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const title = positional[0];
  const orgIdArg = positional[1];
  const telegramPlatformAccountId = parseFlag("publish");
  const ttsVoiceId = parseFlag("voice");

  if (!title) {
    console.error(
      'Usage: npx tsx --env-file=.env.local scripts/run-topic.ts "Topic title" [orgId] [--publish=<platformAccountId>] [--voice=<ttsVoiceId>]'
    );
    process.exitCode = 1;
    return;
  }

  const org = orgIdArg
    ? await prisma.organization.findUniqueOrThrow({ where: { id: orgIdArg } })
    : ((await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } })) ??
      (await prisma.organization.create({ data: { name: "Default" } })));
  console.log(`Using Organization ${org.id} (${org.name})`);

  const topic = await prisma.topic.create({
    data: { orgId: org.id, title },
  });
  console.log(`Created Topic ${topic.id}: "${title}"`);

  console.log("\nRunning pipeline (real calls where credentials/network allow)...\n");
  const result = await runContentPipeline(topic.id, {
    publish: telegramPlatformAccountId ? { telegramPlatformAccountId, ttsVoiceId } : undefined,
  });

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(result, null, 2));

  if (result.stoppedAt) {
    console.log(`\nStopped at stage: ${result.stoppedAt}`);
  } else {
    console.log("\nPublished. See result.publicationId above.");
  }
}

main()
  .catch((err) => {
    console.error("\nPipeline run failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
