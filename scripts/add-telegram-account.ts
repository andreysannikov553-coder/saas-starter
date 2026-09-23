/**
 * Registers (or updates) a Telegram PlatformAccount so scripts/run-topic.ts
 * can publish to it. Reuses the same Organization scripts/run-topic.ts uses
 * (the first one found, or a new "Default" org).
 *
 * `handle` is whatever Telegram's sendMessage/sendVideo accept as chat_id:
 * a public channel's @username, or a numeric chat_id (starts with -100...)
 * for a private channel — get that by forwarding a channel message to
 * @getidsbot.
 *
 * The bot must already be an admin of the channel with permission to post,
 * or sending will fail with a 403 from the Telegram Bot API.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/add-telegram-account.ts <botToken> <handle> [orgId]
 */
import { prisma } from "../src/lib/db";

async function main() {
  const botToken = process.argv[2];
  const handle = process.argv[3];
  const orgIdArg = process.argv[4];

  if (!botToken || !handle) {
    console.error(
      "Usage: npx tsx --env-file=.env.local scripts/add-telegram-account.ts <botToken> <handle> [orgId]"
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
    where: { orgId_platform_handle: { orgId: org.id, platform: "TELEGRAM", handle } },
    create: { orgId: org.id, platform: "TELEGRAM", handle, credentials: { botToken } },
    update: { credentials: { botToken } },
  });

  console.log(`\nPlatformAccount ready: ${account.id} (${handle})`);
  console.log(
    `\nPublish with it: npx tsx --env-file=.env.local scripts/run-topic.ts "Topic title" --publish=${account.id}`
  );
}

main()
  .catch((err) => {
    console.error(
      "\nFailed to register the Telegram account:",
      err instanceof Error ? err.message : err
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
