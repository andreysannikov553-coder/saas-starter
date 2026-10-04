import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FPS = 30;
const SLIDE_SECONDS = 3.5;
/**
 * Exported because callers timing slides to narration need it: consecutive
 * slides overlap by this much, so a slide must be held TRANSITION_SECONDS
 * longer than the audio it covers to stay in sync with it.
 */
export const TRANSITION_SECONDS = 0.6;
const RENDER_SIZE = 1080;
// Slightly larger than the output frame so zoompan has room to zoom into
// without ever exposing an edge.
const SCALE_SIZE = 1400;
/**
 * A deliberately shallow Ken Burns. The slides are cards, not photographs:
 * the headline sits against the top edge and the brand strip against the
 * bottom, so a 1.18 zoom (the first value tried) pushed both out of frame
 * within four seconds and the channel's own name left the video. At 1.06 the
 * motion still reads and the frame keeps its edges.
 */
const MAX_ZOOM = 1.06;
const ZOOM_STEP = 0.0004;

export interface AssembleSlideshowVideoOptions {
  /**
   * Per-slide duration in seconds: one number for every slide, or one number
   * per slide. An array is what timing slides to narration needs — each slide
   * holds for exactly as long as the line spoken over it.
   */
  slideSeconds?: number | number[];
  /** Local path to an audio file (e.g. narration mp3) to mux as the soundtrack. */
  audioPath?: string;
}

/**
 * Turns a set of already-rendered 1080x1080 slide images (renderCarouselSlides'
 * output) into an MP4 slideshow: each slide gets a slow Ken Burns zoom
 * (alternating in/out for rhythm) and slides crossfade into each other,
 * instead of a hard cut — the "cheap slideshow-from-cards" video format
 * discussed for platforms (YouTube Shorts) where a static card doesn't
 * perform the way it does as a Telegram/Instagram carousel post.
 *
 * Two ffmpeg zoompan pitfalls this deliberately avoids (found by testing
 * directly against real rendered slides before writing this wrapper):
 *  - Do NOT put `-t <duration>` on a `-loop 1 -i img.png` input: zoompan's
 *    `d` (frames per input frame) multiplies against however many duplicate
 *    frames the looped input already produced, so a 3.5s loop can quietly
 *    balloon into a 5+ minute output. Duration is controlled entirely via
 *    zoompan's own `d=<frames>` and the final `-t`.
 *  - zoompan's default x/y anchors the zoom to the top-left corner, so
 *    zooming in crops the right/bottom edge (cuts off badges, the CTA
 *    pill). `x`/`y` must be set to the centering expression explicitly.
 */
export async function assembleSlideshowVideo(
  slides: Buffer[],
  options: AssembleSlideshowVideoOptions = {}
): Promise<Buffer> {
  if (slides.length === 0) {
    throw new Error("assembleSlideshowVideo needs at least 1 slide");
  }

  const durations = resolveDurations(slides.length, options.slideSeconds);
  const dir = await mkdtemp(path.join(tmpdir(), "slideshow-"));

  try {
    const slidePaths = await Promise.all(
      slides.map(async (buf, i) => {
        const p = path.join(dir, `slide_${String(i).padStart(2, "0")}.png`);
        await writeFile(p, buf);
        return p;
      })
    );

    const outPath = path.join(dir, "out.mp4");

    const perSlideFilters = slidePaths.map((_, i) => {
      const frames = Math.round(durations[i] * FPS);
      const zoomIn = i % 2 === 0;
      const zoomExpr = zoomIn
        ? `min(zoom+${ZOOM_STEP},${MAX_ZOOM})`
        : `if(eq(on,0),${MAX_ZOOM},max(zoom-${ZOOM_STEP},1.0))`;
      return (
        `[${i}:v]scale=${SCALE_SIZE}:${SCALE_SIZE},` +
        `zoompan=z='${zoomExpr}':d=${frames}:` +
        `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
        `s=${RENDER_SIZE}x${RENDER_SIZE}:fps=${FPS},setsar=1[v${i}]`
      );
    });

    let chain = "";
    let prevLabel = "v0";
    let cumulative = durations[0];
    for (let i = 1; i < slidePaths.length; i++) {
      const isLast = i === slidePaths.length - 1;
      const outLabel = isLast ? "vout" : `vx${i}`;
      const offset = cumulative - TRANSITION_SECONDS;
      chain += `[${prevLabel}][v${i}]xfade=transition=fade:duration=${TRANSITION_SECONDS}:offset=${offset.toFixed(2)}[${outLabel}];\n`;
      prevLabel = outLabel;
      cumulative += durations[i] - TRANSITION_SECONDS;
    }

    const finalLabel = slidePaths.length === 1 ? "v0" : "vout";
    const totalSeconds = cumulative;
    const filterComplex = perSlideFilters.join(";\n") + (chain ? ";\n" + chain : "");

    const args = [
      "-y",
      ...slidePaths.flatMap((p) => ["-loop", "1", "-i", p]),
      ...(options.audioPath ? ["-i", options.audioPath] : []),
      "-filter_complex",
      filterComplex,
      "-map",
      `[${finalLabel}]`,
      ...(options.audioPath ? ["-map", `${slidePaths.length}:a`] : []),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(FPS),
      ...(options.audioPath ? ["-c:a", "aac", "-shortest"] : []),
      "-t",
      totalSeconds.toFixed(2),
      outPath,
    ];

    await runFfmpeg(args);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * One duration per slide, however the caller expressed it. A mismatched array
 * length is a caller bug that would otherwise surface as a silently truncated
 * or endless video, so it throws here instead.
 */
function resolveDurations(slideCount: number, slideSeconds?: number | number[]): number[] {
  if (slideSeconds === undefined) return Array(slideCount).fill(SLIDE_SECONDS);

  if (typeof slideSeconds === "number") {
    assertPositive(slideSeconds, "slideSeconds");
    return Array(slideCount).fill(slideSeconds);
  }

  if (slideSeconds.length !== slideCount) {
    throw new Error(
      `slideSeconds has ${slideSeconds.length} durations for ${slideCount} slides — pass one per slide, or a single number for all of them`
    );
  }

  slideSeconds.forEach((seconds, i) => assertPositive(seconds, `slideSeconds[${i}]`));
  return slideSeconds;
}

function assertPositive(seconds: number, label: string): void {
  if (!Number.isFinite(seconds) || seconds <= TRANSITION_SECONDS) {
    throw new Error(
      `${label} must be a number longer than the ${TRANSITION_SECONDS}s crossfade, got ${seconds}`
    );
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
      }
    });
  });
}
