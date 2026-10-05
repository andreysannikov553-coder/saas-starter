import { test, mock, before } from "node:test";
import assert from "node:assert/strict";

/**
 * publishScriptToYouTube/publishScriptToInstagramReel/publishScriptToTikTok
 * share one orchestrator (doPublishVideo in video-publish.ts) — these mock
 * Prisma, the asset download and all three platform clients, so they prove
 * the wiring (lookup -> rendered-video resolution -> upload -> Publication
 * status) and the copy built from hooks/beats, not a real upload.
 */

interface FakeState {
  script: Record<string, unknown> | null;
  account: Record<string, unknown> | null;
  /** The newest rendered Video for the script, as Prisma would return it. */
  video: Record<string, unknown> | null;
  publications: Map<string, Record<string, unknown>>;
  fetchedAssets: string[];
  ytUploads: Record<string, unknown>[];
  igReels: Record<string, unknown>[];
  tiktokPosts: Record<string, unknown>[];
  tiktokRefreshes: Record<string, unknown>[];
  /** Credentials written back to PlatformAccount (TikTok token rotation). */
  credentialWrites: Record<string, unknown>[];
  failPublish: boolean;
}

const state: FakeState = {
  script: null,
  account: null,
  video: null,
  publications: new Map(),
  fetchedAssets: [],
  ytUploads: [],
  igReels: [],
  tiktokPosts: [],
  tiktokRefreshes: [],
  credentialWrites: [],
  failPublish: false,
};

function keyFor(videoId: string, platformAccountId: string) {
  return `${videoId}:${platformAccountId}`;
}

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      script: { findUnique: async () => state.script },
      platformAccount: {
        findUnique: async () => state.account,
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          state.credentialWrites.push(args.data.credentials as Record<string, unknown>);
          return { id: args.where.id, ...args.data };
        },
      },
      video: {
        findFirst: async () => state.video,
        findUnique: async (args: { where: { id: string } }) =>
          state.video && state.video.id === args.where.id ? state.video : null,
      },
      publication: {
        findUnique: async (args: {
          where: { videoId_platformAccountId: { videoId: string; platformAccountId: string } };
        }) =>
          state.publications.get(
            keyFor(
              args.where.videoId_platformAccountId.videoId,
              args.where.videoId_platformAccountId.platformAccountId
            )
          ) ?? null,
        upsert: async (args: {
          where: { videoId_platformAccountId: { videoId: string; platformAccountId: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const key = keyFor(
            args.where.videoId_platformAccountId.videoId,
            args.where.videoId_platformAccountId.platformAccountId
          );
          const existing = state.publications.get(key);
          const row = existing
            ? { ...existing, ...args.update }
            : { id: `pub-${state.publications.size}`, ...args.create };
          state.publications.set(key, row);
          return row;
        },
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          for (const [key, row] of state.publications) {
            if (row.id === args.where.id) {
              const updated = { ...row, ...args.data };
              state.publications.set(key, updated);
              return updated;
            }
          }
          throw new Error("publication not found");
        },
      },
    },
  },
});

mock.module("./video-asset", {
  namedExports: {
    fetchVideoAsset: async (url: string) => {
      state.fetchedAssets.push(url);
      return Buffer.from("fake-mp4");
    },
  },
});

mock.module("./youtube", {
  namedExports: {
    uploadYouTubeShort: async (creds: unknown, options: Record<string, unknown>) => {
      state.ytUploads.push({ creds, options });
      if (state.failPublish) throw new Error("YouTube upload failed: simulated");
      return "yt-video-1";
    },
  },
});

mock.module("./instagram", {
  namedExports: {
    publishInstagramReel: async (creds: unknown, options: Record<string, unknown>) => {
      state.igReels.push({ creds, options });
      if (state.failPublish) throw new Error("Instagram publish failed: simulated");
      return "ig-reel-1";
    },
  },
});

mock.module("./tiktok", {
  namedExports: {
    publishTikTokVideo: async (creds: unknown, options: Record<string, unknown>) => {
      state.tiktokPosts.push({ creds, options });
      if (state.failPublish) throw new Error("TikTok publish failed: simulated");
      return { publishId: "tt-publish-1", mode: options.mode ?? "inbox" };
    },
    refreshTikTokAccessToken: async (creds: Record<string, unknown>) => {
      state.tiktokRefreshes.push(creds);
      return {
        accessToken: "fresh-access",
        refreshToken: "rotated-refresh",
        expiresInSeconds: 86400,
      };
    },
  },
});

let mod: typeof import("./video-publish");

before(async () => {
  mod = await import("./video-publish");
});

const beats = [
  { role: "HOOK", line: "Hook!" },
  { role: "VALUE", line: "The finding." },
  { role: "CTA", line: "Follow" },
];

const hooks = [
  { text: "Weak hook", score: { total: 3 } },
  { text: "Strong hook", score: { total: 9 } },
];

