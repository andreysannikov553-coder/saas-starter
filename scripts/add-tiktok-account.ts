/**
 * Registers (or updates) a TikTok PlatformAccount so publishScriptToTikTok
 * (src/lib/content-engine/publishing/video-publish.ts) can upload to it.
 * Reuses the same Organization scripts/run-topic.ts uses.
 *
 * Prerequisites (done at developers.tiktok.com, not here):
 *   1. A TikTok developer app with the "Content Posting API" product added,
 *      plus Login Kit to get a token at all.
 *   2. Scopes: `video.upload` for the default inbox/draft mode,
 *      `video.publish` as well if you want direct posting.
 *   3. Your TikTok account added as a target user on the app (an unaudited
 *      app can only act for its own developer/test accounts).
 *   4. An access token + open_id from the Login Kit OAuth flow. TikTok
 *      requires an HTTPS redirect URI, so there is no loopback CLI flow the
 *      way there is for YouTube — run the authorize URL in a browser against
 *      whatever HTTPS redirect you registered and copy the values out.
 *
 * WHAT AN UNAUDITED APP CAN ACTUALLY DO: the inbox mode this defaults to
 * uploads the video into your TikTok app's inbox as an unfinished draft —
 * you then open TikTok, write the caption and post it yourself. Direct
 * posting works too, but until the app passes TikTok's audit every post is
 * forced to SELF_ONLY (visible only to you). Public automated posting needs
 * that audit. See src/lib/content-engine/publishing/tiktok.ts.
 *
 * TOKEN LIFETIME: a TikTok access token lasts 24 hours. Pass
 * --refresh-token=<token> (with TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET in
 * .env.local) and the publisher refreshes it on every run and stores the
 * rotated pair — without it, posting stops working a day after this script.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/add-tiktok-account.ts <accessToken> <openId> <handle> [orgId] [--refresh-token=<token>]
 */
import { prisma } from "../src/lib/db";

function parseFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

async function main() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const accessToken = positional[0];
  const openId = positional[1];
  const handle = positional[2];
  const orgIdArg = positional[3];
  const refreshToken = parseFlag("refresh-token");

  if (!accessToken || !openId || !handle) {
    console.error(
      "Usage: npx tsx --env-file=.env.local scripts/add-tiktok-account.ts <accessToken> <openId> <handle> [orgId] [--refresh-token=<token>]"
    );
    process.exitCode = 1;
    return;
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (refreshToken && (!clientKey || !clientSecret)) {
    console.error(
      "--refresh-token needs TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in .env.local (the app's credentials used to refresh it)."
    );
    process.exitCode = 1;
    return;
  }

  const org = orgIdArg
    ? await prisma.organization.findUniqueOrThrow({ where: { id: orgIdArg } })
    : ((await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } })) ??
      (await prisma.organization.create({ data: { name: "Default" } })));
  console.log(`Using Organization ${org.id} (${org.name})`);

  const credentials =
    refreshToken && clientKey && clientSecret
      ? { accessToken, openId, refreshToken, clientKey, clientSecret }
      : { accessToken, openId };

  const account = await prisma.platformAccount.upsert({
    where: { orgId_platform_handle: { orgId: org.id, platform: "TIKTOK", handle } },
    create: { orgId: org.id, platform: "TIKTOK", handle, credentials },
    update: { credentials },
  });

  console.log(`\nPlatformAccount ready: ${account.id} (${handle})`);
  if (!refreshToken) {
    console.log(
      "No refresh token stored — this access token stops working in ~24h. Re-run with --refresh-token=<token> for unattended posting."
    );
  }
}

main()
  .catch((err) => {
    console.error(
      "\nFailed to register the TikTok account:",
      err instanceof Error ? err.message : err
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
