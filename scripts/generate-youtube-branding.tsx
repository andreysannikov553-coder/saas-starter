/**
 * Generates a YouTube avatar + banner matching the existing Telegram channel
 * brand (quote-card.tsx): teal gradient, pulse-line mark, "Доказательное
 * здоровье" kicker. Local render via next/og — no external image API.
 *
 * Usage:
 *   npx tsx scripts/generate-youtube-branding.ts
 *
 * Writes avatar.png (800x800) and banner.png (2048x1152) to the given dir
 * (default: scratchpad).
 */
import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

const FONTS_DIR = path.join(process.cwd(), "src/lib/content-engine/render/fonts");
const OUT_DIR =
  process.argv[2] ??
  "/private/tmp/claude-502/-Users-Andrey-saas-starter/931c4141-e550-4676-b508-9da005c8a024/scratchpad";

const GRADIENT = "linear-gradient(155deg, #0d9488 0%, #0f766e 55%, #065f46 100%)";
const PULSE_POINTS = "0,24 8,24 11,15 16,32 20,8 24,24 40,24";

async function loadFonts() {
  const [bold, regular] = await Promise.all([
    readFile(path.join(FONTS_DIR, "PTSans-Bold.ttf")),
    readFile(path.join(FONTS_DIR, "PTSans-Regular.ttf")),
  ]);
  return { bold, regular };
}

async function renderAvatar(fonts: { bold: Buffer; regular: Buffer }) {
  const size = 800;
  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: GRADIENT,
        }}
      >
        <svg width="440" height="440" viewBox="0 0 40 40">
          <polyline
            points={PULSE_POINTS}
            fill="none"
            stroke="white"
            strokeWidth={3.2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
    ),
    {
      width: size,
      height: size,
      fonts: [
        { name: "PT Sans Bold", data: fonts.bold, weight: 700, style: "normal" },
        { name: "PT Sans", data: fonts.regular, weight: 400, style: "normal" },
      ],
    }
  );
  return Buffer.from(await image.arrayBuffer());
}

async function renderBanner(fonts: { bold: Buffer; regular: Buffer }) {
  const width = 2048;
  const height = 1152;
  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: GRADIENT,
          fontFamily: "PT Sans",
          position: "relative",
        }}
      >
        <svg
          width={width}
          height={height}
          viewBox="0 0 1080 1080"
          style={{ position: "absolute", top: 0, left: 0, opacity: 0.14 }}
        >
          <polyline
            points="0,620 210,620 300,580 360,760 430,420 500,630 1080,630"
            fill="none"
            stroke="white"
            strokeWidth={22}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>

        <div style={{ display: "flex", alignItems: "center", gap: 28, marginBottom: 28 }}>
          <svg width="90" height="90" viewBox="0 0 40 40">
            <polyline
              points={PULSE_POINTS}
              fill="none"
              stroke="white"
              strokeWidth={3.2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          <span
            style={{
              color: "white",
              fontSize: 96,
              fontWeight: 700,
              fontFamily: "PT Sans Bold",
              textShadow: "0 2px 24px rgba(0,0,0,0.25)",
            }}
          >
            Доказательное здоровье
          </span>
        </div>
        <span style={{ color: "white", fontSize: 44, opacity: 0.85 }}>
          Наука о теле — без воды и англицизмов
        </span>
      </div>
    ),
    {
      width,
      height,
      fonts: [
        { name: "PT Sans Bold", data: fonts.bold, weight: 700, style: "normal" },
        { name: "PT Sans", data: fonts.regular, weight: 400, style: "normal" },
      ],
    }
  );
  return Buffer.from(await image.arrayBuffer());
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const fonts = await loadFonts();

  const [avatar, banner] = await Promise.all([renderAvatar(fonts), renderBanner(fonts)]);

  await writeFile(path.join(OUT_DIR, "youtube-avatar.png"), avatar);
  await writeFile(path.join(OUT_DIR, "youtube-banner.png"), banner);

  console.log("Written:", path.join(OUT_DIR, "youtube-avatar.png"));
  console.log("Written:", path.join(OUT_DIR, "youtube-banner.png"));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
