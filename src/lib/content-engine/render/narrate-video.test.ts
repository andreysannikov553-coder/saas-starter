import { test, mock, before } from "node:test";
import assert from "node:assert/strict";
import type { TTSProvider, SynthesizeSpeechRequest, SynthesizedAudio } from "../tts/types";

/**
 * renderNarrationForScript talks to Prisma and to uploadRenderAsset
 * directly. This suite mocks "@/lib/db" and "../storage" (mutable state,
 * same pattern as the other integration suites) — there is no live
 * database or Supabase project in this sandbox. It proves the
 * orchestration wiring (script lookup -> narration -> video reuse/create
 * -> upload -> audioUrl persistence), not a real upload or database round
 * trip.
 */

interface FakeVideo {
  id: string;
  scriptId: string;
  status: string;
  audioUrl: string | null;
}

interface FakeState {
  script: { id: string; orgId: string; beats: { order: number; line: string }[] } | null;
  videos: FakeVideo[];
  uploadCalls: { path: string; contentType: string }[];
  uploadedUrl: string;
}

const state: FakeState = { script: null, videos: [], uploadCalls: [], uploadedUrl: "" };

let nextVideoId = 0;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      script: { findUnique: async () => state.script },
      video: {
        findFirst: async (args: { where: { scriptId: string; status: string } }) => {
          const matches = state.videos
            .filter((v) => v.scriptId === args.where.scriptId && v.status === args.where.status)
            .sort((a, b) => b.id.localeCompare(a.id));
          return matches[0] ?? null;
        },
        create: async (args: { data: { orgId: string; scriptId: string } }) => {
          const video: FakeVideo = {
            id: `video-${nextVideoId++}`,
            scriptId: args.data.scriptId,
            status: "QUEUED",
            audioUrl: null,
          };
          state.videos.push(video);
          return video;
        },
        update: async (args: { where: { id: string }; data: { audioUrl: string } }) => {
          const video = state.videos.find((v) => v.id === args.where.id);
          if (!video) throw new Error("video not found");
          video.audioUrl = args.data.audioUrl;
          return video;
        },
      },
    },
  },
});

mock.module("../storage", {
  namedExports: {
    uploadRenderAsset: async (options: { path: string; contentType: string }) => {
      state.uploadCalls.push({ path: options.path, contentType: options.contentType });
      return `${state.uploadedUrl}/${options.path}`;
    },
  },
});

let renderNarrationForScript: typeof import("./narrate-video").renderNarrationForScript;

before(async () => {
  ({ renderNarrationForScript } = await import("./narrate-video"));
});

function fakeProvider(): TTSProvider {
  return {
    id: "fake",
    async synthesizeSpeech(_request: SynthesizeSpeechRequest): Promise<SynthesizedAudio> {
      return { audio: Buffer.from("fake-audio"), mimeType: "audio/mpeg" };
    },
  };
}

function reset() {
  state.script = null;
  state.videos = [];
  state.uploadCalls = [];
  state.uploadedUrl = "https://fake.supabase.co/storage/public/content-engine-renders";
  nextVideoId = 0;
}

test("creates a new Video and persists audioUrl when none exists yet", async () => {
  reset();
  state.script = { id: "script-1", orgId: "org-1", beats: [{ order: 0, line: "Hook!" }] };

  const result = await renderNarrationForScript("script-1", {
    voiceId: "voice-1",
    provider: fakeProvider(),
  });

  assert.equal(state.videos.length, 1);
  assert.equal(result.videoId, state.videos[0].id);
  assert.equal(state.uploadCalls.length, 1);
  assert.equal(state.uploadCalls[0].path, `org-1/${result.videoId}/narration.mp3`);
  assert.equal(state.videos[0].audioUrl, result.audioUrl);
});

test("reuses an existing QUEUED Video for the same script instead of duplicating", async () => {
  reset();
  state.script = { id: "script-2", orgId: "org-1", beats: [{ order: 0, line: "Hook!" }] };
  state.videos.push({
    id: "video-existing",
    scriptId: "script-2",
    status: "QUEUED",
    audioUrl: null,
  });

  const result = await renderNarrationForScript("script-2", {
    voiceId: "voice-1",
    provider: fakeProvider(),
  });

  assert.equal(result.videoId, "video-existing");
  assert.equal(state.videos.length, 1);
  assert.equal(state.videos[0].audioUrl, result.audioUrl);
});

test("throws when the script does not exist", async () => {
  reset();

  await assert.rejects(
    () =>
      renderNarrationForScript("missing-script", { voiceId: "voice-1", provider: fakeProvider() }),
    /Script missing-script not found/
  );
});
