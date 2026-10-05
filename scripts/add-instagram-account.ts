/**
 * Registers (or updates) an Instagram PlatformAccount so
 * publishScriptToInstagram (src/lib/content-engine/publishing/social.ts) can
 * publish to it. Reuses the same Organization scripts/run-topic.ts uses.
 *
 * Prerequisites (done in the Meta/Instagram consoles, not here):
 *   1. Instagram account converted to Business or Creator (Instagram app ->
 *      Settings -> Account type).
 *   2. A Meta Developer App (developers.facebook.com) with the Instagram
 *      product added ("Instagram API with Instagram Login" — no linked
 *      Facebook Page needed).
 *   3. Your Instagram account added as a tester on that app, invite accepted
 *      in the Instagram app itself.
 *   4. A long-lived access token for that account (Graph API Explorer, or
 *      the token-exchange endpoint) with instagram_business_basic and
 *      instagram_business_content_publish scopes.
 *   5. Your Instagram user id — GET https://graph.instagram.com/v21.0/me?fields=id&access_token=...
 *
 * No app review needed while it's only your own account (Development mode
 * apps can post as their own admins/testers).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/add-instagram-account.ts <accessToken> <igUserId> <handle> [orgId]
 */
import { prisma } from "../src/lib/db";

async function main() {
  const accessToken = process.argv[2];
  const igUserId = process.argv[3];
  const handle = process.argv[4];
  const orgIdArg = process.argv[5];

  if (!accessToken || !igUserId || !handle) {
    console.error(
      "Usage: npx tsx --env-file=.env.local scripts/add-instagram-account.ts <accessToken> <igUserId> <handle> [orgId]"
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
    where: { orgId_platform_handle: { orgId: org.id, platform: "INSTAGRAM", handle } },
    create: {
      orgId: org.id,
      platform: "INSTAGRAM",
      handle,
      credentials: { accessToken, igUserId },
    },
    update: { credentials: { accessToken, igUserId } },
  });

  console.log(`\nPlatformAccount ready: ${account.id} (${handle})`);
}

main()
  .catch((err) => {
    console.error(
      "\nFailed to register the Instagram account:",
      err instanceof Error ? err.message : err
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
