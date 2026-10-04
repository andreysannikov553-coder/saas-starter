import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import type { CarouselBeat } from "./quote-card";

/**
 * renderPostSlides is orchestration: which renderer runs, in which order,
 * and what happens when the cover fails. The renderers themselves are mocked
 * out — real rasterisation is seconds per image and proves nothing about the
 * branching this module exists for.
 */
const state = { copyCalls: 0, copyFails: false, showPagination: undefined as boolean | undefined };

mock.module("./quote-card", {
  namedExports: {
    renderCarouselSlides: async (beats: CarouselBeat[], options: { showPagination?: boolean }) => {
      state.showPagination = options?.showPagination;
      return beats.map((_, i) => Buffer.from(`slide-${i}`));
    },
  },
});

mock.module("./comparison-card", {
  namedExports: {
    renderComparisonCard: async () => Buffer.from("cover"),
  },
});

mock.module("./comparison-copy", {
  namedExports: {
    generateComparisonCopy: async () => {
      state.copyCalls += 1;
      if (state.copyFails) throw new Error('payoff cites "40", which appears nowhere');
      return { sharedTrait: "ОБОИМ 37 ЛЕТ", fitLabel: "а", lazyLabel: "б", payoff: "в" };
    },
  },
});

let renderPostSlides: typeof import("./slides").renderPostSlides;
let composeSlides: typeof import("./slides").composeSlides;
let MAX_SLIDES: number;

before(async () => {
  ({ renderPostSlides, composeSlides, MAX_SLIDES } = await import("./slides"));
});

function beats(count: number): CarouselBeat[] {
  return Array.from({ length: count }, (_, i) => ({ role: "VALUE", line: `строка ${i}` }));
}

test("renderPostSlides leads a habit-contrast post with the comparison card", async () => {
  state.copyCalls = 0;
  state.copyFails = false;

  const slides = await renderPostSlides({ templateSlug: "habit-contrast", beats: beats(4) });

  assert.equal(state.copyCalls, 1);
  assert.equal(slides.length, 5);
  assert.equal(slides[0].toString(), "cover");
  assert.equal(slides[1].toString(), "slide-0");
});

test("renderPostSlides leaves every other template as a plain carousel", async () => {
  state.copyCalls = 0;
  state.copyFails = false;

  const slides = await renderPostSlides({ templateSlug: "mechanism-explainer", beats: beats(4) });

  assert.equal(state.copyCalls, 0, "no LLM call for a template that has no comparison card");
  assert.equal(slides.length, 4);
  assert.equal(slides[0].toString(), "slide-0");
});

test("renderPostSlides publishes without the cover when its copy fails validation", async () => {
  state.copyCalls = 0;
  state.copyFails = true;

  const slides = await renderPostSlides({ templateSlug: "habit-contrast", beats: beats(4) });

  assert.equal(slides.length, 4);
  assert.equal(slides[0].toString(), "slide-0");
});

test("renderPostSlides stays within the platform slide limit", async () => {
  state.copyFails = false;

  const slides = await renderPostSlides({ templateSlug: "habit-contrast", beats: beats(10) });

  assert.equal(slides.length, MAX_SLIDES);
  assert.equal(slides[0].toString(), "cover");
});

test("composeSlides trims from the end so the cover survives", () => {
  const cover = Buffer.from("cover");
  const beatSlides = Array.from({ length: 12 }, (_, i) => Buffer.from(`slide-${i}`));

  const slides = composeSlides(cover, beatSlides);

  assert.equal(slides.length, MAX_SLIDES);
  assert.equal(slides[0].toString(), "cover");
  assert.equal(slides[MAX_SLIDES - 1].toString(), `slide-${MAX_SLIDES - 2}`);
});

test("composeSlides returns the carousel untouched when there is no cover", () => {
  const beatSlides = [Buffer.from("slide-0"), Buffer.from("slide-1")];
  assert.deepEqual(composeSlides(null, beatSlides), beatSlides);
});

test("renderPostSlides drops the swipe affordances when the slides become video frames", async () => {
  state.copyFails = false;
  state.showPagination = undefined;

  const slides = await renderPostSlides(
    { templateSlug: "habit-contrast", beats: beats(4) },
    { forVideo: true }
  );

  assert.equal(state.showPagination, false, "no slide counter in a video");
  assert.equal(slides.length, 5);
});

test("renderPostSlides keeps the swipe affordances for a post", async () => {
  state.copyFails = false;
  state.showPagination = undefined;

  await renderPostSlides({ templateSlug: "mechanism-explainer", beats: beats(3) });

  assert.equal(state.showPagination, true);
});
