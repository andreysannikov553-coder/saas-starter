import { test, mock, before } from "node:test";
import assert from "node:assert/strict";

/**
 * publishVideoToTelegram talks to Prisma directly and calls the real
 * Telegram client (no injectable provider like the LLM stages). This suite
 * mocks "@/lib/db" once up front (mutable state, same pattern as the
 * scripts/hooks suites) and mocks "./telegram" so no real Bot API call
 * happens. There is no live database or Telegram bot in this sandbox; this
 * proves the orchestration wiring (lookup -> upsert -> send -> status
 * update), not a real Telegram post or database round trip.
 */

interface FakeState {
  video: Record<string, unknown> | null;
  account: Record<string, unknown> | null;
  publications: Map<string, Record<string, unknown>>;
  sendVideoCalls: unknown[];
  sendMessageCalls: unknown[];
  failSend: boolean;
}

const state: FakeState = {
  video: null,
  account: null,
  publications: new Map(),
  sendVideoCalls: [],
  sendMessageCalls: [],
  failSend: false,
};

function keyFor(videoId: string, platformAccountId: string) {
  return `${videoId}:${platformAccountId}`;
}

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      video: { findUnique: async () => state.video },
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

mock.module("./telegram", {
  namedExports: {
    sendTelegramVideo: async (options: unknown) => {
      state.sendVideoCalls.push(options);
      if (state.failSend) throw new Error("Telegram sendVideo failed: simulated");
      return { messageId: "video-msg-1" };
    },
    sendTelegramMessage: async (options: unknown) => {
      state.sendMessageCalls.push(options);
      if (state.failSend) throw new Error("Telegram sendMessage failed: simulated");
      return { messageId: "text-msg-1" };
    },
  },
});

let publishVideoToTelegram: typeof import("./publish").publishVideoToTelegram;
let buildTelegramPublishPayload: typeof import("./publish").buildTelegramPublishPayload;

before(async () => {
  ({ publishVideoToTelegram, buildTelegramPublishPayload } = await import("./publish"));
});

function resetState() {
  state.video = null;
  state.account = null;
  state.publications = new Map();
  state.sendVideoCalls = [];
  state.sendMessageCalls = [];
  state.failSend = false;
}

test("publishes as video when the Video has an assetUrl", async () => {
  resetState();
  state.video = {
    id: "video-1",
    orgId: "org-1",
    assetUrl: "https://example.com/v.mp4",
    script: {
      beats: [
        { role: "HOOK", line: "Hook!" },
        { role: "CTA", line: "Subscribe" },
      ],
    },
  };
  state.account = {
    id: "account-1",
    platform: "TELEGRAM",
    handle: "@mychannel",
    credentials: { botToken: "TOKEN123" },
  };

  const result = await publishVideoToTelegram("video-1", "account-1");

  assert.equal(result.mode, "video");
  assert.equal(result.externalId, "video-msg-1");
  assert.equal(state.sendVideoCalls.length, 1);
  assert.equal(state.sendMessageCalls.length, 0);
  const pub = state.publications.get(keyFor("video-1", "account-1"));
  assert.equal(pub?.status, "PUBLISHED");
});

test("falls back to text when the Video has no assetUrl", async () => {
  resetState();
  state.video = {
    id: "video-2",
    orgId: "org-1",
    assetUrl: null,
    script: {
      beats: [
        { role: "HOOK", line: "Hook!" },
        { role: "CTA", line: "Subscribe" },
      ],
    },
  };
  state.account = {
    id: "account-1",
    platform: "TELEGRAM",
    handle: "@mychannel",
    credentials: { botToken: "TOKEN123" },
  };

  const result = await publishVideoToTelegram("video-2", "account-1");

  assert.equal(result.mode, "text");
  assert.equal(state.sendMessageCalls.length, 1);
  assert.equal(state.sendVideoCalls.length, 0);
});

test("rejects a non-Telegram platform account", async () => {
  resetState();
  state.video = { id: "video-3", orgId: "org-1", assetUrl: null, script: { beats: [] } };
  state.account = { id: "account-2", platform: "INSTAGRAM", handle: "x", credentials: {} };

  await assert.rejects(
    () => publishVideoToTelegram("video-3", "account-2"),
    /is not a Telegram account/
  );
});

test("rejects an account with no bot token", async () => {
  resetState();
  state.video = { id: "video-4", orgId: "org-1", assetUrl: null, script: { beats: [] } };
  state.account = { id: "account-3", platform: "TELEGRAM", handle: "@x", credentials: {} };

  await assert.rejects(
    () => publishVideoToTelegram("video-4", "account-3"),
    /has no Telegram bot token/
  );
});

