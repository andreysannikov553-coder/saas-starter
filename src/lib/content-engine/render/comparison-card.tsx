import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { highlightNumbers } from "./quote-card";

const FONTS_DIR = path.join(process.cwd(), "src/lib/content-engine/render/fonts");
const CHARACTERS_DIR = path.join(process.cwd(), "src/lib/content-engine/render/characters");
const ACCENT = "#0d9488";
const INK = "#111111";
const PAPER = "#f5f5f0";
const CHANNEL_HANDLE = "t.me/channel_of_health";
const BRAND_KICKER = "Доказательное здоровье";

/**
 * The character art is square (768x768). The two halves are laid out at
 * exactly 540x540 so the source lands 1:1 with no cropping — an earlier
 * full-height layout cropped each side to a narrow portrait and cut the
 * runner's arm and head off at the frame edge.
 */
const HALF = 540;

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

let charactersPromise: Promise<{ fit: string; lazy: string }> | null = null;
function loadCharacters() {
  if (!charactersPromise) {
    charactersPromise = Promise.all([
      readFile(path.join(CHARACTERS_DIR, "fit-guy-1.jpg")),
      readFile(path.join(CHARACTERS_DIR, "lazy-guy-1.jpg")),
    ]).then(([fit, lazy]) => ({
      fit: `data:image/jpeg;base64,${fit.toString("base64")}`,
      lazy: `data:image/jpeg;base64,${lazy.toString("base64")}`,
    }));
  }
  return charactersPromise;
}

export interface ComparisonCardOptions {
  /** Top line, e.g. "ОБОИМ 37 ЛЕТ" — the shared trait that makes the contrast land. */
  sharedTrait: string;
  /** Second line, e.g. "оба говорят: «у меня нет времени»" — optional. */
  subline?: string;
  /** Small label over the fit character, e.g. "06:30 подъём". */
  fitLabel?: string;
  /** Small label over the lazy character, e.g. "2ч 47мин соцсетей". */
  lazyLabel?: string;
  /**
   * The closing line under the pictures — the actual evidence-based takeaway
   * ("разница — 20 минут ходьбы в день, а не сила воли"). Optional, but worth
   * always passing: without it the card is two body types side by side, which
   * is the shaming version of this format, not the habit contrast the channel
   * publishes. Numbers in it render in the accent color, same as quote cards.
   */
  payoff?: string;
  /**
   * Replaces the channel handle in the footer with the "Листай ➡️" pill —
   * set when this card leads a carousel, since the hint belongs on the first
   * image a reader sees and the handle is on every slide behind it anyway.
   */
  showSwipeHint?: boolean;
}

/**
 * Renders the "two people, same trait, different choice" comparison format
 * (buch_vision, 52K likes, 2026-09-26 reference) — a light card instead of
 * our usual dark AI-photo card, since the format's whole appeal is the
 * stark illustrated contrast, not moody lighting. Uses a fixed recurring
 * character pair (fit-guy-1.jpg / lazy-guy-1.jpg, generated once and
 * checked in like the backgrounds) rather than generating people per post:
 * free text-to-image has no real character-consistency between calls (even
 * a fixed seed changes the face), so a *recurring* pair reused across every
 * comparison post is the only free way to get "the same two guys" — reader
 * familiarity comes from repetition, not per-post generation fidelity.
 *
 * Laid out as fixed bands (header / 1080x540 picture strip / payoff / brand
 * footer) rather than a stretchy column, so the picture strip keeps the
 * source art's 1:1 framing no matter how long the headline runs.
 */
export async function renderComparisonCard(options: ComparisonCardOptions): Promise<Buffer> {
  const [fonts, characters] = await Promise.all([loadFonts(), loadCharacters()]);

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: PAPER,
          fontFamily: "PT Sans",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            flex: 1,
            padding: "0 56px",
          }}
        >
          <span
            style={{
              display: "flex",
              color: INK,
              fontSize: sharedTraitFontSize(options.sharedTrait),
              fontFamily: "PT Sans Bold",
              lineHeight: 1.08,
            }}
          >
            {options.sharedTrait}
          </span>
          {options.subline ? (
            <span
              style={{
                display: "flex",
                color: "#444444",
                fontSize: 34,
                marginTop: 14,
                fontFamily: "PT Sans",
              }}
            >
              {options.subline}
            </span>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            height: HALF,
            borderTop: `4px solid ${INK}`,
            borderBottom: `4px solid ${INK}`,
          }}
        >
          <CharacterHalf src={characters.fit} label={options.fitLabel} labelSide="left" divider />
          <CharacterHalf src={characters.lazy} label={options.lazyLabel} labelSide="right" />
        </div>

        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            padding: "0 56px",
          }}
        >
          {options.payoff ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                color: INK,
                fontSize: payoffFontSize(options.payoff),
                lineHeight: 1.2,
                fontFamily: "PT Sans Bold",
              }}
            >
              {highlightNumbers(options.payoff).map((part, i) => (
                <span
                  key={i}
                  style={{ whiteSpace: "pre-wrap", ...(part.highlight ? { color: ACCENT } : {}) }}
                >
                  {part.text}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 56px",
            background: ACCENT,
          }}
        >
          <span
            style={{ display: "flex", color: "white", fontSize: 24, fontFamily: "PT Sans Bold" }}
          >
            {BRAND_KICKER}
          </span>
          {options.showSwipeHint ? (
            <span
              style={{ display: "flex", color: "white", fontSize: 26, fontFamily: "PT Sans Bold" }}
            >
              Листай ➡️
            </span>
          ) : (
            <span style={{ display: "flex", color: "white", fontSize: 24, opacity: 0.85 }}>
              {CHANNEL_HANDLE}
            </span>
          )}
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

function CharacterHalf({
  src,
  label,
  labelSide,
  divider,
}: {
  src: string;
  label?: string;
  labelSide: "left" | "right";
  divider?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        width: HALF,
        height: HALF,
        position: "relative",
        ...(divider ? { borderRight: `4px solid ${INK}` } : {}),
      }}
    >
      {/* satori rasterises this element itself — next/image would mean nothing here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" width={HALF} height={HALF} style={{ width: HALF, height: HALF }} />
      {label ? (
        <div
          style={{
            position: "absolute",
            top: 28,
            ...(labelSide === "left" ? { left: 24 } : { right: 24 }),
            display: "flex",
            background: "white",
            border: `3px solid ${INK}`,
            borderRadius: 16,
            padding: "10px 18px",
            fontSize: 26,
            fontFamily: "PT Sans Bold",
            color: INK,
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
}

/** A long shared-trait line has to shrink to stay on two lines above the pictures. */
function sharedTraitFontSize(text: string): number {
  if (text.length > 60) return 44;
  if (text.length > 36) return 52;
  return 62;
}

/** The payoff band is ~215px tall — long takeaways need a smaller size to fit. */
function payoffFontSize(text: string): number {
  if (text.length > 120) return 32;
  if (text.length > 80) return 38;
  return 44;
}
