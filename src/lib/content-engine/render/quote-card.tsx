import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

const FONTS_DIR = path.join(process.cwd(), "src/lib/content-engine/render/fonts");

let fontsPromise: Promise<{ bold: Buffer; regular: Buffer }> | null = null;

function loadFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      readFile(path.join(FONTS_DIR, "PTSans-Bold.ttf")),
      readFile(path.join(FONTS_DIR, "PTSans-Regular.ttf")),
    ]).then(([bold, regular]) => ({ bold, regular }));
  }
  return fontsPromise;
}

export interface QuoteCardOptions {
  /** The hook line — the big headline, e.g. "12 000 шагов в день снижают риск смерти на 56%". */
  headline: string;
  /** Small kicker above the headline, e.g. the hook's angle. Optional. */
  kicker?: string;
}

/**
 * Renders a branded 1080x1080 PNG quote card for a script's best hook, so a
 * Telegram post has something to look at before video assembly/ffmpeg exists
 * (see docs/PRODUCTION_READINESS.md — that stage isn't built yet). Reuses the
 * channel avatar's palette (teal gradient + white pulse line) so the card
 * reads as the same brand as the channel photo.
 */
export async function renderQuoteCard(options: QuoteCardOptions): Promise<Buffer> {
  const fonts = await loadFonts();

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(155deg, #0d9488 0%, #0f766e 55%, #065f46 100%)",
          fontFamily: "PT Sans",
        }}
      >
        {/* subtle pulse line watermark across the middle */}
        <svg
          width="1080"
          height="1080"
          viewBox="0 0 1080 1080"
          style={{ position: "absolute", top: 0, left: 0, opacity: 0.16 }}
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

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <svg width="40" height="40" viewBox="0 0 40 40">
            <polyline
              points="0,24 8,24 11,15 16,32 20,8 24,24 40,24"
              fill="none"
              stroke="white"
              strokeWidth={3.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          <span style={{ color: "white", fontSize: 28, opacity: 0.85, fontFamily: "PT Sans" }}>
            {options.kicker ?? "Доказательное здоровье"}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            color: "white",
            fontSize: headlineFontSize(options.headline),
            fontWeight: 700,
            lineHeight: 1.15,
            fontFamily: "PT Sans Bold",
            textShadow: "0 2px 24px rgba(0,0,0,0.25)",
          }}
        >
          {options.headline}
        </div>

        <div style={{ display: "flex", color: "white", fontSize: 24, opacity: 0.7 }}>
          t.me/channel_of_health
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1080,
      fonts: [
        { name: "PT Sans", data: fonts.regular, weight: 400, style: "normal" },
        { name: "PT Sans Bold", data: fonts.bold, weight: 700, style: "normal" },
      ],
    }
  );

  const arrayBuffer = await image.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Longer hooks need a smaller size to still fit the card without overflowing. */
function headlineFontSize(headline: string): number {
  if (headline.length > 160) return 52;
  if (headline.length > 110) return 60;
  if (headline.length > 70) return 72;
  return 84;
}
