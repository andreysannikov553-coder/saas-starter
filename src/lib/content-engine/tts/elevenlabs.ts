import { NonRetryableError, withRetry } from "../observability/retry";
import type { SynthesizeSpeechRequest, SynthesizedAudio, TTSProvider } from "./types";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";

/**
 * ElevenLabs TTS implementation. Uses the plain REST API via `fetch` (no
 * SDK dependency) — same approach as the Europe PMC client — since this is
 * a single endpoint and a full SDK would be a lot of surface for one call.
 */
export class ElevenLabsTTSProvider implements TTSProvider {
  readonly id = "elevenlabs";

  constructor(private readonly apiKey: string) {}

  async synthesizeSpeech(request: SynthesizeSpeechRequest): Promise<SynthesizedAudio> {
    const response = await withRetry(
      async () => {
        const res = await fetch(
          `${ELEVENLABS_API_BASE}/v1/text-to-speech/${encodeURIComponent(request.voiceId)}`,
          {
            method: "POST",
            headers: {
              "xi-api-key": this.apiKey,
              "Content-Type": "application/json",
              Accept: "audio/mpeg",
            },
            body: JSON.stringify({
              text: request.text,
              model_id: "eleven_multilingual_v2",
            }),
            signal: request.signal,
          }
        );

        if (!res.ok) {
          // 4xx (bad request, auth, invalid voiceId) won't succeed on retry — only
          // retry transient 5xx/network failures, not a request that's wrong as-is.
          if (res.status < 500) {
            const detail = await res.text().catch(() => res.statusText);
            throw new NonRetryableError(
              `ElevenLabs text-to-speech failed (${res.status}): ${detail}`
            );
          }
          const detail = await res.text().catch(() => res.statusText);
          throw new Error(`ElevenLabs text-to-speech failed (${res.status}): ${detail}`);
        }

        return res;
      },
      {
        shouldRetry: (error) =>
          !(error instanceof NonRetryableError) &&
          !(error instanceof DOMException && error.name === "AbortError"),
      }
    );

    const audio = Buffer.from(await response.arrayBuffer());
    return { audio, mimeType: "audio/mpeg" };
  }
}