test("marks the publication FAILED and rethrows when the send fails", async () => {
  resetState();
  state.video = {
    id: "video-5",
    orgId: "org-1",
    assetUrl: null,
    script: { beats: [{ role: "HOOK", line: "Hook!" }] },
  };
  state.account = {
    id: "account-1",
    platform: "TELEGRAM",
    handle: "@mychannel",
    credentials: { botToken: "TOKEN123" },
  };
  state.failSend = true;

  await assert.rejects(() => publishVideoToTelegram("video-5", "account-1"), /simulated/);

  const pub = state.publications.get(keyFor("video-5", "account-1"));
  assert.equal(pub?.status, "FAILED");
});

test("re-running for the same video+account upserts instead of duplicating", async () => {
  resetState();
  state.video = {
    id: "video-6",
    orgId: "org-1",
    assetUrl: null,
    script: { beats: [{ role: "HOOK", line: "Hook!" }] },
  };
  state.account = {
    id: "account-1",
    platform: "TELEGRAM",
    handle: "@mychannel",
    credentials: { botToken: "TOKEN123" },
  };

  const first = await publishVideoToTelegram("video-6", "account-1");
  const second = await publishVideoToTelegram("video-6", "account-1");

  assert.equal(first.publicationId, second.publicationId);
  assert.equal(state.publications.size, 1);
});

test("skips sending when the video is already PUBLISHED (regression: no real re-send on retry)", async () => {
  resetState();
  state.video = {
    id: "video-7",
    orgId: "org-1",
    assetUrl: null,
    script: { beats: [{ role: "HOOK", line: "Hook!" }] },
  };
  state.account = {
    id: "account-1",
    platform: "TELEGRAM",
    handle: "@mychannel",
    credentials: { botToken: "TOKEN123" },
  };

  const first = await publishVideoToTelegram("video-7", "account-1");
  const second = await publishVideoToTelegram("video-7", "account-1");

  assert.equal(state.sendMessageCalls.length, 1);
  assert.equal(first.externalId, second.externalId);
  assert.equal(second.publicationId, first.publicationId);
});

test("still resends when the previous attempt is FAILED, not PUBLISHED", async () => {
  resetState();
  state.video = {
    id: "video-8",
    orgId: "org-1",
    assetUrl: null,
    script: { beats: [{ role: "HOOK", line: "Hook!" }] },
  };
  state.account = {
    id: "account-1",
    platform: "TELEGRAM",
    handle: "@mychannel",
    credentials: { botToken: "TOKEN123" },
  };
  state.failSend = true;

  await assert.rejects(() => publishVideoToTelegram("video-8", "account-1"));

  state.failSend = false;
  const result = await publishVideoToTelegram("video-8", "account-1");

  assert.equal(state.sendMessageCalls.length, 2);
  assert.equal(result.externalId, "text-msg-1");
});

test("buildTelegramPublishPayload builds the video payload without sending or writing", async () => {
  resetState();
  state.video = {
    id: "video-9",
    orgId: "org-1",
    assetUrl: "https://example.com/v.mp4",
    script: {
      beats: [
        { role: "HOOK", line: "Hook!" },
        { role: "CTA", line: "Subscribe" },
      ],
    },
  };
  state.account = {
    id: "account-1",
    platform: "TELEGRAM",
    handle: "@mychannel",
    credentials: { botToken: "TOKEN123" },
  };

  const payload = await buildTelegramPublishPayload("video-9", "account-1");

  assert.deepEqual(payload, {
    mode: "video",
    chatId: "@mychannel",
    caption: "Hook!\n\nSubscribe",
    videoUrl: "https://example.com/v.mp4",
  });
  assert.equal(state.sendVideoCalls.length, 0);
  assert.equal(state.sendMessageCalls.length, 0);
  assert.equal(state.publications.size, 0);
});

test("buildTelegramPublishPayload builds the text payload when there's no assetUrl yet", async () => {
  resetState();
  state.video = {
    id: "video-10",
    orgId: "org-1",
    assetUrl: null,
    script: { beats: [{ role: "HOOK", line: "Hook only" }] },
  };
  state.account = {
    id: "account-1",
    platform: "TELEGRAM",
    handle: "@mychannel",
    credentials: { botToken: "TOKEN123" },
  };

  const payload = await buildTelegramPublishPayload("video-10", "account-1");

  assert.deepEqual(payload, { mode: "text", chatId: "@mychannel", caption: "Hook only" });
  assert.equal(state.sendMessageCalls.length, 0);
  assert.equal(state.publications.size, 0);
});

test("buildTelegramPublishPayload still validates the account and bot token", async () => {
  resetState();
  state.video = { id: "video-11", orgId: "org-1", assetUrl: null, script: { beats: [] } };
  state.account = { id: "account-3", platform: "TELEGRAM", handle: "@x", credentials: {} };

  await assert.rejects(
    () => buildTelegramPublishPayload("video-11", "account-3"),
    /has no Telegram bot token/
  );
});
