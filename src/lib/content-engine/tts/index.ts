import { env } from "@/env.mjs";
import { ElevenLabsTTSProvider } from "./elevenlabs";
import type { TTSProvider } from "./types";

export * from "./types";
export * from "./narrate";

/**
 * Factory for the configured TTS provider. Only one implementation exists
 * today (ElevenLabs); this stays a factory rather than a direct import so
 * the render pipeline never depends on a concrete vendor, matching
 * `getLLMProvider()`'s shape.
 */
export function getTTSProvider(): TTSProvider {
  if (!env.ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY is not set — cannot construct a TTS provider");
  }
  return new ElevenLabsTTSProvider(env.ELEVENLABS_API_KEY);
}
