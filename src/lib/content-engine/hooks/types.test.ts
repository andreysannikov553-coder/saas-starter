import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGeneratedHooks, HOOK_SCORE_THRESHOLD } from "./types";

function score(overrides: Partial<Record<string, number>> = {}) {
  return {
    understandingSpeed: 4,
    personalRelevance: 4,
    knowledgeGap: 4,
    promiseHonesty: 4,
    noveltyOfPhrasing: 4,
    ...overrides,
  };
}

function validRaw(overrides: { hooks?: unknown[] } = {}) {
  return {
    hooks: overrides.hooks ?? [
      { text: "Hook A", hookType: "обвинение", score: score() },
      { text: "Hook B", hookType: "гипотеза", score: score() },
      { text: "Hook C", hookType: "скрытая деталь", score: score() },
    ],
  };
}

test("parseGeneratedHooks accepts a valid 3-hook set and computes the total", () => {
  const result = parseGeneratedHooks(validRaw());
  assert.equal(result.hooks.length, 3);
  assert.equal(result.hooks[0].total, 20);
});

test("parseGeneratedHooks rejects the wrong hook count", () => {
  const raw = validRaw({ hooks: [{ text: "Only one", hookType: "гипотеза", score: score() }] });
  assert.throws(() => parseGeneratedHooks(raw), /must be an array of exactly 3 entries/);
});

test("parseGeneratedHooks rejects an out-of-range score", () => {
  const raw = validRaw({
    hooks: [
      { text: "A", hookType: "x", score: score({ understandingSpeed: 6 }) },
      { text: "B", hookType: "x", score: score() },
      { text: "C", hookType: "x", score: score() },
    ],
  });
  assert.throws(() => parseGeneratedHooks(raw), /must be an integer between 0 and 5/);
});

test("parseGeneratedHooks rejects a non-integer score", () => {
  const raw = validRaw({
    hooks: [
      { text: "A", hookType: "x", score: score({ personalRelevance: 3.5 }) },
      { text: "B", hookType: "x", score: score() },
      { text: "C", hookType: "x", score: score() },
    ],
  });
  assert.throws(() => parseGeneratedHooks(raw), /must be an integer between 0 and 5/);
});

test("parseGeneratedHooks rejects a missing criterion", () => {
  const incompleteScore = score();
  delete (incompleteScore as Partial<typeof incompleteScore>).noveltyOfPhrasing;
  const raw = validRaw({
    hooks: [
      { text: "A", hookType: "x", score: incompleteScore },
      { text: "B", hookType: "x", score: score() },
      { text: "C", hookType: "x", score: score() },
    ],
  });
  assert.throws(() => parseGeneratedHooks(raw), /must be an integer between 0 and 5/);
});

test("parseGeneratedHooks rejects empty hook text", () => {
  const raw = validRaw({
    hooks: [
      { text: "   ", hookType: "x", score: score() },
      { text: "B", hookType: "x", score: score() },
      { text: "C", hookType: "x", score: score() },
    ],
  });
  assert.throws(() => parseGeneratedHooks(raw), /text must be a non-empty string/);
});

test("parseGeneratedHooks rejects a missing hooks key", () => {
  assert.throws(
    () => parseGeneratedHooks({ notHooks: [] }),
    /Expected an object with a 'hooks' array/
  );
});

test("a low-score set correctly reports under threshold", () => {
  const raw = validRaw({
    hooks: [
      {
        text: "A",
        hookType: "x",
        score: score({ understandingSpeed: 0, personalRelevance: 0, knowledgeGap: 1 }),
      },
      {
        text: "B",
        hookType: "x",
        score: score({ understandingSpeed: 1, personalRelevance: 0, knowledgeGap: 0 }),
      },
      {
        text: "C",
        hookType: "x",
        score: score({ understandingSpeed: 0, personalRelevance: 1, knowledgeGap: 0 }),
      },
    ],
  });
  const result = parseGeneratedHooks(raw);
  const bestTotal = Math.max(...result.hooks.map((h) => h.total));
  assert.ok(bestTotal < HOOK_SCORE_THRESHOLD);
});
