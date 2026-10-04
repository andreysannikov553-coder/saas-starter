import { logger } from "../observability/logger";
import type { LLMProvider } from "../llm/types";
import { renderCarouselSlides, type CarouselBeat } from "./quote-card";
import { renderComparisonCard } from "./comparison-card";
import { generateComparisonCopy } from "./comparison-copy";

/** Both Telegram media groups and Instagram carousels cap out at 10 images. */
export const MAX_SLIDES = 10;

/** The one template published as a comparison image — see SCRIPT_TEMPLATES. */
export const COMPARISON_TEMPLATE_SLUG = "habit-contrast";

export interface PostScript {
  templateSlug: string | null;
  beats: CarouselBeat[];
}

/**
 * Renders the images for one post: the usual text carousel, led by a
 * comparison card when the script was written to the habit-contrast
 * template.
 *
 * The cover is best-effort on purpose. It costs an extra LLM call whose
 * output is validated hard (slot lengths, Russian only, numbers grounded in
 * the script), so it can legitimately fail on a post that would otherwise
 * publish fine — and a post that goes out without its cover is a worse-looking
 * post, while a post that doesn't go out at all is a missed day. Publishing's
 * own carousel -> single card -> text fallback chain sits below this.
 */
export interface RenderPostSlidesOptions {
  provider?: LLMProvider;
  /**
   * Render the slides as video frames rather than as a swipeable post: no
   * slide counter, no "Листай ➡️" hint. Both tell a viewer to do something
   * a video does not let them do.
   */
  forVideo?: boolean;
}

export async function renderPostSlides(
  script: PostScript,
  options: RenderPostSlidesOptions = {}
): Promise<Buffer[]> {
  const [cover, beatSlides] = await Promise.all([
    renderComparisonCover(script, options),
    renderCarouselSlides(script.beats, { showPagination: !options.forVideo }),
  ]);

  return composeSlides(cover, beatSlides);
}

async function renderComparisonCover(
  script: PostScript,
  options: RenderPostSlidesOptions
): Promise<Buffer | null> {
  if (script.templateSlug !== COMPARISON_TEMPLATE_SLUG) return null;

  try {
    const copy = await generateComparisonCopy(script.beats, options);
    const showSwipeHint = !options.forVideo && script.beats.length > 1;
    return await renderComparisonCard({ ...copy, showSwipeHint });
  } catch (error) {
    logger.warn("render", "comparison_cover_skipped", {
      templateSlug: script.templateSlug,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Puts the cover first and keeps the post within the platform limit.
 *
 * Trimming from the end rather than dropping the cover: the beats' last slide
 * is the CTA, which repeats on every post, while the cover is the reason this
 * post stops a thumb.
 */
export function composeSlides(cover: Buffer | null, beatSlides: Buffer[]): Buffer[] {
  const slides = cover ? [cover, ...beatSlides] : beatSlides;
  return slides.slice(0, MAX_SLIDES);
}
