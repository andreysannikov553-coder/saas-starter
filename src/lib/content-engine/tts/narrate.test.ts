import { test, mock, before } from "node:test";
import assert from "node:assert/strict";
import type { TTSProvider, SynthesizeSpeechRequest, SynthesizedAudio } from "./types";

// buildNarrationText is pure and doesn't touch "@/lib/db", but it's still
// imported dynamically (in `before`, below, alongside narrateScript) rather
// than statically here — a static import of anything from "./narrate" would
// be hoisted and evaluated before mock.module runs, binding narrateScript's
// prisma import to the real "@/lib/db" instead of the mock.
let buildNarrationText: typeof import("./narrate").buildNarrationText;

test("buildNarrationText joins beats in order, not input order", () => {
  const text = buildNarrationText([
    { order: 1, line: "Second line" },
    { order: 0, line: "First line" },
  ]);
  assert.equal(text, "First line\n\nSecond line");
});

test("buildNarrationText skips blank lines", () => {
  const text = buildNarrationText([
    { order: 0, line: "First line" },
    { order: 1, line: "   " },
    { order: 2, line: "Third line" },
  ]);
  assert.equal(text, "First line\n\nThird line");
});

test("buildNarrationText handles a single beat", () => {
  const text = buildNarrationText([{ order: 0, line: "Only line" }]);
  assert.equal(text, "Only line");
});

test("buildNarrationText handles an empty array", () => {
  const text = buildNarrationText([]);
  assert.equal(text, "");
});

/**
 * narrateScript talks to Prisma directly. This suite mocks "@/lib/db" once
 * up front (mutable state, same pattern as the other integration suites) —
 * there is no live database or ElevenLabs API key in this sandbox. It
 * proves the orchestration wiring (lookup -> text build -> TTS call), not a
 * real database round trip or a real synthesized audio file.
 */

interface FakeState {
  script: { id: string; beats: { order: number; line: string }[] } | null;
}

const state: FakeState = { script: null };

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      script: { findUnique: async () => state.script },
    },
  },
});

let narrateScript: typeof import("./narrate").narrateScript;

before(async () => {
  ({ narrateScript, buildNarrationText } = await import("./narrate"));
});

function fakeProvider(audio: SynthesizedAudio): TTSProvider {
  return {
    id: "fake",
    async synthesizeSpeech(_request: SynthesizeSpeechRequest): Promise<SynthesizedAudio> {
      return audio;
    },
  };
}

test("narrateScript builds narration text and returns synthesized audio", async () => {
  state.script = {
    id: "script-1",
    beats: [
      { order: 0, line: "Hook!" },
      { order: 1, line: "Payoff." },
    ],
  };

  const fakeAudio = { audio: Buffer.from("fake-audio-bytes"), mimeType: "audio/mpeg" };
  const result = await narrateScript("script-1", {
    voiceId: "voice-1",
    provider: fakeProvider(fakeAudio),
  });

  assert.equal(result.scriptId, "script-1");
  assert.equal(result.text, "Hook!\n\nPayoff.");
  assert.equal(result.mimeType, "audio/mpeg");
  assert.equal(result.audio.toString(), "fake-audio-bytes");
});

test("narrateScript throws when the script does not exist", async () => {
  state.script = null;

  await assert.rejects(
    () =>
      narrateScript("missing-script", {
        voiceId: "voice-1",
        provider: fakeProvider({ audio: Buffer.from(""), mimeType: "audio/mpeg" }),
      }),
    /Script missing-script not found/
  );
});

test("narrateScript throws when the script has no beats", async () => {
  state.script = { id: "script-2", beats: [] };

  await assert.rejects(
    () =>
      narrateScript("script-2", {
        voiceId: "voice-1",
        provider: fakeProvider({ audio: Buffer.from(""), mimeType: "audio/mpeg" }),
      }),
    /Script script-2 has no beats to narrate/
  );
});
