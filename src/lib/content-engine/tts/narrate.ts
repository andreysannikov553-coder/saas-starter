import { prisma } from "@/lib/db";
import { getTTSProvider } from "./index";
import type { TTSProvider } from "./types";

export interface NarrateScriptOptions {
  provider?: TTSProvider;
  /** ElevenLabs voice id (or equivalent for another provider) to narrate with. */
  voiceId: string;
  signal?: AbortSignal;
}

export interface NarrateScriptResult {
  scriptId: string;
  text: string;
  audio: Buffer;
  mimeType: string;
}

/**
 * Synthesizes one continuous narration track for a script's beats, in
 * reading order.
 *
 * Deliberately synthesizes the whole script as a single TTS call rather
 * than one call per beat: per-beat audio would need somewhere to live
 * (ScriptBeat has no audio column, and this pipeline has no storage/upload
 * wiring decided yet — see the Video/Publication models, which only ever
 * gained an `assetUrl` for a finished render), and a single call also gives
 * the TTS engine full-sentence context for prosody instead of stitching
 * clips at beat boundaries. Persisting the result (and building it into an
 * actual video with a Render Gate ffprobe check, per discovery doc section
 * "Render Gate") is the next stage once a storage provider is chosen — this
 * function only returns the audio bytes for a caller to place.
 */
export async function narrateScript(
  scriptId: string,
  options: NarrateScriptOptions
): Promise<NarrateScriptResult> {
  const script = await prisma.script.findUnique({
    where: { id: scriptId },
    include: { beats: { orderBy: { order: "asc" } } },
  });
  if (!script) {
    throw new Error(`Script ${scriptId} not found`);
  }
  if (script.beats.length === 0) {
    throw new Error(`Script ${scriptId} has no beats to narrate`);
  }

  const provider = options.provider ?? getTTSProvider();
  const text = buildNarrationText(script.beats);

  const { audio, mimeType } = await provider.synthesizeSpeech({
    text,
    voiceId: options.voiceId,
    signal: options.signal,
  });

  return { scriptId: script.id, text, audio, mimeType };
}

/** Joins beat lines into one narration script, in play order. */
export function buildNarrationText(beats: { order: number; line: string }[]): string {
  return [...beats]
    .sort((a, b) => a.order - b.order)
    .map((b) => b.line.trim())
    .filter(Boolean)
    .join("\n\n");
}
