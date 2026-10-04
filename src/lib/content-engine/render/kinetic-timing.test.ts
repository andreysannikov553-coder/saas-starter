import { test } from "node:test";
import assert from "node:assert/strict";
import { splitWords, timeWords } from "./kinetic-timing";

test("splitWords ignores repeated and surrounding whitespace", () => {
  assert.deepEqual(splitWords("  Два   слова \n"), ["Два", "слова"]);
  assert.deepEqual(splitWords(""), []);
});

test("timeWords fills the spoken duration exactly", () => {
  const words = timeWords("Двадцать минут быстрой ходьбы в день.", 4.2);
  const last = words[words.length - 1];

  assert.ok(Math.abs(last.start + last.duration - 4.2) < 1e-9);
});

test("timeWords starts each word where the previous one ends", () => {
  const words = timeWords("Раз, два три", 3);

  for (let i = 1; i < words.length; i++) {
    assert.ok(Math.abs(words[i].start - (words[i - 1].start + words[i - 1].duration)) < 1e-9);
  }
  assert.equal(words[0].start, 0);
});

test("timeWords gives longer words more time", () => {
  const [short, long] = timeWords("в исследование", 2);
  assert.ok(long.duration > short.duration);
});

test("timeWords lingers after a comma and longer after a full stop", () => {
  // Identical five-letter words, so any difference is the pause a voice takes there.
  const [comma, stop, plain] = timeWords("слово, слово. слово", 3);

  assert.ok(comma.duration > plain.duration);
  assert.ok(stop.duration > comma.duration);
});

test("timeWords rejects a non-positive duration", () => {
  assert.throws(() => timeWords("слово", 0), /positive number/);
  assert.throws(() => timeWords("слово", Number.NaN), /positive number/);
});

test("timeWords returns nothing for an empty line", () => {
  assert.deepEqual(timeWords("   ", 2), []);
});
