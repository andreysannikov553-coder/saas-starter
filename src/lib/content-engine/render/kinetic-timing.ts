/**
 * Word-level timing for narrated text, without a forced aligner.
 *
 * Piper and `say` return audio only — no per-word timestamps. Spreading a
 * line's spoken duration over its words in proportion to their length, with
 * extra weight after punctuation (where a voice actually pauses), lands each
 * word within a fraction of a second of where it is said, which is all a
 * reveal animation needs. A real aligner would be exact and add a model
 * dependency for no visible gain.
 */

const COMMA_PAUSE = 4;
const SENTENCE_PAUSE = 8;
const DASH_PAUSE = 3;

export interface TimedWord {
  text: string;
  /** Seconds from the start of the line at which the word begins. */
  start: number;
  /** Seconds the word stays the "current" one. */
  duration: number;
}

export function splitWords(line: string): string[] {
  return line.split(/\s+/).filter((word) => word.length > 0);
}

function weightOf(word: string): number {
  const letters = word.replace(/[^\p{L}\p{N}]/gu, "").length;
  let weight = Math.max(letters, 1);
  if (/[.!?…]$/.test(word)) weight += SENTENCE_PAUSE;
  else if (/[,;:]$/.test(word)) weight += COMMA_PAUSE;
  else if (/^[—–-]$/.test(word)) weight = DASH_PAUSE;
  return weight;
}

/** Spreads `speechSeconds` over the words of `line`; durations sum to exactly `speechSeconds`. */
export function timeWords(line: string, speechSeconds: number): TimedWord[] {
  if (!Number.isFinite(speechSeconds) || speechSeconds <= 0) {
    throw new Error(`speechSeconds must be a positive number, got ${speechSeconds}`);
  }

  const words = splitWords(line);
  if (words.length === 0) return [];

  const weights = words.map(weightOf);
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  let cursor = 0;
  return words.map((text, i) => {
    const duration = (weights[i] / total) * speechSeconds;
    const timed = { text, start: cursor, duration };
    cursor += duration;
    return timed;
  });
}
