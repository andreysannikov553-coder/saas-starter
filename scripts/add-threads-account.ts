/**
 * Registers (or updates) a Threads PlatformAccount so
 * publishScriptToThreads (src/lib/content-engine/publishing/social.ts) can
 * publish to it. Reuses the same Organization scripts/run-topic.ts uses.
 *
 * Prerequisites (done in the Meta/Threads consoles, not here):
 *   1. A Meta Developer App (developers.facebook.com) with the Threads
 *      product added.
 *   2. Your Threads account added as a tester on that app, invite accepted.
 *   3. A long-lived access token (see developers.facebook.com/docs/threads)
 *      with threads_basic and threads_content_publish scopes.
 *   4. Your Threads user id — GET https://graph.threads.net/v1.0/me?fields=id&access_token=...
 *
 * No app review needed while it's only your own account.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/add-threads-account.ts <accessToken> <threadsUserId> <handle> [orgId]
 */
import { prisma } from "../src/lib/db";

async function main() {
  const accessToken = process.argv[2];
  const threadsUserId = process.argv[3];
  const handle = process.argv[4];
  const orgIdArg = process.argv[5];

  if (!accessToken || !threadsUserId || !handle) {
    console.error(
      "Usage: npx tsx --env-file=.env.local scripts/add-threads-account.ts <accessToken> <threadsUserId> <handle> [orgId]"
    );
    process.exitCode = 1;
    return;
  }

  const org = orgIdArg
    ? await prisma.organization.findUniqueOrThrow({ where: { id: orgIdArg } })
    : ((await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } })) ??
      (await prisma.organization.create({ data: { name: "Default" } })));
  console.log(`Using Organization ${org.id} (${org.name})`);

  const account = await prisma.platformAccount.upsert({
    where: { orgId_platform_handle: { orgId: org.id, platform: "THREADS", handle } },
    create: {
      orgId: org.id,
      platform: "THREADS",
      handle,
      credentials: { accessToken, threadsUserId },
    },
    update: { credentials: { accessToken, threadsUserId } },
  });

  console.log(`\nPlatformAccount ready: ${account.id} (${handle})`);
}

main()
  .catch((err) => {
    console.error(
      "\nFailed to register the Threads account:",
      err instanceof Error ? err.message : err
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
