/**
 * Provider-agnostic text-to-speech interface, mirroring `LLMProvider`
 * (src/lib/content-engine/llm/types.ts) so the render pipeline can swap TTS
 * vendors — the discovery doc calls this out explicitly (section 15) as one
 * of four provider boundaries (TTSProvider, VideoProvider, PublishTarget,
 * SearchProvider) needed because the generation-tooling market reshuffles
 * every couple of months; the moat is switching vendors in a day, not a
 * month.
 */
export interface TTSProvider {
  readonly id: string;

  /** Synthesizes one line of narration and returns the raw audio bytes. */
  synthesizeSpeech(request: SynthesizeSpeechRequest): Promise<SynthesizedAudio>;
}

export interface SynthesizeSpeechRequest {
  text: string;
  voiceId: string;
  signal?: AbortSignal;
}

export interface SynthesizedAudio {
  audio: Buffer;
  mimeType: string;
}
