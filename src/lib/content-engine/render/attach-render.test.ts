import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { VideoProbe } from "./attach-render";

/**
 * attachRenderedVideo talks to Prisma and uploadRenderAsset; both are mocked
 * (same pattern as narrate-video.test.ts) — no database or Supabase here.
 * The gate and probe parsing are pure and tested directly.
 */

interface FakeVideo {
  id: string;
  scriptId: string;
  status: string;
  assetUrl: string | null;
  durationSec: number | null;
  published: boolean;
}

const state = {
  script: null as { id: string; orgId: string } | null,
  videos: [] as FakeVideo[],
  uploads: [] as { path: string; contentType: string; bytes: number }[],
  lastWhere: null as unknown,
};
let nextId = 0;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      script: { findUnique: async () => state.script },
      video: {
        findFirst: async (args: { where: { scriptId: string; status: { in: string[] } } }) => {
          state.lastWhere = args.where;
          const matches = state.videos.filter(
            (v) =>
              v.scriptId === args.where.scriptId &&
              args.where.status.in.includes(v.status) &&
              !v.published
          );
          return matches[matches.length - 1] ?? null;
        },
        create: async (args: { data: { orgId: string; scriptId: string } }) => {
          const video: FakeVideo = {
            id: `video-${nextId++}`,
            scriptId: args.data.scriptId,
            status: "QUEUED",
            assetUrl: null,
            durationSec: null,
            published: false,
          };
          state.videos.push(video);
          return video;
        },
        update: async (args: { where: { id: string }; data: Partial<FakeVideo> }) => {
          const video = state.videos.find((v) => v.id === args.where.id);
          if (!video) throw new Error("video not found");
          Object.assign(video, args.data);
          return video;
        },
      },
    },
  },
});

mock.module("../storage", {
  namedExports: {
    uploadRenderAsset: async (opts: { path: string; data: Buffer; contentType: string }) => {
      state.uploads.push({
        path: opts.path,
        contentType: opts.contentType,
        bytes: opts.data.length,
      });
      return `https://storage.test/${opts.path}`;
    },
  },
});

let mod: typeof import("./attach-render");
before(async () => {
  mod = await import("./attach-render");
});

beforeEach(() => {
  state.script = { id: "script-1", orgId: "org-1" };
  state.videos = [];
  state.uploads = [];
  state.lastWhere = null;
});

const good: VideoProbe = {
  width: 1080,
  height: 1920,
  durationSec: 41.6,
  videoCodec: "h264",
  audioCodec: "aac",
};

test("checkRenderGate passes a vertical h264/aac render within Shorts length", () => {
  assert.deepEqual(mod.checkRenderGate(good), []);
});

test("checkRenderGate names every problem with a bad render", () => {
  const problems = mod.checkRenderGate({
    width: 1080,
    height: 1080,
    durationSec: 200,
    videoCodec: "hevc",
    audioCodec: null,
  });
  assert.equal(problems.length, 4);
  assert.match(problems.join("\n"), /1080x1080/);
  assert.match(problems.join("\n"), /hevc/);
  assert.match(problems.join("\n"), /no audio track/);
  assert.match(problems.join("\n"), /200\.0s/);
});

test("parseProbe reads ffprobe JSON, including a missing audio stream", () => {
  const probe = mod.parseProbe(
    JSON.stringify({
      streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920 }],
      format: { duration: "12.480000" },
    })
  );
  assert.deepEqual(probe, {
    width: 1080,
    height: 1920,
    durationSec: 12.48,
    videoCodec: "h264",
    audioCodec: null,
  });
});

test("attachRenderedVideo uploads to the video's path and marks it READY with an assetUrl", async () => {
  state.videos.push({
    id: "narrated",
    scriptId: "script-1",
    status: "QUEUED",
    assetUrl: null,
    durationSec: null,
    published: false,
  });

  const result = await mod.attachRenderedVideo("script-1", Buffer.from("mp4"), good);

  assert.deepEqual(result, {
    videoId: "narrated",
    assetUrl: "https://storage.test/org-1/narrated/video.mp4",
    durationSec: 42,
  });
  assert.deepEqual(state.uploads, [
    { path: "org-1/narrated/video.mp4", contentType: "video/mp4", bytes: 3 },
  ]);
  assert.equal(state.videos[0].status, "READY");
  assert.equal(state.videos[0].assetUrl, result.assetUrl);
  assert.deepEqual((state.lastWhere as { publications: unknown }).publications, {
    none: { status: "PUBLISHED" },
  });
});

test("a re-render reuses the unpublished READY video instead of adding a row", async () => {
  await mod.attachRenderedVideo("script-1", Buffer.from("one"), good);
  await mod.attachRenderedVideo("script-1", Buffer.from("two!"), good);

  assert.equal(state.videos.length, 1);
  assert.equal(state.uploads[0].path, state.uploads[1].path);
});

test("a video that was already published is never overwritten", async () => {
  state.videos.push({
    id: "live",
    scriptId: "script-1",
    status: "READY",
    assetUrl: "https://storage.test/org-1/live/video.mp4",
    durationSec: 40,
    published: true,
  });

  const result = await mod.attachRenderedVideo("script-1", Buffer.from("new"), good);

  assert.notEqual(result.videoId, "live");
  assert.equal(
    state.videos.find((v) => v.id === "live")?.assetUrl,
    "https://storage.test/org-1/live/video.mp4"
  );
});

test("a render that fails the gate is marked RENDER_GATE_FAILED and never uploaded", async () => {
  await assert.rejects(
    mod.attachRenderedVideo("script-1", Buffer.from("mp4"), { ...good, audioCodec: null }),
    (err: Error) => err.name === "RenderGateError" && /no audio track/.test(err.message)
  );
  assert.equal(state.uploads.length, 0);
  assert.equal(state.videos[0].status, "RENDER_GATE_FAILED");
  assert.equal(state.videos[0].assetUrl, null);
});

test("attachRenderedVideo fails clearly for an unknown script", async () => {
  state.script = null;
  await assert.rejects(
    mod.attachRenderedVideo("missing", Buffer.from("mp4"), good),
    /Script missing not found/
  );
});
