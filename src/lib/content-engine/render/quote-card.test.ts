import { test } from "node:test";
import assert from "node:assert/strict";
import { highlightNumbers } from "./quote-card";

/** The runs are laid out as wrapping flex items, so joining them back must reproduce the input exactly. */
function join(parts: Array<{ text: string; highlight: boolean }>): string {
  return parts.map((part) => part.text).join("");
}

test("highlightNumbers marks numbers and leaves the text intact", () => {
  const text = "Ходьба снижает риск смерти на 16%.";
  const parts = highlightNumbers(text);

  assert.equal(join(parts), text);
  assert.deepEqual(
    parts.filter((part) => part.highlight).map((part) => part.text.trim()),
    ["16%"]
  );
});

test("highlightNumbers splits plain text one word per run", () => {
  // A run only ever wraps as a whole, so multi-word runs put the whole phrase
  // on the next line and leave a ragged gap behind the number before it.
  const parts = highlightNumbers("12 000 шагов в день снижают риск");

  assert.deepEqual(
    parts.map((part) => part.text),
    ["12 000 ", "шагов ", "в ", "день ", "снижают ", "риск"]
  );
  assert.deepEqual(
    parts.map((part) => part.highlight),
    [true, false, false, false, false, false]
  );
});

test("highlightNumbers keeps a thousands separator inside one run", () => {
  const [first] = highlightNumbers("12 000 шагов");
  assert.equal(first.text.trim(), "12 000");
  assert.equal(first.highlight, true);
});

test("highlightNumbers never starts a run with whitespace", () => {
  const parts = highlightNumbers("  риск   смерти  на  16 %  ");
  assert.equal(join(parts), "  риск   смерти  на  16 %  ");
  for (const part of parts.slice(1)) {
    assert.equal(part.text, part.text.trimStart(), `run "${part.text}" starts with whitespace`);
  }
});

test("highlightNumbers handles text with no numbers at all", () => {
  const text = "Сон важнее, чем кажется";
  const parts = highlightNumbers(text);

  assert.equal(join(parts), text);
  assert.equal(
    parts.some((part) => part.highlight),
    false
  );
});

test("highlightNumbers returns nothing for empty text", () => {
  assert.deepEqual(highlightNumbers(""), []);
});
