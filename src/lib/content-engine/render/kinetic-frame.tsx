import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { numeralValue } from "./comparison-copy";

const FONTS_DIR = path.join(process.cwd(), "src/lib/content-engine/render/fonts");
const BACKGROUNDS_DIR = path.join(process.cwd(), "src/lib/content-engine/render/backgrounds");
/**
 * Only the dark, on-brand teal textures. The photographic and multicolour
 * backgrounds the carousel rotates through fight the text here: with the
 * words as the whole picture, anything busy behind them costs legibility,
 * and one of them (bg6) carries AI-garbled lettering of its own.
 */
const BACKGROUND_FILES = ["bg1.jpg", "bg2.jpg", "bg3.jpg"];

export const FRAME_WIDTH = 1080;
export const FRAME_HEIGHT = 1920;

const ACCENT = "#fbbf24";
const BRAND_KICKER = "Доказательное здоровье";
const CHANNEL_HANDLE = "t.me/channel_of_health";
/** Words not yet spoken stay on screen, dimmed, so the block never reflows as it fills in. */
const UPCOMING_OPACITY = 0.28;

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

const backgroundCache = new Map<number, string>();
async function loadBackground(index: number): Promise<string> {
  const key = index % BACKGROUND_FILES.length;
  let cached = backgroundCache.get(key);
  if (!cached) {
    const buf = await readFile(path.join(BACKGROUNDS_DIR, BACKGROUND_FILES[key]));
    cached = `data:image/jpeg;base64,${buf.toString("base64")}`;
    backgroundCache.set(key, cached);
  }
  return cached;
}

export interface KineticFrameOptions {
  words: string[];
  /** Index of the word being spoken now; words before it are spoken, after it are upcoming. */
  activeIndex: number;
  /** 0..1 — how far through the whole video this frame is. */
  progress: number;
  bgIndex: number;
  /** Bigger type for the opening line, which has to stop the scroll on its own. */
  isHook?: boolean;
  isOutro?: boolean;
}

/** A digit, a percent sign, or a spoken number ("двадцать", "шестнадцати") — the words worth colouring. */
export function isNumberWord(word: string): boolean {
  if (/\d/.test(word)) return true;
  const letters = word.toLowerCase().replace(/[^а-яё]/g, "");
  if (/^процент/.test(letters)) return true;
  // "один/одна/одно" is an article in Russian as often as a quantity ("одна
  // привычка"), so it is never worth colouring; every larger numeral is data.
  const value = letters.length > 2 ? numeralValue(letters) : null;
  return value !== null && value !== 1;
}

export function kineticFontSize(words: string[], isHook: boolean): number {
  const chars = words.join(" ").length;
  const base = chars > 130 ? 80 : chars > 95 ? 92 : chars > 60 ? 104 : 118;
  return isHook ? base + 8 : base;
}

export async function renderKineticFrame(options: KineticFrameOptions): Promise<Buffer> {
  const [fonts, background] = await Promise.all([loadFonts(), loadBackground(options.bgIndex)]);
  const fontSize = kineticFontSize(options.words, options.isHook ?? false);
  const progressWidth = Math.max(0, Math.min(1, options.progress)) * (FRAME_WIDTH - 160);

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundImage: `url(${background})`,
          backgroundSize: `${FRAME_HEIGHT}px ${FRAME_HEIGHT}px`,
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            backgroundImage:
              "linear-gradient(180deg, rgba(3,14,12,0.9) 0%, rgba(3,14,12,0.55) 30%, rgba(3,14,12,0.6) 70%, rgba(3,14,12,0.94) 100%)",
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
            padding: "120px 80px 110px 80px",
            fontFamily: "PT Sans Bold",
          }}
        >
          <div style={{ display: "flex" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                background: "rgba(3,14,12,0.55)",
                border: `3px solid ${ACCENT}`,
                borderRadius: 999,
                padding: "14px 30px 14px 22px",
              }}
            >
              <svg width="36" height="36" viewBox="0 0 40 40">
                <polyline
                  points="0,24 8,24 11,15 16,32 20,8 24,24 40,24"
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth={4}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
              <span style={{ display: "flex", color: "white", fontSize: 32 }}>{BRAND_KICKER}</span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              columnGap: Math.round(fontSize * 0.26),
              rowGap: Math.round(fontSize * 0.08),
              lineHeight: 1.1,
              fontSize,
              textShadow: "0 6px 34px rgba(0,0,0,0.6)",
            }}
          >
            {options.words.map((word, i) => {
              const spoken = i < options.activeIndex;
              const current = i === options.activeIndex;
              const numeric = isNumberWord(word);
              return (
                <span
                  key={i}
                  style={{
                    display: "flex",
                    color: current || (numeric && i <= options.activeIndex) ? ACCENT : "white",
                    opacity: spoken || current ? 1 : UPCOMING_OPACITY,
                  }}
                >
                  {word}
                </span>
              );
            })}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
            <div
              style={{
                display: "flex",
                width: FRAME_WIDTH - 160,
                height: 8,
                background: "rgba(255,255,255,0.18)",
              }}
            >
              <div
                style={{ display: "flex", width: progressWidth, height: 8, background: ACCENT }}
              />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 30,
                color: "white",
              }}
            >
              <span style={{ display: "flex", opacity: 0.75, fontFamily: "PT Sans" }}>
                {CHANNEL_HANDLE}
              </span>
              {options.isOutro ? (
                <span
                  style={{
                    display: "flex",
                    color: "#03110e",
                    background: ACCENT,
                    borderRadius: 999,
                    padding: "12px 30px",
                  }}
                >
                  Подписывайся ✅
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      fonts: [
        { name: "PT Sans", data: fonts.regular, weight: 400, style: "normal" },
        { name: "PT Sans Bold", data: fonts.bold, weight: 700, style: "normal" },
      ],
    }
  );

  return Buffer.from(await image.arrayBuffer());
}
