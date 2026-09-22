import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { ElevenLabsTTSProvider } from "./elevenlabs";

/**
 * No real ElevenLabs API key in this sandbox, so these tests mock the
 * global fetch the client calls into. They prove the request shape and
 * response handling, not that a real API key/voice actually synthesizes
 * anything.
 */

test("synthesizeSpeech posts to the text-to-speech endpoint and returns audio bytes", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: unknown;
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = mock.fn(async (url: unknown, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return {
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("fake-mp3-bytes").buffer,
    } as Response;
  }) as unknown as typeof fetch;

  const provider = new ElevenLabsTTSProvider("api-key-123");
  const result = await provider.synthesizeSpeech({ text: "Hello world", voiceId: "voice-abc" });

  assert.equal(capturedUrl, "https://api.elevenlabs.io/v1/text-to-speech/voice-abc");
  assert.equal((capturedInit?.headers as Record<string, string>)["xi-api-key"], "api-key-123");
  assert.equal(JSON.parse(capturedInit?.body as string).text, "Hello world");
  assert.equal(result.mimeType, "audio/mpeg");
  assert.equal(result.audio.toString(), "fake-mp3-bytes");

  globalThis.fetch = originalFetch;
});

test("synthesizeSpeech throws with the response body on a non-ok response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () => {
    return {
      ok: false,
      status: 401,
      text: async () => "invalid_api_key",
    } as Response;
  }) as unknown as typeof fetch;

  const provider = new ElevenLabsTTSProvider("bad-key");
  await assert.rejects(
    () => provider.synthesizeSpeech({ text: "Hi", voiceId: "voice-abc" }),
    /ElevenLabs text-to-speech failed \(401\): invalid_api_key/
  );

  globalThis.fetch = originalFetch;
});