function resetState() {
  state.script = { id: "script-1", orgId: "org-1", beats, hooks };
  state.account = null;
  state.video = { id: "video-1", orgId: "org-1", assetUrl: "https://cdn.example.com/v.mp4" };
  state.publications = new Map();
  state.fetchedAssets = [];
  state.ytUploads = [];
  state.igReels = [];
  state.tiktokPosts = [];
  state.tiktokRefreshes = [];
  state.credentialWrites = [];
  state.failPublish = false;
}

const YT_ACCOUNT = {
  id: "yt-account-1",
  platform: "YOUTUBE_SHORTS",
  credentials: { refreshToken: "REFRESH", clientId: "CLIENT", clientSecret: "SECRET" },
};
const IG_ACCOUNT = {
  id: "ig-account-1",
  platform: "INSTAGRAM",
  credentials: { accessToken: "TOKEN", igUserId: "17841400000000000" },
};
const TT_ACCOUNT = {
  id: "tt-account-1",
  platform: "TIKTOK",
  credentials: { accessToken: "TOKEN", openId: "open-id-1" },
};

test("publishes a Short: downloads the render, uploads it, records the Publication", async () => {
  resetState();
  state.account = YT_ACCOUNT;

  const result = await mod.publishScriptToYouTube("script-1", "yt-account-1");

  assert.equal(result.mode, "short");
  assert.equal(result.externalId, "yt-video-1");
  assert.deepEqual(state.fetchedAssets, ["https://cdn.example.com/v.mp4"]);
  assert.equal(state.ytUploads.length, 1);

  const options = state.ytUploads[0].options as { title: string; description: string };
  // Title is the highest-scoring hook, description is every beat's line.
  assert.equal(options.title, "Strong hook");
  assert.equal(options.description, "Hook!\n\nThe finding.\n\nFollow");

  const pub = state.publications.get(keyFor("video-1", "yt-account-1"));
  assert.equal(pub?.status, "PUBLISHED");
  assert.equal(pub?.externalId, "yt-video-1");
});

test("title/description overrides win over the hook and beats", async () => {
  resetState();
  state.account = YT_ACCOUNT;

  await mod.publishScriptToYouTube("script-1", "yt-account-1", {
    title: "Custom title",
    description: "Custom description",
    privacyStatus: "private",
    tags: ["health"],
  });

  const options = state.ytUploads[0].options as Record<string, unknown>;
  assert.equal(options.title, "Custom title");
  assert.equal(options.description, "Custom description");
  assert.equal(options.privacyStatus, "private");
  assert.deepEqual(options.tags, ["health"]);
});

test("refuses to publish a script with no rendered video, and writes no Publication", async () => {
  resetState();
  state.account = YT_ACCOUNT;
  state.video = null;

  await assert.rejects(
    () => mod.publishScriptToYouTube("script-1", "yt-account-1"),
    (error: Error) => {
      assert.ok(error instanceof mod.MissingVideoAssetError);
      assert.match(error.message, /no rendered video/);
      return true;
    }
  );

  assert.equal(state.publications.size, 0);
  assert.equal(state.ytUploads.length, 0);
});

test("refuses a pinned Video that has no assetUrl", async () => {
  resetState();
  state.account = YT_ACCOUNT;
  state.video = { id: "video-9", orgId: "org-1", assetUrl: null };

  await assert.rejects(
    () => mod.publishScriptToYouTube("script-1", "yt-account-1", { videoId: "video-9" }),
    mod.MissingVideoAssetError
  );
});

test("rejects a YouTube call against an Instagram account", async () => {
  resetState();
  state.account = IG_ACCOUNT;

  await assert.rejects(
    () => mod.publishScriptToYouTube("script-1", "ig-account-1"),
    /is not a YOUTUBE_SHORTS account/
  );
});

test("rejects an account with incomplete YouTube credentials", async () => {
  resetState();
  state.account = { ...YT_ACCOUNT, credentials: { refreshToken: "REFRESH" } };

  await assert.rejects(
    () => mod.publishScriptToYouTube("script-1", "yt-account-1"),
    /has no YOUTUBE_SHORTS credentials/
  );
});

test("marks the publication FAILED and rethrows when the upload fails", async () => {
  resetState();
  state.account = YT_ACCOUNT;
  state.failPublish = true;

  await assert.rejects(() => mod.publishScriptToYouTube("script-1", "yt-account-1"), /simulated/);

  const pub = state.publications.get(keyFor("video-1", "yt-account-1"));
  assert.equal(pub?.status, "FAILED");
});

test("skips re-uploading when the video is already PUBLISHED on that account", async () => {
  resetState();
  state.account = YT_ACCOUNT;

  const first = await mod.publishScriptToYouTube("script-1", "yt-account-1");
  const second = await mod.publishScriptToYouTube("script-1", "yt-account-1");

  assert.equal(state.ytUploads.length, 1);
  assert.equal(second.externalId, first.externalId);
  assert.equal(second.publicationId, first.publicationId);
});

