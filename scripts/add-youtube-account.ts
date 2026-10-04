/**
 * Registers (or updates) a YouTube Shorts PlatformAccount so
 * publishScriptToYouTube (src/lib/content-engine/publishing/video-publish.ts)
 * can upload to it. Reuses the same Organization scripts/run-topic.ts uses.
 *
 * Prerequisites (done in Google Cloud Console and scripts/youtube-oauth.ts,
 * not here):
 *   1. A Google Cloud project with the "YouTube Data API v3" enabled.
 *   2. An OAuth consent screen, with your own Google account added as a Test
 *      user while the app is in Testing mode (an unverified app's refresh
 *      token otherwise expires after 7 days).
 *   3. An OAuth client of type "Desktop app" — its id/secret go into
 *      .env.local as YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET.
 *   4. `npx tsx --env-file=.env.local scripts/youtube-oauth.ts` once, to mint
 *      YOUTUBE_REFRESH_TOKEN (scope youtube.upload) for the channel you want
 *      to post to — pick that channel's Google account in the browser.
 *
 * No app review is needed to upload to your own channel. The default daily
 * quota (10,000 units) is worth knowing: videos.insert costs ~1,600 units, so
 * roughly 6 uploads a day.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/add-youtube-account.ts <handle> [orgId]
 */
import { prisma } from "../src/lib/db";

async function main() {
  const handle = process.argv[2];
  const orgIdArg = process.argv[3];

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  if (!handle) {
    console.error(
      "Usage: npx tsx --env-file=.env.local scripts/add-youtube-account.ts <handle> [orgId]"
    );
    process.exitCode = 1;
    return;
  }

  if (!clientId || !clientSecret || !refreshToken) {
    console.error(
      "Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN in .env.local.\n" +
        "Create the Desktop-app OAuth client in Google Cloud Console, then run:\n" +
        "  npx tsx --env-file=.env.local scripts/youtube-oauth.ts"
    );
    process.exitCode = 1;
    return;
  }

  const org = orgIdArg
    ? await prisma.organization.findUniqueOrThrow({ where: { id: orgIdArg } })
    : ((await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } })) ??
      (await prisma.organization.create({ data: { name: "Default" } })));
  console.log(`Using Organization ${org.id} (${org.name})`);

  const credentials = { refreshToken, clientId, clientSecret };

  const account = await prisma.platformAccount.upsert({
    where: { orgId_platform_handle: { orgId: org.id, platform: "YOUTUBE_SHORTS", handle } },
    create: { orgId: org.id, platform: "YOUTUBE_SHORTS", handle, credentials },
    update: { credentials },
  });

  console.log(`\nPlatformAccount ready: ${account.id} (${handle})`);
}

main()
  .catch((err) => {
    console.error(
      "\nFailed to register the YouTube account:",
      err instanceof Error ? err.message : err
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
