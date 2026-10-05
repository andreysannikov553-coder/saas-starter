import { getLLMProvider } from "../llm";
import type { LLMProvider } from "../llm/types";
import { assertSpokenRussian } from "../scripts/types";
import type { ComparisonCardOptions } from "./comparison-card";

export const COMPARISON_COPY_SCHEMA_NAME = "comparison_card_copy";

/**
 * The card is a fixed layout, not a flowing page: every field has a slot of a
 * known width, and text that overruns it either shrinks to unreadable or
 * collides with the pictures. These are the lengths the slots actually hold
 * at the sizes in comparison-card.tsx, checked against rendered output — the
 * schema asks for them and `parseComparisonCopy` enforces them, because a
 * maxLength in a JSON Schema is a request, not a guarantee.
 */
const LIMITS = {
  sharedTrait: 48,
  subline: 64,
  label: 26,
  payoff: 140,
} as const;

export const COMPARISON_COPY_JSON_SCHEMA = {
  type: "object",
  properties: {
    sharedTrait: {
      type: "string",
      maxLength: LIMITS.sharedTrait,
      description:
        'What the two men have in common, in capital letters, e.g. "ОБОИМ 37 ЛЕТ". Short — it is the headline.',
    },
    subline: {
      type: ["string", "null"],
      maxLength: LIMITS.subline,
      description:
        'A second shared detail in lower case, e.g. "оба говорят: «у меня нет времени»". Null if nothing fits.',
    },
    fitLabel: {
      type: "string",
      maxLength: LIMITS.label,
      description:
        'The daily habit of the man on the left, as a measurable detail, e.g. "06:30 подъём" or "8 000 шагов". A habit, never a body or a character trait.',
    },
    lazyLabel: {
      type: "string",
      maxLength: LIMITS.label,
      description:
        'The contrasting daily habit of the man on the right, same shape, e.g. "2ч 47мин соцсетей". A habit, never a body or a character trait.',
    },
    payoff: {
      type: "string",
      maxLength: LIMITS.payoff,
      description:
        "One sentence under the pictures: what the difference between those two habits actually buys, with the number from the script. This is the factual line of the card.",
    },
  },
  required: ["sharedTrait", "subline", "fitLabel", "lazyLabel", "payoff"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You write the copy for one comparison image on a Russian evidence-based
health channel. The image shows two men side by side: the same man's two possible days, not a
hero and a villain.

Rules, non-negotiable:
- Write every field in Russian. No English words, no Latin letters, no claim ids, no source
  markers — this text is printed on the image exactly as you write it.
- The contrast is between two HABITS, never between two bodies or two characters. Never write
  that one is fat, lazy, weak-willed, a loser, or that the other is better as a person. "2ч 47мин
  соцсетей" is a habit; "ленивый" is an insult and gets the card thrown away.
- The payoff sentence states what the habit difference buys, using a number that already appears
  in the script beats you are given. Never invent a number, never round one into a different one,
  never promise a cure or a diagnosis.
- Keep every field inside its length limit — longer text does not fit the image.
- The two labels must be the same shape as each other (both a time, both a count, both a
  duration), so the contrast reads at a glance.`;

/**
 * Turns a finished habit-contrast script into the five strings the comparison
 * card prints. A separate, small call rather than extra fields on the script
 * schema: the card's copy is presentation (slot-sized, capitalised, printed
 * verbatim), and every script would otherwise have to carry five fields that
 * only one template uses.
 */
export async function generateComparisonCopy(
  beats: { role: string; line: string }[],
  options: { provider?: LLMProvider } = {}
): Promise<ComparisonCardOptions> {
  const provider = options.provider ?? getLLMProvider();
  const scriptText = beats.map((beat) => `${beat.role}: ${beat.line}`).join("\n");

  return provider.generateStructured({
    system: SYSTEM_PROMPT,
    prompt: `Script beats:\n${scriptText}\n\nWrite the comparison card copy for this script.`,
    schemaName: COMPARISON_COPY_SCHEMA_NAME,
    schema: COMPARISON_COPY_JSON_SCHEMA,
    parse: (raw) => parseComparisonCopy(raw, scriptText),
    maxTokens: 2048,
  });
}

/**
 * Validates raw model output into card copy, or throws.
 *
 * `groundingText` is the script the copy was written from: any number in the
 * payoff must already appear there. The payoff is the one line on the card a
 * reader will take as a fact, and a model asked to "state the benefit" will
 * happily produce a cleaner-sounding number than the study's. The labels are
 * deliberately NOT held to this — they describe the two characters' routines
 * ("06:30 подъём"), which are illustration, not findings.
 */
export function parseComparisonCopy(raw: unknown, groundingText = ""): ComparisonCardOptions {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Expected an object with the comparison card fields");
  }

  const { sharedTrait, subline, fitLabel, lazyLabel, payoff } = raw as Record<string, unknown>;

  const copy: ComparisonCardOptions = {
    sharedTrait: requireField(sharedTrait, "sharedTrait", LIMITS.sharedTrait),
    fitLabel: requireField(fitLabel, "fitLabel", LIMITS.label),
    lazyLabel: requireField(lazyLabel, "lazyLabel", LIMITS.label),
    payoff: requireField(payoff, "payoff", LIMITS.payoff),
  };

  if (subline !== null && subline !== undefined) {
    const trimmed = requireField(subline, "subline", LIMITS.subline);
    copy.subline = trimmed;
  }

  assertNumbersGrounded(copy.payoff ?? "", groundingText);

  return copy;
}

function requireField(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(
      `${field} is ${trimmed.length} characters, over the ${maxLength} the card can print: "${trimmed}"`
    );
  }

  assertSpokenRussian(trimmed, field);
  return trimmed;
}

const DIGIT_RUN_PATTERN = /\d+/g;

/**
 * Russian numeral stems, longest first so "двадцат" wins over "два". Stems,
 * not whole words, because the script beats are spoken Russian and inflect
 * them freely ("двадцати минутам", "шестнадцатью процентами").
 */
const NUMERAL_STEMS: [string, number][] = (
  [
    ["ноль", 0],
    ["один", 1],
    ["одн", 1],
    ["два", 2],
    ["две", 2],
    ["двух", 2],
    ["три", 3],
    ["трех", 3],
    ["трёх", 3],
    ["четыре", 4],
    ["четырех", 4],
    ["четырёх", 4],
    ["пять", 5],
    ["пяти", 5],
    ["шесть", 6],
    ["шести", 6],
    ["семь", 7],
    ["семи", 7],
    ["восемь", 8],
    ["восьми", 8],
    ["девять", 9],
    ["девяти", 9],
    ["десять", 10],
    ["десяти", 10],
    ["одиннадцат", 11],
    ["двенадцат", 12],
    ["тринадцат", 13],
    ["четырнадцат", 14],
    ["пятнадцат", 15],
    ["шестнадцат", 16],
    ["семнадцат", 17],
    ["восемнадцат", 18],
    ["девятнадцат", 19],
    ["двадцат", 20],
    ["тридцат", 30],
    ["сорок", 40],
    ["пятьдесят", 50],
    ["пятидесят", 50],
    ["шестьдесят", 60],
    ["шестидесят", 60],
    ["семьдесят", 70],
    ["семидесят", 70],
    ["восемьдесят", 80],
    ["восьмидесят", 80],
    ["девяност", 90],
    ["сто", 100],
    ["ста", 100],
    ["двести", 200],
    ["двухсот", 200],
    ["триста", 300],
    ["четыреста", 400],
    ["пятьсот", 500],
    ["тысяч", 1000],
  ] as [string, number][]
).sort((a, b) => b[0].length - a[0].length);

export function numeralValue(word: string): number | null {
  for (const [stem, value] of NUMERAL_STEMS) {
    if (word.startsWith(stem)) return value;
  }
  return null;
}

/**
 * Every number the script states, in digits — including the ones it spells
 * out. The beats are written to be read aloud, so "двадцать минут ходьбы"
 * is the normal way a dose appears there, while the card's copy writes the
 * same number as "20". Without this, grounding rejected copy that was
 * faithful to the script (found on the first live run).
 *
 * Deliberately permissive: a word run adds its parts and its running total
 * ("сто двадцать пять" -> 100, 120, 125), and a stem can match a non-numeral
 * that happens to start the same way. Every error it makes widens what counts
 * as grounded, never narrows it — the check exists to catch a number the
 * script never mentioned at all, not to police phrasing.
 */
function groundedNumbers(text: string): Set<string> {
  const numbers = new Set(text.match(DIGIT_RUN_PATTERN) ?? []);

  let runTotal = 0;
  let previous = Number.POSITIVE_INFINITY;
  for (const word of text.toLowerCase().split(/[^а-яё]+/)) {
    const value = word ? numeralValue(word) : null;
    if (value === null) {
      runTotal = 0;
      previous = Number.POSITIVE_INFINITY;
      continue;
    }
    if (value >= previous) runTotal = 0;
    runTotal += value;
    previous = value;
    numbers.add(String(value));
    numbers.add(String(runTotal));
  }

  return numbers;
}

function assertNumbersGrounded(payoff: string, groundingText: string): void {
  if (!groundingText) return;

  const grounded = groundedNumbers(groundingText);
  for (const number of payoff.match(DIGIT_RUN_PATTERN) ?? []) {
    if (!grounded.has(number)) {
      throw new Error(
        `payoff cites "${number}", which appears nowhere in the script it was written from: "${payoff}"`
      );
    }
  }
}
