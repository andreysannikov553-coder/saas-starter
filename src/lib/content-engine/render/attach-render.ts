import { spawn } from "node:child_process";
import { prisma } from "@/lib/db";
import { uploadRenderAsset } from "../storage";
import { withStageLog } from "../observability/logger";

/**
 * The last step of a render: checks a finished MP4 against what the video
 * platforms accept, uploads it to the renders bucket and records it as the
 * script's Video.assetUrl — the field YouTube Shorts, Instagram Reels and
 * TikTok publish from (publishing/video-publish.ts). Before this existed,
 * renders stayed a local file and publish-all reported those platforms as
 * SKIPPED.
 */

export interface VideoProbe {
  width: number;
  height: number;
  durationSec: number;
  videoCodec: string | null;
  audioCodec: string | null;
}

/**
 * Render Gate limits. Vertical 9:16 because every target is a vertical
 * surface; 180s is YouTube Shorts' ceiling and the tightest of the three
 * (Reels and TikTok allow longer). H.264 + AAC is the one combination all
 * three ingest without a server-side re-encode.
 */
export const RENDER_GATE = {
  minSeconds: 3,
  maxSeconds: 180,
  videoCodec: "h264",
  audioCodec: "aac",
} as const;

/** Every reason a render may not be published; empty means it passes. */
export function checkRenderGate(probe: VideoProbe): string[] {
  const problems: string[] = [];

  if (probe.width <= 0 || probe.height <= 0) {
    problems.push("no video stream");
  } else if (probe.width * 16 !== probe.height * 9) {
    problems.push(`frame is ${probe.width}x${probe.height}, not vertical 9:16`);
  }
  if (probe.videoCodec !== RENDER_GATE.videoCodec) {
    problems.push(
      `video codec is ${probe.videoCodec ?? "missing"}, expected ${RENDER_GATE.videoCodec}`
    );
  }
  if (probe.audioCodec !== RENDER_GATE.audioCodec) {
    problems.push(
      probe.audioCodec
        ? `audio codec is ${probe.audioCodec}, expected ${RENDER_GATE.audioCodec}`
        : "no audio track — a silent Reel is a broken narration, not a format choice"
    );
  }
  if (
    !(probe.durationSec >= RENDER_GATE.minSeconds && probe.durationSec <= RENDER_GATE.maxSeconds)
  ) {
    problems.push(
      `duration is ${probe.durationSec.toFixed(1)}s, must be ${RENDER_GATE.minSeconds}-${RENDER_GATE.maxSeconds}s`
    );
  }
  return problems;
}

export class RenderGateError extends Error {
  constructor(
    readonly videoId: string,
    readonly problems: string[]
  ) {
    super(`Render ${videoId} failed the Render Gate: ${problems.join("; ")}`);
    this.name = "RenderGateError";
  }
}

/** Reads the facts the Render Gate needs from a local video file with ffprobe. */
export async function probeVideoFile(filePath: string): Promise<VideoProbe> {
  const out = await runFfprobe([
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,codec_name,width,height:format=duration",
    "-of",
    "json",
    filePath,
  ]);
  return parseProbe(out);
}

/** Exported for tests: ffprobe's JSON output to a VideoProbe. */
export function parseProbe(json: string): VideoProbe {
  const data = JSON.parse(json) as {
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[];
    format?: { duration?: string };
  };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    durationSec: Number(data.format?.duration ?? 0) || 0,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
  };
}

export interface AttachRenderedVideoResult {
  videoId: string;
  assetUrl: string;
  durationSec: number;
}

/**
 * Gates, uploads and records a rendered MP4 for a script.
 *
 * Reuses the script's newest not-yet-published Video (the QUEUED row
 * narration may already have created, or a READY one from an earlier render)
 * so a re-render replaces the file at the same storage path instead of piling
 * up rows. A video already published anywhere is never reused: publishing
 * does not move Video.status past READY, so "has a PUBLISHED Publication" is
 * the check, and overwriting that file would change what already went out.
 *
 * A render that fails the gate marks the Video RENDER_GATE_FAILED and throws
 * without uploading, so publish-all keeps skipping it rather than posting a
 * broken file.
 */
export async function attachRenderedVideo(
  scriptId: string,
  mp4: Buffer,
  probe: VideoProbe
): Promise<AttachRenderedVideoResult> {
  return withStageLog(
    "attach-render",
    { scriptId },
    async () => {
      const script = await prisma.script.findUnique({ where: { id: scriptId } });
      if (!script) throw new Error(`Script ${scriptId} not found`);

      const existing = await prisma.video.findFirst({
        where: {
          scriptId,
          status: { in: ["QUEUED", "RENDERING", "RENDER_GATE_FAILED", "READY"] },
          publications: { none: { status: "PUBLISHED" } },
        },
        orderBy: { createdAt: "desc" },
      });
      const videoId =
        existing?.id ?? (await prisma.video.create({ data: { orgId: script.orgId, scriptId } })).id;

      const problems = checkRenderGate(probe);
      if (problems.length > 0) {
        await prisma.video.update({
          where: { id: videoId },
          data: { status: "RENDER_GATE_FAILED" },
        });
        throw new RenderGateError(videoId, problems);
      }

      const assetUrl = await uploadRenderAsset({
        path: `${script.orgId}/${videoId}/video.mp4`,
        data: mp4,
        contentType: "video/mp4",
      });
      const durationSec = Math.round(probe.durationSec);

      await prisma.video.update({
        where: { id: videoId },
        data: { assetUrl, status: "READY", durationSec },
      });

      return { videoId, assetUrl, durationSec };
    },
    (result) => ({ ...result })
  );
}

function runFfprobe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk));
    proc.stderr.on("data", (chunk) => (stderr += chunk));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`ffprobe exited with ${code}: ${stderr.slice(-500)}`))
    );
  });
}
