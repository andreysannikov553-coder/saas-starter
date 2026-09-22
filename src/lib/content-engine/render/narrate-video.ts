import { prisma } from "@/lib/db";
import { narrateScript, type NarrateScriptOptions } from "../tts";
import { uploadRenderAsset } from "../storage";
import { withStageLog } from "../observability/logger";

export interface RenderNarrationOptions extends Omit<NarrateScriptOptions, "provider"> {
  provider?: NarrateScriptOptions["provider"];
}

export interface RenderNarrationResult {
  videoId: string;
  audioUrl: string;
}

/**
 * Synthesizes a script's narration and persists it as the audio track of a
 * Video row — the first half of turning a Script into a publishable Video.
 *
 * Reuses an existing QUEUED Video for this script if one exists (so re-runs
 * don't pile up duplicate rows); otherwise creates one. Does NOT touch
 * `VideoStatus` or `assetUrl` — this only fills `audioUrl`. The video
 * remains QUEUED until an assembly stage (ffmpeg compositing narration with
 * visuals, then the Render Gate ffprobe checks from the discovery doc) sets
 * `assetUrl` and moves status to READY. That stage isn't built yet — see
 * PR #7's notes on why (no ffmpeg in this sandbox to test it against).
 */
export async function renderNarrationForScript(
  scriptId: string,
  options: RenderNarrationOptions
): Promise<RenderNarrationResult> {
  return withStageLog(
    "narrate-video",
    { scriptId },
    async () => {
      const script = await prisma.script.findUnique({ where: { id: scriptId } });
      if (!script) {
        throw new Error(`Script ${scriptId} not found`);
      }

      const narration = await narrateScript(scriptId, options);

      const video = await prisma.video.findFirst({
        where: { scriptId: script.id, status: "QUEUED" },
        orderBy: { createdAt: "desc" },
      });

      const videoId =
        video?.id ??
        (
          await prisma.video.create({
            data: { orgId: script.orgId, scriptId: script.id },
          })
        ).id;

      const audioUrl = await uploadRenderAsset({
        path: `${script.orgId}/${videoId}/narration.mp3`,
        data: narration.audio,
        contentType: narration.mimeType,
      });

      await prisma.video.update({ where: { id: videoId }, data: { audioUrl } });

      return { videoId, audioUrl };
    },
    (result) => ({ ...result })
  );
}
