import { test } from "node:test";
import assert from "node:assert/strict";
import { isNumberWord, kineticFontSize } from "./kinetic-frame";

test("isNumberWord colours digits, spoken numerals and percent", () => {
  for (const word of ["20", "16%", "двадцать", "Шестнадцать", "процентов.", "тридцать"]) {
    assert.equal(isNumberWord(word), true, word);
  }
});

test("isNumberWord leaves ordinary words and the article-like 'one' alone", () => {
  for (const word of ["ходьбы", "привычка", "одна", "одно", "в", "день,"]) {
    assert.equal(isNumberWord(word), false, word);
  }
});

test("kineticFontSize shrinks as the line grows and enlarges the hook", () => {
  const short = ["Слово", "слово"];
  const long = Array(30).fill("слово");

  assert.ok(kineticFontSize(long, false) < kineticFontSize(short, false));
  assert.ok(kineticFontSize(short, true) > kineticFontSize(short, false));
});
