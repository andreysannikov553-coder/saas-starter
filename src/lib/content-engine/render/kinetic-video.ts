import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderKineticFrame } from "./kinetic-frame";
import { timeWords } from "./kinetic-timing";

const FPS = 30;
/** Silence a voice leaves at the tail of a line; not part of the words' timing. */
const LINE_GAP_SECONDS = 0.28;

export interface KineticBeat {
  role: string;
  line: string;
  /** Spoken length of this line's audio, in seconds, excluding any padding. */
  speechSeconds: number;
}

export interface AssembleKineticVideoOptions {
  /** Local audio file whose lines are the beats, in order, each followed by LINE_GAP_SECONDS of silence. */
  audioPath: string;
  bgIndex?: number;
}

export { LINE_GAP_SECONDS };

interface FramePlan {
  png: Buffer;
  seconds: number;
}

/**
 * Builds a vertical (1080x1920) word-by-word video: for each spoken word one
 * still frame with that word lit, held for as long as the word takes to say.
 *
 * Stills plus ffmpeg's concat demuxer, not per-frame overlays or a filter
 * graph: the whole video is a few dozen distinct images, each rendered once
 * by the same satori pipeline as the carousel, so the video cannot drift from
 * the post's look, and there is nothing to animate in ffmpeg itself.
 */
export async function assembleKineticVideo(
  beats: KineticBeat[],
  options: AssembleKineticVideoOptions
): Promise<Buffer> {
  if (beats.length === 0) throw new Error("assembleKineticVideo needs at least 1 beat");

  const bgIndex = options.bgIndex ?? Math.floor(Math.random() * 3);
  const totalSeconds = beats.reduce((sum, b) => sum + b.speechSeconds + LINE_GAP_SECONDS, 0);

  const plan: FramePlan[] = [];
  let elapsed = 0;

  for (const beat of beats) {
    const timed = timeWords(beat.line, beat.speechSeconds);
    const words = timed.map((t) => t.text);

    for (const [wordIndex, word] of timed.entries()) {
      const isLastWord = wordIndex === timed.length - 1;
      plan.push({
        png: await renderKineticFrame({
          words,
          activeIndex: wordIndex,
          progress: (elapsed + word.start) / totalSeconds,
          bgIndex,
          isHook: beat.role === "HOOK",
          isOutro: beat.role === "CTA",
        }),
        // The last word also holds through the pause before the next line.
        seconds: word.duration + (isLastWord ? LINE_GAP_SECONDS : 0),
      });
    }
    elapsed += beat.speechSeconds + LINE_GAP_SECONDS;
  }

  const dir = await mkdtemp(path.join(tmpdir(), "kinetic-"));
  try {
    const lines: string[] = [];
    for (const [i, frame] of plan.entries()) {
      const file = path.join(dir, `f_${String(i).padStart(4, "0")}.png`);
      await writeFile(file, frame.png);
      lines.push(`file '${file}'`, `duration ${frame.seconds.toFixed(4)}`);
    }
    // The concat demuxer ignores the last entry's duration unless the file is repeated.
    lines.push(`file '${path.join(dir, `f_${String(plan.length - 1).padStart(4, "0")}.png`)}'`);

    const listPath = path.join(dir, "frames.txt");
    await writeFile(listPath, lines.join("\n"), "utf8");
    const outPath = path.join(dir, "out.mp4");

    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-i",
      options.audioPath,
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-vf",
      `fps=${FPS},format=yuv420p`,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-shortest",
      "-movflags",
      "+faststart",
      outPath,
    ]);

    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
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
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}
