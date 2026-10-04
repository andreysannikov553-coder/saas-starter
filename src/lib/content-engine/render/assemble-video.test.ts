import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleSlideshowVideo, TRANSITION_SECONDS } from "./assemble-video";

/**
 * Only the argument checks that run before ffmpeg is spawned — they are the
 * ones worth a test, since a bad duration list otherwise surfaces as a
 * silently truncated video rather than an error.
 */
const SLIDES = [Buffer.from("a"), Buffer.from("b"), Buffer.from("c")];

test("assembleSlideshowVideo refuses an empty slide list", async () => {
  await assert.rejects(() => assembleSlideshowVideo([]), /at least 1 slide/);
});

test("assembleSlideshowVideo refuses a duration list that does not match the slides", async () => {
  await assert.rejects(
    () => assembleSlideshowVideo(SLIDES, { slideSeconds: [3, 4] }),
    /2 durations for 3 slides/
  );
});

test("assembleSlideshowVideo refuses a slide shorter than the crossfade", async () => {
  // A slide this short cannot survive the fade in and out of itself, and
  // ffmpeg would produce overlapping xfade offsets rather than fail.
  await assert.rejects(
    () => assembleSlideshowVideo(SLIDES, { slideSeconds: [4, TRANSITION_SECONDS, 4] }),
    /slideSeconds\[1\] must be a number longer than the 0.6s crossfade/
  );
});

test("assembleSlideshowVideo refuses a single duration shorter than the crossfade", async () => {
  await assert.rejects(
    () => assembleSlideshowVideo(SLIDES, { slideSeconds: 0.2 }),
    /slideSeconds must be a number longer than/
  );
});
