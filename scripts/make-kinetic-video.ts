/**
 * Renders a vertical (1080x1920) kinetic-text video from a script's beats and
 * narrates it locally with Piper — no paid TTS, no cloud render.
 *
 * Each beat is spoken separately so its real spoken length (ffprobe) can drive
 * how long each word stays lit; the segments are then padded by
 * LINE_GAP_SECONDS and concatenated into one narration track, which is exactly
 * the layout assembleKineticVideo expects.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/make-kinetic-video.ts out.mp4 --script=<scriptId>
 *   npx tsx scripts/make-kinetic-video.ts out.mp4 --beats=beats.json
 *
 * Flags:
 *   --script=<id>    Beats come from this Script in the database, in order.
 *   --beats=<file>   Beats come from a JSON file: [{ "role": "HOOK", "line": "…" }]
 *   --voice=<path>   Piper voice .onnx (default: $PIPER_VOICE, else
 *                    ~/.jarvis/models/ru_RU-ruslan-medium.onnx)
 *   --bg=<index>     Background index for the frames (default: random)
 *
 * Piper itself lives outside the repository — any Python environment with the
 * `piper-tts` package will do; point $PIPER_PYTHON at its interpreter. On this
 * machine that is ~/.jarvis/venv, installed once by the Jarvis setup script.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "../src/lib/db";
import {
  assembleKineticVideo,
  LINE_GAP_SECONDS,
  type KineticBeat,
} from "../src/lib/content-engine/render/kinetic-video";

const PIPER_PYTHON = process.env.PIPER_PYTHON ?? path.join(homedir(), ".jarvis/venv/bin/python");
const DEFAULT_VOICE = path.join(homedir(), ".jarvis/models/ru_RU-ruslan-medium.onnx");

interface BeatInput {
  role: string;
  line: string;
}

function parseFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

/** Runs a command, optionally feeding it stdin, and returns its stdout. */
function run(file: string, args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${path.basename(file)} exited with ${code}: ${err.trim().slice(-400)}`))
    );
    child.stdin.end(stdin ?? "");
  });
}

async function durationSeconds(file: string): Promise<number> {
  const out = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    file,
  ]);
  const seconds = Number(out.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe reported no duration for ${file}`);
  }
  return seconds;
}

async function loadBeats(): Promise<BeatInput[]> {
  const scriptId = parseFlag("script");
  const beatsFile = parseFlag("beats");

  if (scriptId) {
    const script = await prisma.script.findUnique({
      where: { id: scriptId },
      include: { beats: { orderBy: { order: "asc" } } },
    });
    if (!script) throw new Error(`Script ${scriptId} not found`);
    if (script.beats.length === 0) throw new Error(`Script ${scriptId} has no beats`);
    return script.beats.map((b) => ({ role: b.role, line: b.line }));
  }

  if (beatsFile) {
    const parsed: unknown = JSON.parse(await readFile(beatsFile, "utf8"));
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error(`${beatsFile} must hold a non-empty array of beats`);
    }
    return parsed.map((raw, i) => {
      const beat = raw as Partial<BeatInput>;
      if (typeof beat.line !== "string" || !beat.line.trim()) {
        throw new Error(`Beat ${i} in ${beatsFile} has no "line"`);
      }
      return { role: typeof beat.role === "string" ? beat.role : `BEAT${i + 1}`, line: beat.line };
    });
  }

  throw new Error("Pass --script=<scriptId> or --beats=<file.json>");
}

/** Speaks every beat with Piper and returns the beats plus one narration track. */
async function narrate(beats: BeatInput[], voice: string, dir: string) {
  const timed: KineticBeat[] = [];
  const segments: string[] = [];

  for (const [i, beat] of beats.entries()) {
    const spoken = path.join(dir, `raw_${i}.wav`);
    const padded = path.join(dir, `seg_${i}.wav`);
    await run(PIPER_PYTHON, ["-m", "piper", "-m", voice, "-f", spoken], beat.line);
    const speechSeconds = await durationSeconds(spoken);
    // Pad each line with the same gap assembleKineticVideo leaves between beats.
    await run("ffmpeg", [
      "-y",
      "-i",
      spoken,
      "-af",
      `apad=pad_dur=${LINE_GAP_SECONDS}`,
      "-ar",
      "44100",
      "-ac",
      "2",
      padded,
    ]);
    timed.push({ role: beat.role, line: beat.line, speechSeconds });
    segments.push(padded);
    console.log(`${beat.role}: ${speechSeconds.toFixed(2)}s`);
  }

  const list = path.join(dir, "segments.txt");
  await writeFile(list, segments.map((s) => `file '${s}'`).join("\n"), "utf8");
  const audioPath = path.join(dir, "narration.m4a");
  await run("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    audioPath,
  ]);
  return { timed, audioPath };
}

async function main() {
  const out = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!out) {
    console.error(
      "Usage: npx tsx scripts/make-kinetic-video.ts out.mp4 (--script=<id> | --beats=<file.json>) [--voice=<voice.onnx>] [--bg=<index>]"
    );
    process.exitCode = 1;
    return;
  }

  const voice = parseFlag("voice") ?? process.env.PIPER_VOICE ?? DEFAULT_VOICE;
  const bgFlag = parseFlag("bg");
  const beats = await loadBeats();

  const dir = await mkdtemp(path.join(tmpdir(), "kinetic-"));
  try {
    const { timed, audioPath } = await narrate(beats, voice, dir);
    const mp4 = await assembleKineticVideo(timed, {
      audioPath,
      bgIndex: bgFlag === undefined ? undefined : Number(bgFlag),
    });
    await writeFile(out, mp4);
    const seconds = timed.reduce((sum, b) => sum + b.speechSeconds + LINE_GAP_SECONDS, 0);
    console.log(`\n${out} — ${seconds.toFixed(1)}s, ${(mp4.length / 1e6).toFixed(1)} MB`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main()
  .catch((err) => {
    console.error("\nRender failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
