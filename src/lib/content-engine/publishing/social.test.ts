import { test, mock, before } from "node:test";
import assert from "node:assert/strict";

/**
 * publishScriptToInstagram/publishScriptToThreads share one orchestrator
 * (doPublishSocial in social.ts) — mocks Prisma, the render/storage steps,
 * and both platform clients so this proves the wiring (lookup -> render ->
 * upload -> publish -> status update), not a real post or database.
 */

interface FakeState {
  script: Record<string, unknown> | null;
  account: Record<string, unknown> | null;
  publications: Map<string, Record<string, unknown>>;
  uploadCalls: { path: string }[];
  igCarouselCalls: unknown[];
  igSingleCalls: unknown[];
  threadsCarouselCalls: unknown[];
  failPublish: boolean;
}

const state: FakeState = {
  script: null,
  account: null,
  publications: new Map(),
  uploadCalls: [],
  igCarouselCalls: [],
  igSingleCalls: [],
  threadsCarouselCalls: [],
  failPublish: false,
};

function keyFor(videoId: string, platformAccountId: string) {
  return `${videoId}:${platformAccountId}`;
}

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      script: { findUnique: async () => state.script },
      platformAccount: { findUnique: async () => state.account },
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

mock.module("../render/narrate-video", {
  namedExports: {
    getOrCreateVideoForScript: async (scriptId: string) => `video-for-${scriptId}`,
  },
});

mock.module("../render/quote-card", {
  namedExports: {
    renderQuoteCard: async () => Buffer.from("fake-card"),
    renderCarouselSlides: async (beats: unknown[]) => beats.map(() => Buffer.from("fake-slide")),
  },
});

mock.module("../storage", {
  namedExports: {
    uploadRenderAsset: async (options: { path: string }) => {
      state.uploadCalls.push({ path: options.path });
      return `https://cdn.example.com/${options.path}`;
    },
  },
});

mock.module("./instagram", {
  namedExports: {
    publishInstagramCarousel: async (creds: unknown, options: unknown) => {
      state.igCarouselCalls.push({ creds, options });
      if (state.failPublish) throw new Error("Instagram publish failed: simulated");
      return "ig-post-1";
    },
    publishInstagramSinglePhoto: async (creds: unknown, options: unknown) => {
      state.igSingleCalls.push({ creds, options });
      if (state.failPublish) throw new Error("Instagram publish failed: simulated");
      return "ig-post-1";
    },
  },
});

mock.module("./threads", {
  namedExports: {
    publishThreadsCarousel: async (creds: unknown, options: unknown) => {
      state.threadsCarouselCalls.push({ creds, options });
      if (state.failPublish) throw new Error("Threads publish failed: simulated");
      return "threads-post-1";
    },
    publishThreadsSinglePhoto: async () => "threads-post-1",
  },
});

let publishScriptToInstagram: typeof import("./social").publishScriptToInstagram;
let publishScriptToThreads: typeof import("./social").publishScriptToThreads;

before(async () => {
  ({ publishScriptToInstagram, publishScriptToThreads } = await import("./social"));
});

function resetState() {
  state.script = null;
  state.account = null;
  state.publications = new Map();
  state.uploadCalls = [];
  state.igCarouselCalls = [];
  state.igSingleCalls = [];
  state.threadsCarouselCalls = [];
  state.failPublish = false;
}

const beats = [
  { role: "HOOK", line: "Hook!" },
  { role: "VALUE", line: "The finding." },
  { role: "CTA", line: "Follow" },
];

test("publishes a carousel to Instagram, uploading one slide per beat first", async () => {
  resetState();
  state.script = { id: "script-1", orgId: "org-1", beats, hooks: [] };
  state.account = {
    id: "ig-account-1",
    platform: "INSTAGRAM",
    credentials: { accessToken: "TOKEN", igUserId: "17841400000000000" },
  };

  const result = await publishScriptToInstagram("script-1", "ig-account-1");

  assert.equal(result.mode, "carousel");
  assert.equal(result.externalId, "ig-post-1");
  assert.equal(state.uploadCalls.length, 3);
  assert.equal(state.igCarouselCalls.length, 1);
  const call = state.igCarouselCalls[0] as { options: { imageUrls: string[] } };
  assert.equal(call.options.imageUrls.length, 3);
  const pub = state.publications.get(keyFor("video-for-script-1", "ig-account-1"));
  assert.equal(pub?.status, "PUBLISHED");
});

test("falls back to a single photo when the script has fewer than 2 beats", async () => {
  resetState();
  state.script = {
    id: "script-2",
    orgId: "org-1",
    beats: [{ role: "HOOK", line: "Only one" }],
    hooks: [],
  };
  state.account = {
    id: "ig-account-1",
    platform: "INSTAGRAM",
    credentials: { accessToken: "TOKEN", igUserId: "17841400000000000" },
  };

  const result = await publishScriptToInstagram("script-2", "ig-account-1");

  assert.equal(result.mode, "photo");
  assert.equal(state.igSingleCalls.length, 1);
  assert.equal(state.igCarouselCalls.length, 0);
});

test("publishes a carousel to Threads through the same orchestrator", async () => {
  resetState();
  state.script = { id: "script-3", orgId: "org-1", beats, hooks: [] };
  state.account = {
    id: "threads-account-1",
    platform: "THREADS",
    credentials: { accessToken: "TOKEN", threadsUserId: "9999999999" },
  };

  const result = await publishScriptToThreads("script-3", "threads-account-1");

  assert.equal(result.mode, "carousel");
  assert.equal(result.externalId, "threads-post-1");
  assert.equal(state.threadsCarouselCalls.length, 1);
});

test("rejects an Instagram call against a Threads account", async () => {
  resetState();
  state.script = { id: "script-4", orgId: "org-1", beats, hooks: [] };
  state.account = { id: "threads-account-1", platform: "THREADS", credentials: {} };

  await assert.rejects(
    () => publishScriptToInstagram("script-4", "threads-account-1"),
    /is not a INSTAGRAM account/
  );
});

test("rejects an account with no Instagram credentials", async () => {
  resetState();
  state.script = { id: "script-5", orgId: "org-1", beats, hooks: [] };
  state.account = { id: "ig-account-2", platform: "INSTAGRAM", credentials: {} };

  await assert.rejects(
    () => publishScriptToInstagram("script-5", "ig-account-2"),
    /has no INSTAGRAM credentials/
  );
});

test("marks the publication FAILED and rethrows when the platform call fails", async () => {
  resetState();
  state.script = { id: "script-6", orgId: "org-1", beats, hooks: [] };
  state.account = {
    id: "ig-account-1",
    platform: "INSTAGRAM",
    credentials: { accessToken: "TOKEN", igUserId: "id" },
  };
  state.failPublish = true;

  await assert.rejects(() => publishScriptToInstagram("script-6", "ig-account-1"), /simulated/);

  const pub = state.publications.get(keyFor("video-for-script-6", "ig-account-1"));
  assert.equal(pub?.status, "FAILED");
});

test("skips publishing when already PUBLISHED (idempotent re-run)", async () => {
  resetState();
  state.script = { id: "script-7", orgId: "org-1", beats, hooks: [] };
  state.account = {
    id: "ig-account-1",
    platform: "INSTAGRAM",
    credentials: { accessToken: "TOKEN", igUserId: "id" },
  };

  const first = await publishScriptToInstagram("script-7", "ig-account-1");
  const second = await publishScriptToInstagram("script-7", "ig-account-1");

  assert.equal(state.igCarouselCalls.length, 1);
  assert.equal(first.externalId, second.externalId);
  assert.equal(second.publicationId, first.publicationId);
});