test("publishes a Reel from the asset URL, captioned hook-first", async () => {
  resetState();
  state.account = IG_ACCOUNT;

  const result = await mod.publishScriptToInstagramReel("script-1", "ig-account-1", {
    shareToFeed: false,
  });

  assert.equal(result.mode, "reel");
  assert.equal(result.externalId, "ig-reel-1");
  // Instagram fetches the video itself — nothing is downloaded here.
  assert.deepEqual(state.fetchedAssets, []);

  const options = state.igReels[0].options as Record<string, unknown>;
  assert.equal(options.videoUrl, "https://cdn.example.com/v.mp4");
  assert.equal(options.caption, "Strong hook\n\nHook!\n\nThe finding.\n\nFollow");
  assert.equal(options.shareToFeed, false);
});

test("publishes to TikTok as an inbox draft by default", async () => {
  resetState();
  state.account = TT_ACCOUNT;

  const result = await mod.publishScriptToTikTok("script-1", "tt-account-1");

  assert.equal(result.mode, "draft");
  assert.equal(result.externalId, "tt-publish-1");
  assert.deepEqual(state.fetchedAssets, ["https://cdn.example.com/v.mp4"]);
  const options = state.tiktokPosts[0].options as Record<string, unknown>;
  assert.equal(options.mode, "inbox");
  assert.equal(options.title, "Strong hook\n\nHook!\n\nThe finding.\n\nFollow");
});

test('reports mode "direct" when TikTok is asked to really post', async () => {
  resetState();
  state.account = TT_ACCOUNT;

  const result = await mod.publishScriptToTikTok("script-1", "tt-account-1", {
    mode: "direct",
    privacyLevel: "SELF_ONLY",
  });

  assert.equal(result.mode, "direct");
  const options = state.tiktokPosts[0].options as Record<string, unknown>;
  assert.equal(options.mode, "direct");
  assert.equal(options.privacyLevel, "SELF_ONLY");
});

test("an account with only a pasted access token publishes without refreshing", async () => {
  resetState();
  state.account = TT_ACCOUNT;

  await mod.publishScriptToTikTok("script-1", "tt-account-1");

  assert.equal(state.tiktokRefreshes.length, 0);
  assert.equal(state.credentialWrites.length, 0);
  const creds = state.tiktokPosts[0].creds as Record<string, unknown>;
  assert.equal(creds.accessToken, "TOKEN");
});

test("an account with the OAuth triple refreshes first and stores the rotated tokens", async () => {
  resetState();
  state.account = {
    id: "tt-account-1",
    platform: "TIKTOK",
    credentials: {
      accessToken: "STALE",
      openId: "open-id-1",
      clientKey: "KEY",
      clientSecret: "SECRET",
      refreshToken: "old-refresh",
    },
  };

  await mod.publishScriptToTikTok("script-1", "tt-account-1");

  assert.equal(state.tiktokRefreshes.length, 1);
  assert.equal(state.tiktokRefreshes[0].refreshToken, "old-refresh");

  // The post uses the fresh token, not the stale stored one.
  const creds = state.tiktokPosts[0].creds as Record<string, unknown>;
  assert.equal(creds.accessToken, "fresh-access");

  // And the rotated pair is written back, or the next refresh would fail.
  assert.equal(state.credentialWrites.length, 1);
  assert.equal(state.credentialWrites[0].accessToken, "fresh-access");
  assert.equal(state.credentialWrites[0].refreshToken, "rotated-refresh");
  assert.equal(state.credentialWrites[0].openId, "open-id-1");
});

test("rejects a TikTok account with neither an access token nor a way to mint one", async () => {
  resetState();
  state.account = { id: "tt-account-1", platform: "TIKTOK", credentials: { openId: "open-id-1" } };

  await assert.rejects(
    () => mod.publishScriptToTikTok("script-1", "tt-account-1"),
    /has no TIKTOK credentials/
  );
});

test("falls back to the first beat when the script has no hooks", async () => {
  resetState();
  state.account = YT_ACCOUNT;
  state.script = { id: "script-1", orgId: "org-1", beats, hooks: [] };

  await mod.publishScriptToYouTube("script-1", "yt-account-1");

  const options = state.ytUploads[0].options as { title: string };
  assert.equal(options.title, "Hook!");
});

test("refuses a script with neither hooks nor beats", async () => {
  resetState();
  state.account = YT_ACCOUNT;
  state.script = { id: "script-1", orgId: "org-1", beats: [], hooks: [] };

  await assert.rejects(
    () => mod.publishScriptToYouTube("script-1", "yt-account-1"),
    /no hooks and no beats/
  );
});

test("findRenderedVideoForScript returns null when nothing is rendered", async () => {
  resetState();
  state.video = null;
  assert.equal(await mod.findRenderedVideoForScript("script-1"), null);
});
