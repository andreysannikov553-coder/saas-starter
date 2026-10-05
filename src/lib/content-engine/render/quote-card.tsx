import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

const FONTS_DIR = path.join(process.cwd(), "src/lib/content-engine/render/fonts");
const BACKGROUNDS_DIR = path.join(process.cwd(), "src/lib/content-engine/render/backgrounds");
// bg6 is deliberately absent: its AI-generated lettering sits exactly where the
// quote goes, and the garbled text shipped to the channel.
const BACKGROUND_FILES = ["bg1.jpg", "bg2.jpg", "bg3.jpg", "bg7.jpg", "bg8.jpg", "bg9.jpg"];
const CHANNEL_HANDLE = "t.me/channel_of_health";
const BRAND_KICKER = "Доказательное здоровье";
const ACCENT = "#fbbf24"; // warm amber pop against the cool teal photo background

let fontsPromise: Promise<{ bold: Buffer; regular: Buffer }> | null = null;
let backgroundsPromise: Promise<string[]> | null = null;

function loadFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      readFile(path.join(FONTS_DIR, "PTSans-Bold.ttf")),
      readFile(path.join(FONTS_DIR, "PTSans-Regular.ttf")),
    ]).then(([bold, regular]) => ({ bold, regular }));
  }
  return fontsPromise;
}

/**
 * Local, pre-generated background textures (AI-generated once via
 * Pollinations.ai, checked into the repo like the fonts) rather than calling
 * an external image API on every publish — that would add real latency and
 * a new failure mode to a pipeline stage that currently never fails on
 * network flakiness. Rotated by slide index for variety within one carousel.
 */
