import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

const FONTS_DIR = path.join(process.cwd(), "src/lib/content-engine/render/fonts");
const CHANNEL_HANDLE = "t.me/channel_of_health";
const BRAND_KICKER = "Доказательное здоровье";

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
 * Renders a single branded 1080x1080 PNG quote card. Kept as the fallback
 * for when a full carousel (renderCarouselSlides) can't be built — a script
 * with too few beats, or slide rendering failing partway through.
 */
export async function renderQuoteCard(options: QuoteCardOptions): Promise<Buffer> {
  return renderSlide({
    variant: "headline",
    text: options.headline,
    kicker: options.kicker,
  });
}

export interface CarouselBeat {
  role: string;
  line: string;
}

/**
 * Renders a swipeable Telegram album (sendMediaGroup) from a script's beats —
 * one slide per beat, HOOK as the big-text opener and everything else as
 * body-text slides, closing on a "swipe for more / subscribe" note. Modeled
 * on the "Листай ➡️" carousel format common on health/facts Instagram pages
 * (Andrey's @ynikalnoye reference, 2026-09-23) rather than a single image
 * plus a wall of text below it.
 *
 * Telegram media groups need 2-10 items; a script under 2 beats (shouldn't
 * happen — generateScriptForTopic always emits HOOK..CTA, see
 * scripts/types.ts) returns a single-item array so the caller can fall back
 * to a plain photo instead.
 */
export async function renderCarouselSlides(beats: CarouselBeat[]): Promise<Buffer[]> {
  const slides = beats.slice(0, 10);
  const total = slides.length;

  return Promise.all(
    slides.map((beat, index) =>
      renderSlide({
        variant: beat.role === "HOOK" ? "headline" : "body",
        text: beat.line,
        index: total > 1 ? index + 1 : undefined,
        total: total > 1 ? total : undefined,
        showSwipeHint: index === 0 && total > 1,
        isOutro: beat.role === "CTA",
      })
    )
  );
}

interface SlideOptions {
  variant: "headline" | "body";
  text: string;
  kicker?: string;
  index?: number;
  total?: number;
  showSwipeHint?: boolean;
  isOutro?: boolean;
}

async function renderSlide(options: SlideOptions): Promise<Buffer> {
  const fonts = await loadFonts();
  const isHeadline = options.variant === "headline";

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

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
              {options.kicker ?? BRAND_KICKER}
            </span>
          </div>
          {options.index && options.total ? (
            <span style={{ display: "flex", color: "white", fontSize: 26, opacity: 0.7 }}>
              {options.index}/{options.total}
            </span>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            color: "white",
            fontSize: isHeadline ? headlineFontSize(options.text) : bodyFontSize(options.text),
            fontWeight: isHeadline ? 700 : 400,
            lineHeight: 1.2,
            fontFamily: isHeadline ? "PT Sans Bold" : "PT Sans",
            textShadow: "0 2px 24px rgba(0,0,0,0.25)",
          }}
        >
          {options.text}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: "white",
            fontSize: 24,
            opacity: 0.7,
          }}
        >
          <span style={{ display: "flex" }}>{CHANNEL_HANDLE}</span>
          {options.showSwipeHint ? (
            <span style={{ display: "flex", fontFamily: "PT Sans Bold" }}>Листай ➡️</span>
          ) : options.isOutro ? (
            <span style={{ display: "flex", fontFamily: "PT Sans Bold" }}>Подписывайся ✅</span>
          ) : null}
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

/** Body slides carry a full beat line (often longer than a hook) at a readable, not shouty, size. */
function bodyFontSize(text: string): number {
  if (text.length > 220) return 40;
  if (text.length > 140) return 46;
  return 54;
}
