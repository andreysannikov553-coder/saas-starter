import { test } from "node:test";
import assert from "node:assert/strict";
import { parseComparisonCopy } from "./comparison-copy";

const SCRIPT = "HOOK: Обоим по 37\nVALUE: 20 минут ходьбы в день снижают риск смерти на 16%";

function validRaw(overrides: Record<string, unknown> = {}) {
  return {
    sharedTrait: "ОБОИМ 37 ЛЕТ",
    subline: "оба говорят: «у меня нет времени»",
    fitLabel: "06:30 подъём",
    lazyLabel: "2ч 47мин соцсетей",
    payoff: "Разница — 20 минут ходьбы в день. Риск смерти ниже на 16%.",
    ...overrides,
  };
}

test("parseComparisonCopy accepts valid card copy", () => {
  const copy = parseComparisonCopy(validRaw(), SCRIPT);

  assert.equal(copy.sharedTrait, "ОБОИМ 37 ЛЕТ");
  assert.equal(copy.subline, "оба говорят: «у меня нет времени»");
  assert.equal(copy.fitLabel, "06:30 подъём");
  assert.equal(copy.lazyLabel, "2ч 47мин соцсетей");
});

test("parseComparisonCopy accepts a null subline", () => {
  const copy = parseComparisonCopy(validRaw({ subline: null }), SCRIPT);
  assert.equal(copy.subline, undefined);
});

test("parseComparisonCopy rejects a missing field", () => {
  assert.throws(
    () => parseComparisonCopy(validRaw({ lazyLabel: "" }), SCRIPT),
    /lazyLabel must be a non-empty string/
  );
});

test("parseComparisonCopy rejects text the card cannot print", () => {
  const tooLong = "06:30 подъём, пробежка, контрастный душ и завтрак";
  assert.throws(() => parseComparisonCopy(validRaw({ fitLabel: tooLong }), SCRIPT), /over the 26/);
});

test("parseComparisonCopy rejects Latin letters in printed text", () => {
  assert.throws(
    () => parseComparisonCopy(validRaw({ fitLabel: "06:30 wake up" }), SCRIPT),
    /contains Latin letters/
  );
});

test("parseComparisonCopy rejects a payoff number the script never made", () => {
  // The model rounding 16% up to a punchier 40% is the failure this catches.
  assert.throws(
    () =>
      parseComparisonCopy(
        validRaw({ payoff: "Разница — 20 минут ходьбы. Риск смерти ниже на 40%." }),
        SCRIPT
      ),
    /payoff cites "40"/
  );
});

test("parseComparisonCopy allows unscripted numbers in the character labels", () => {
  // Labels describe the two characters' routines, not study findings.
  const copy = parseComparisonCopy(validRaw({ lazyLabel: "3ч 12мин соцсетей" }), SCRIPT);
  assert.equal(copy.lazyLabel, "3ч 12мин соцсетей");
});

test("parseComparisonCopy rejects a non-object", () => {
  assert.throws(() => parseComparisonCopy("nope", SCRIPT), /Expected an object/);
});

const SPELLED_SCRIPT =
  "VALUE: Двадцать минут быстрой ходьбы в день связаны со снижением риска смерти примерно на шестнадцать процентов.";

test("parseComparisonCopy grounds digits against numbers the script spelled out", () => {
  // Beats are written to be read aloud, so a dose usually appears as a word
  // there and as a digit on the card — this is the normal case, not an edge one.
  const copy = parseComparisonCopy(
    validRaw({ payoff: "Разница — 20 минут ходьбы. Риск смерти ниже на 16%." }),
    SPELLED_SCRIPT
  );

  assert.equal(copy.payoff, "Разница — 20 минут ходьбы. Риск смерти ниже на 16%.");
});

test("parseComparisonCopy still catches an invented number in a spelled-out script", () => {
  assert.throws(
    () => parseComparisonCopy(validRaw({ payoff: "Риск смерти ниже на 40%." }), SPELLED_SCRIPT),
    /payoff cites "40"/
  );
});

test("parseComparisonCopy grounds a compound numeral", () => {
  const copy = parseComparisonCopy(
    validRaw({ payoff: "Двадцать пять минут — это 25 минут в день." }),
    "VALUE: двадцать пять минут ходьбы"
  );

  assert.match(copy.payoff ?? "", /25/);
});