function loadBackgrounds() {
  if (!backgroundsPromise) {
    backgroundsPromise = Promise.all(
      BACKGROUND_FILES.map((file) =>
        readFile(path.join(BACKGROUNDS_DIR, file)).then(
          (buf) => `data:image/jpeg;base64,${buf.toString("base64")}`
        )
      )
    );
  }
  return backgroundsPromise;
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
    bgIndex: Math.floor(Math.random() * BACKGROUND_FILES.length),
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
export interface RenderCarouselOptions {
  /**
   * Draw the "2/5" counter and the "Листай ➡️" hint. True for a swipeable
   * post; false when the same slides become video frames, where both are
   * instructions the viewer cannot follow.
   */
  showPagination?: boolean;
}

export async function renderCarouselSlides(
  beats: CarouselBeat[],
  options: RenderCarouselOptions = {}
): Promise<Buffer[]> {
  const showPagination = options.showPagination ?? true;
  const slides = beats.slice(0, 10);
  const total = slides.length;
  // One background for the whole carousel, not one per slide — a single post
  // should read as one designed piece, not a grab-bag of unrelated photos
  // (food, neurons, DNA...) stitched together. Different posts still vary
  // since this is picked fresh per call.
  const bgIndex = Math.floor(Math.random() * BACKGROUND_FILES.length);

  return Promise.all(
    slides.map((beat, index) =>
      renderSlide({
        variant: beat.role === "HOOK" ? "headline" : "body",
        text: beat.line,
        index: showPagination && total > 1 ? index + 1 : undefined,
        total: showPagination && total > 1 ? total : undefined,
        showSwipeHint: showPagination && index === 0 && total > 1,
        isOutro: beat.role === "CTA",
        bgIndex,
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
  bgIndex: number;
}

async function renderSlide(options: SlideOptions): Promise<Buffer> {
  const [fonts, backgrounds] = await Promise.all([loadFonts(), loadBackgrounds()]);
  const isHeadline = options.variant === "headline";
  const background = backgrounds[options.bgIndex % backgrounds.length];

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundImage: `url(${background})`,
          backgroundSize: "1080px 1080px",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        {/* dark scrim over the photo so white text stays legible top and bottom */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            backgroundImage:
              "linear-gradient(180deg, rgba(3,14,12,0.85) 0%, rgba(3,14,12,0.4) 38%, rgba(3,14,12,0.55) 62%, rgba(3,14,12,0.92) 100%)",
          }}
        />

        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: 72,
            fontFamily: "PT Sans",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: "rgba(3,14,12,0.55)",
                border: `2px solid ${ACCENT}`,
                borderRadius: 999,
                padding: "12px 24px 12px 18px",
              }}
            >
              <svg width="30" height="30" viewBox="0 0 40 40">
                <polyline
                  points="0,24 8,24 11,15 16,32 20,8 24,24 40,24"
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth={4}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
              <span style={{ color: "white", fontSize: 26, fontFamily: "PT Sans Bold" }}>
                {options.kicker ?? BRAND_KICKER}
              </span>
            </div>
            {options.index && options.total ? (
              <span
                style={{
                  display: "flex",
                  color: "#03110e",
                  fontSize: 26,
                  fontFamily: "PT Sans Bold",
                  background: ACCENT,
                  borderRadius: 999,
                  padding: "10px 22px",
                }}
              >
                {options.index}/{options.total}
              </span>
            ) : null}
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              color: "white",
              fontSize: isHeadline ? headlineFontSize(options.text) : bodyFontSize(options.text),
              fontWeight: isHeadline ? 700 : 400,
              lineHeight: 1.18,
              fontFamily: isHeadline ? "PT Sans Bold" : "PT Sans",
              textShadow: "0 4px 28px rgba(0,0,0,0.55)",
            }}
          >
            {highlightNumbers(options.text).map((part, i) => (
              <span
                key={i}
                style={{ whiteSpace: "pre-wrap", ...(part.highlight ? { color: ACCENT } : {}) }}
              >
                {part.text}
              </span>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              color: "white",
              fontSize: 24,
            }}
          >
            <span style={{ display: "flex", opacity: 0.75 }}>{CHANNEL_HANDLE}</span>
            {options.showSwipeHint ? (
              <span
                style={{
                  display: "flex",
                  fontFamily: "PT Sans Bold",
                  color: "#03110e",
                  background: ACCENT,
                  borderRadius: 999,
                  padding: "10px 22px",
                }}
              >
                Листай ➡️
              </span>
            ) : options.isOutro ? (
              <span
                style={{
                  display: "flex",
                  fontFamily: "PT Sans Bold",
                  color: "#03110e",
                  background: ACCENT,
                  borderRadius: 999,
                  padding: "10px 22px",
                }}
              >
                Подписывайся ✅
              </span>
            ) : null}
          </div>
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

const NUMBER_PATTERN = /\d+(?:[.,\s]\d+)*\s*%?/g;

/**
 * Splits a slide's text into word-sized runs, marking the numeric ones so
 * they can render in the accent color — the single cheapest, highest-impact
 * technique observed across reference accounts (@ynikalnoye, @the.lil.chill,
 * 2026-09-25/26): plain white text everywhere reads as "cheap", the same
 * text with just the numbers pulled into a bright accent color reads as
 * designed. Deliberately mechanical (regex, not LLM-tagged) — no highlight
 * to review/fail if the model changes phrasing.
 *
 * One word per run, not one run per colour change: the caller lays these out
 * as wrapping flex items, and a flex item only ever wraps as a whole, so
 * returning "12 000" + "шагов в день снижают риск смерти на" as two runs put
 * the number alone on its own line with a ragged gap after it. Numbers keep
 * their internal spaces ("12 000") in a single run so a thousands separator
 * never becomes a line break.
 */
export function highlightNumbers(text: string): Array<{ text: string; highlight: boolean }> {
  const parts: Array<{ text: string; highlight: boolean }> = [];

  function push(run: string, highlight: boolean) {
    if (!run) return;
    const previous = parts[parts.length - 1];
    // Whitespace alone is not a word — glue it to the run before it rather
    // than letting it start a line with a leading indent.
    if (!run.trim() && previous) {
      previous.text += run;
      return;
    }
    parts.push({ text: run, highlight });
  }

  let lastIndex = 0;
  for (const match of text.matchAll(NUMBER_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      for (const word of splitWords(text.slice(lastIndex, index))) push(word, false);
    }
    push(match[0], true);
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    for (const word of splitWords(text.slice(lastIndex))) push(word, false);
  }

  return parts;
}

/** Each word keeps its own trailing whitespace, so runs still join up on a line. */
function splitWords(chunk: string): string[] {
  return chunk.match(/\s*\S+\s*|\s+/g) ?? [];
}
