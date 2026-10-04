import { test, mock, before } from "node:test";
import assert from "node:assert/strict";

/**
 * publishVideoToAllPlatforms is pure fan-out, so these mock Prisma and every
 * per-platform publisher it calls. What they prove is the behaviour that
 * matters for an unattended run: one platform failing does not stop the
 * others, a script with no render skips the video-only platforms instead of
 * marking them failed, and every platform is handed the same pinned Video.
 */

interface FakeState {
  accounts: Record<string, unknown>[];
  video: { id: string; orgId: string; assetUrl: string } | null;
  calls: { fn: string; scriptId: string; accountId: string; options?: unknown }[];
  failOn: Set<string>;
  queryArgs: Record<string, unknown> | null;
}

const state: FakeState = {
  accounts: [],
  video: null,
  calls: [],
  failOn: new Set(),
  queryArgs: null,
};

function record(fn: string, scriptId: string, accountId: string, options?: unknown) {
  state.calls.push({ fn, scriptId, accountId, options });
  if (state.failOn.has(fn)) throw new Error(`${fn} failed: simulated`);
}

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      platformAccount: {
        findMany: async (args: Record<string, unknown>) => {
          state.queryArgs = args;
          const where = args.where as {
            platform: { in: string[] };
            autoPublish?: boolean;
          };
          return state.accounts.filter(
            (a) =>
              where.platform.in.includes(a.platform as string) &&
              (where.autoPublish === undefined || a.autoPublish === where.autoPublish)
          );
        },
      },
    },
  },
});

mock.module("./video-publish", {
  namedExports: {
    findRenderedVideoForScript: async () => state.video,
    publishScriptToYouTube: async (scriptId: string, accountId: string, options: unknown) => {
      record("youtube", scriptId, accountId, options);
      return { publicationId: "pub-yt", externalId: "yt-1", mode: "short" };
    },
    publishScriptToInstagramReel: async (scriptId: string, accountId: string, options: unknown) => {
      record("instagram-reel", scriptId, accountId, options);
      return { publicationId: "pub-ig", externalId: "ig-1", mode: "reel" };
    },
    publishScriptToTikTok: async (scriptId: string, accountId: string, options: unknown) => {
      record("tiktok", scriptId, accountId, options);
      return { publicationId: "pub-tt", externalId: "tt-1", mode: "draft" };
    },
  },
});

mock.module("./social", {
  namedExports: {
    publishScriptToInstagram: async (scriptId: string, accountId: string, options: unknown) => {
      record("instagram-carousel", scriptId, accountId, options);
      return { publicationId: "pub-ig-c", externalId: "ig-c-1", mode: "carousel" };
    },
  },
});

mock.module("./publish", {
  namedExports: {
    publishVideoToTelegram: async (videoId: string, accountId: string, options: unknown) => {
      record("telegram", videoId, accountId, options);
      return { publicationId: "pub-tg", externalId: "tg-1", mode: "video" };
    },
  },
});

mock.module("../render/narrate-video", {
  namedExports: {
    getOrCreateVideoForScript: async (scriptId: string) => `queued-video-for-${scriptId}`,
  },
});

let publishVideoToAllPlatforms: typeof import("./publish-all").publishVideoToAllPlatforms;

before(async () => {
  ({ publishVideoToAllPlatforms } = await import("./publish-all"));
});

const ALL_ACCOUNTS = [
  { id: "yt-1", platform: "YOUTUBE_SHORTS", handle: "@channel_of_health", autoPublish: true },
  { id: "ig-1", platform: "INSTAGRAM", handle: "channel_of_health", autoPublish: false },
  { id: "tt-1", platform: "TIKTOK", handle: "channelofhealth", autoPublish: true },
  { id: "tg-1", platform: "TELEGRAM", handle: "@channel_of_health", autoPublish: true },
];

function resetState() {
  state.accounts = ALL_ACCOUNTS.map((a) => ({ ...a }));
  state.video = { id: "video-1", orgId: "org-1", assetUrl: "https://cdn.example.com/v.mp4" };
  state.calls = [];
  state.failOn = new Set();
  state.queryArgs = null;
}

function byPlatform(results: Awaited<ReturnType<typeof publishVideoToAllPlatforms>>) {
  return new Map(results.map((r) => [r.platform, r]));
}

