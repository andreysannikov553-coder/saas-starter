/**
 * The five hook-scoring criteria from discovery doc section 4 (Hook Optimizer):
 * скорость понимания (speed of understanding), личная релевантность (personal
 * relevance), разрыв в знании (curiosity/knowledge gap), честность обещания
 * (promise honesty — no bait the VALUE beat can't pay off), новизна
 * формулировки (novelty of phrasing). Each is scored 0-5 by the model; a
 * script whose best variant falls below the threshold goes back for a rewrite
 * rather than being published on a weak hook.
 */
export const HOOK_CRITERIA = [
  "understandingSpeed",
  "personalRelevance",
  "knowledgeGap",
  "promiseHonesty",
  "noveltyOfPhrasing",
] as const;

export type HookCriterion = (typeof HOOK_CRITERIA)[number];

/** Sum below this out of 25 (5 criteria x 0-5) means: rewrite, don't publish. */
export const HOOK_SCORE_THRESHOLD = 15;

export const HOOK_VARIANTS_PER_SCRIPT = 3;

export interface GeneratedHook {
  text: string;
  hookType: string;
  score: Record<HookCriterion, number>;
  total: number;
}

export interface GeneratedHookSet {
  hooks: GeneratedHook[];
}

export const GENERATED_HOOKS_SCHEMA_NAME = "generated_hooks";

const scoreProperty = {
  type: "integer",
  minimum: 0,
  maximum: 5,
} as const;

export const GENERATED_HOOKS_JSON_SCHEMA = {
  type: "object",
  properties: {
    hooks: {
      type: "array",
      minItems: HOOK_VARIANTS_PER_SCRIPT,
      maxItems: HOOK_VARIANTS_PER_SCRIPT,
      items: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The hook line itself — what plays in the first 1-2 seconds.",
          },
          hookType: {
            type: "string",
            description:
              'Short label for the hook\'s angle, e.g. "обвинение", "гипотеза", "скрытая деталь" (discovery doc section 18.2).',
          },
          score: {
            type: "object",
            properties: {
              understandingSpeed: {
                ...scoreProperty,
                description: "Скорость понимания: 0-5, can a viewer get it in under 1 second?",
              },
              personalRelevance: {
                ...scoreProperty,
                description: "Личная релевантность: 0-5, does this land as 'about me'?",
              },
              knowledgeGap: {
                ...scoreProperty,
                description: "Разрыв в знании: 0-5, how strong is the open curiosity loop?",
              },
              promiseHonesty: {
                ...scoreProperty,
                description:
                  "Честность обещания: 0-5, does the script's VALUE/PAYOFF actually deliver what this hook promises? 0 if it overpromises.",
              },
              noveltyOfPhrasing: {
                ...scoreProperty,
                description:
                  "Новизна формулировки: 0-5, is this phrasing fresh rather than a cliche opener?",
              },
            },
            required: [
              "understandingSpeed",
              "personalRelevance",
              "knowledgeGap",
              "promiseHonesty",
              "noveltyOfPhrasing",
            ],
            additionalProperties: false,
          },
        },
        required: ["text", "hookType", "score"],
        additionalProperties: false,
      },
    },
  },
  required: ["hooks"],
  additionalProperties: false,
} as const;

/**
 * Validates and narrows a raw parsed object into a GeneratedHookSet.
 *
 * Recomputes `total` itself from the individual scores rather than trusting
 * a model-reported sum, and re-checks every score is an integer 0-5 — the
 * same "never trust the schema alone" pattern as claim/script parsing.
 */
export function parseGeneratedHooks(raw: unknown): GeneratedHookSet {
  if (typeof raw !== "object" || raw === null || !("hooks" in raw)) {
    throw new Error("Expected an object with a 'hooks' array");
  }

  const hooks = (raw as { hooks: unknown }).hooks;
  if (!Array.isArray(hooks) || hooks.length !== HOOK_VARIANTS_PER_SCRIPT) {
    throw new Error(`'hooks' must be an array of exactly ${HOOK_VARIANTS_PER_SCRIPT} entries`);
  }

  return { hooks: hooks.map((entry, index) => validateHook(entry, index)) };
}

function validateHook(entry: unknown, index: number): GeneratedHook {
  if (typeof entry !== "object" || entry === null) {
    throw new Error(`hooks[${index}] is not an object`);
  }

  const { text, hookType, score } = entry as Record<string, unknown>;

  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error(`hooks[${index}].text must be a non-empty string`);
  }

  if (typeof hookType !== "string" || hookType.trim().length === 0) {
    throw new Error(`hooks[${index}].hookType must be a non-empty string`);
  }

  if (typeof score !== "object" || score === null) {
    throw new Error(`hooks[${index}].score must be an object`);
  }

  const validated = {} as Record<HookCriterion, number>;
  let total = 0;
  for (const criterion of HOOK_CRITERIA) {
    const value = (score as Record<string, unknown>)[criterion];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 5) {
      throw new Error(`hooks[${index}].score.${criterion} must be an integer between 0 and 5`);
    }
    validated[criterion] = value;
    total += value;
  }

  return {
    text: text.trim(),
    hookType: hookType.trim(),
    score: validated,
    total,
  };
}