test("publishes a rendered video to every configured platform", async () => {
  resetState();

  const results = await publishVideoToAllPlatforms("script-1", "org-1");

  assert.equal(results.length, 4);
  assert.ok(results.every((r) => r.status === "PUBLISHED"));

  const map = byPlatform(results);
  assert.equal(map.get("YOUTUBE_SHORTS")?.mode, "short");
  assert.equal(map.get("INSTAGRAM")?.mode, "reel");
  assert.equal(map.get("TIKTOK")?.mode, "draft");
  assert.equal(map.get("TELEGRAM")?.mode, "video");
  assert.equal(map.get("YOUTUBE_SHORTS")?.externalId, "yt-1");
  assert.equal(map.get("TELEGRAM")?.handle, "@channel_of_health");

  // Every platform got the same pinned Video, and Telegram got its id directly.
  const pinned = state.calls
    .filter((c) => c.fn !== "telegram")
    .map((c) => (c.options as { videoId?: string }).videoId);
  assert.deepEqual(new Set(pinned), new Set(["video-1"]));
  assert.equal(state.calls.find((c) => c.fn === "telegram")?.scriptId, "video-1");
});

test("one failing platform does not stop the others", async () => {
  resetState();
  state.failOn = new Set(["tiktok"]);

  const results = await publishVideoToAllPlatforms("script-1", "org-1");

  const map = byPlatform(results);
  assert.equal(map.get("TIKTOK")?.status, "FAILED");
  assert.match(map.get("TIKTOK")?.reason ?? "", /simulated/);
  assert.equal(map.get("YOUTUBE_SHORTS")?.status, "PUBLISHED");
  assert.equal(map.get("INSTAGRAM")?.status, "PUBLISHED");
  assert.equal(map.get("TELEGRAM")?.status, "PUBLISHED");
});

test("every platform failing still returns one outcome each", async () => {
  resetState();
  state.failOn = new Set(["youtube", "instagram-reel", "tiktok", "telegram"]);

  const results = await publishVideoToAllPlatforms("script-1", "org-1");

  assert.equal(results.length, 4);
  assert.ok(results.every((r) => r.status === "FAILED"));
});

test("with nothing rendered, skips the video-only platforms and posts a carousel instead", async () => {
  resetState();
  state.video = null;

  const results = await publishVideoToAllPlatforms("script-1", "org-1");

  const map = byPlatform(results);
  assert.equal(map.get("YOUTUBE_SHORTS")?.status, "SKIPPED");
  assert.match(map.get("YOUTUBE_SHORTS")?.reason ?? "", /no rendered video/);
  assert.equal(map.get("TIKTOK")?.status, "SKIPPED");

  // Instagram falls back to the slide carousel, Telegram to its own fallbacks.
  assert.equal(map.get("INSTAGRAM")?.status, "PUBLISHED");
  assert.equal(map.get("INSTAGRAM")?.mode, "carousel");
  assert.equal(map.get("TELEGRAM")?.status, "PUBLISHED");
  assert.equal(state.calls.find((c) => c.fn === "telegram")?.scriptId, "queued-video-for-script-1");
  assert.equal(
    state.calls.some((c) => c.fn === "youtube" || c.fn === "tiktok"),
    false
  );
});

test("a platforms filter narrows the fan-out", async () => {
  resetState();

  const results = await publishVideoToAllPlatforms("script-1", "org-1", {
    platforms: ["YOUTUBE_SHORTS", "TIKTOK"],
  });

  assert.deepEqual(
    results.map((r) => r.platform),
    ["YOUTUBE_SHORTS", "TIKTOK"]
  );
});

test("autoPublishOnly leaves out accounts that are not set to autopost", async () => {
  resetState();

  const results = await publishVideoToAllPlatforms("script-1", "org-1", {
    autoPublishOnly: true,
  });

  assert.equal((state.queryArgs?.where as { autoPublish?: boolean }).autoPublish, true);
  assert.equal(
    results.some((r) => r.platform === "INSTAGRAM"),
    false
  );
  assert.equal(results.length, 3);
});

test("per-platform options are forwarded", async () => {
  resetState();

  await publishVideoToAllPlatforms("script-1", "org-1", {
    youtube: { privacyStatus: "private" },
    tiktok: { mode: "direct", privacyLevel: "SELF_ONLY" },
    instagram: { shareToFeed: false },
  });

  const yt = state.calls.find((c) => c.fn === "youtube")?.options as Record<string, unknown>;
  const tt = state.calls.find((c) => c.fn === "tiktok")?.options as Record<string, unknown>;
  const ig = state.calls.find((c) => c.fn === "instagram-reel")?.options as Record<string, unknown>;
  assert.equal(yt.privacyStatus, "private");
  assert.equal(tt.mode, "direct");
  assert.equal(ig.shareToFeed, false);
});

test("returns an empty list when the org has no platform accounts", async () => {
  resetState();
  state.accounts = [];

  const results = await publishVideoToAllPlatforms("script-1", "org-1");

  assert.deepEqual(results, []);
  assert.equal(state.calls.length, 0);
});
