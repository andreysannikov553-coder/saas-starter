import { BeatRole } from "@prisma/client";

/**
 * The reusable scenario templates — the six from discovery doc section 18.2
 * (the trend research done for this project) plus habit-contrast, added for
 * the comparison-card format. Each is a proven scaffold, not a free-form
 * prompt: the model picks one and fills it, it doesn't invent structure from
 * scratch.
 */
export const SCRIPT_TEMPLATES = [
  {
    slug: "organ-dialogue",
    label: "Диалог органов",
    description:
      "Body organs argue with each other as characters. Conflict drives the fact home instead of a lecture.",
  },
  {
    slug: "what-if-experiment",
    label: "Что будет, если...",
    description: "A hypothetical self-experiment with the body (What If You Did X Every Day?).",
  },
  {
    slug: "product-debunk",
    label: "Разоблачение продукта",
    description:
      '"You\'re being scammed by X industry" — exposes a common misconception about a product or habit.',
  },
  {
    slug: "ranked-list",
    label: "Ранжированный список",
    description: "A ranked list of foods/organs/habits (Best Foods for Every Organ).",
  },
  {
    slug: "mechanism-explainer",
    label: "Механизм",
    description:
      "How something everyday actually works, explained simply (How do painkillers find the pain?).",
  },
  {
    slug: "hidden-detail",
    label: "Скрытая деталь",
    description: "Everyone has seen it and missed the real detail — a curiosity gap payoff.",
  },
  {
    slug: "habit-contrast",
    label: "Двое, одна черта, разный выбор",
    description:
      "Two people share a trait (same age, same complaint) and differ in one daily habit — the contrast carries the fact. Pick this ONLY when the claims are about a habit a viewer could change today (steps, sleep time, screen time, a meal), never for a pure mechanism or a product debunk. Publishing renders this one as a two-character comparison image instead of a text carousel.",
  },
] as const;

export type ScriptTemplateSlug = (typeof SCRIPT_TEMPLATES)[number]["slug"];

export const SCRIPT_TEMPLATE_SLUGS = SCRIPT_TEMPLATES.map((t) => t.slug) as [
  ScriptTemplateSlug,
  ...ScriptTemplateSlug[],
];

/** Beat roles as the model must spell them (matches BeatRole exactly). */
export const BEAT_ROLES = [
  BeatRole.HOOK,
  BeatRole.CURIOSITY,
  BeatRole.VALUE,
  BeatRole.PAYOFF,
  BeatRole.CTA,
] as const;

/** One generated beat, before it is persisted as a ScriptBeat row. */
export interface GeneratedBeat {
  role: BeatRole;
  line: string;
  visualIntent: string | null;
  /** Must be one of the claim ids offered in the prompt, or null for beats that cite nothing (most HOOK/CTA beats). */
  claimId: string | null;
}

export interface GeneratedScript {
  templateSlug: ScriptTemplateSlug;
  targetSeconds: number;
  beats: GeneratedBeat[];
}

export const GENERATED_SCRIPT_SCHEMA_NAME = "generated_script";

/**
 * Builds the JSON Schema for one script generation call. `claimIds` is
 * embedded as an enum so the model can only cite a claim we actually gave it
 * — never an invented id — which `parseGeneratedScript` then still
 * re-validates at runtime rather than trusting the schema alone.
 */
export function buildGeneratedScriptJsonSchema(claimIds: string[]) {
  const claimIdSchema =
    claimIds.length > 0
      ? { type: ["string", "null"], enum: [...claimIds, null] }
      : { type: "null" };

  return {
    type: "object",
    properties: {
      templateSlug: {
        type: "string",
        enum: SCRIPT_TEMPLATE_SLUGS,
        description:
          "Which of the proven scenario templates listed in the prompt this script follows.",
      },
      targetSeconds: {
        type: "integer",
        minimum: 15,
        maximum: 35,
        description:
          "Target duration in seconds — the range that actually gets views (discovery doc section 18.3), not 40-45.",
      },
      beats: {
        type: "array",
        minItems: 4,
        items: {
          type: "object",
          properties: {
            role: {
              type: "string",
              enum: BEAT_ROLES,
              description:
                "HOOK (first 1-2s, stops the scroll), CURIOSITY (opens a loop), VALUE (the payoff-bearing content), PAYOFF (closes the loop with one concrete fact), CTA (the last line).",
            },
            line: {
              type: "string",
              description: "The actual voiceover/on-screen line for this beat.",
            },
            visualIntent: {
              type: ["string", "null"],
              description:
                "What the viewer sees during this beat (camera/animation direction), or null if not specified.",
            },
            claimId: claimIdSchema,
          },
          required: ["role", "line", "visualIntent", "claimId"],
          additionalProperties: false,
        },
      },
    },
    required: ["templateSlug", "targetSeconds", "beats"],
    additionalProperties: false,
  } as const;
}

/**
 * Validates and narrows a raw parsed object into a GeneratedScript.
 *
 * `knownClaimIds` is the same list the schema's enum was built from — this is
 * the actual enforcement (never trust a model to have honored a JSON Schema
 * enum), so a hallucinated claimId is a thrown error, not a silently
 * fabricated citation in the database.
 */
export function parseGeneratedScript(
  raw: unknown,
  knownClaimIds: ReadonlySet<string>
): GeneratedScript {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Expected an object");
  }

  const { templateSlug, targetSeconds, beats } = raw as Record<string, unknown>;

  if (!isTemplateSlug(templateSlug)) {
    throw new Error(`templateSlug must be one of ${SCRIPT_TEMPLATE_SLUGS.join(", ")}`);
  }

  if (typeof targetSeconds !== "number" || targetSeconds < 15 || targetSeconds > 35) {
    throw new Error("targetSeconds must be an integer between 15 and 35");
  }

  if (!Array.isArray(beats) || beats.length < 4) {
    throw new Error("beats must be an array with at least 4 entries");
  }

  return {
    templateSlug,
    targetSeconds: Math.round(targetSeconds),
    beats: beats.map((beat, index) => validateBeat(beat, index, knownClaimIds)),
  };
}

const LEAKED_CLAIM_ID_PATTERN =
  /claimid|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// 2+ consecutive Latin letters — catches leaked English words/abbreviations
// (jargon like "PMID", drug/study names) without tripping on stray digits or
// punctuation that legitimately appear in Russian text.
const LATIN_LETTERS_PATTERN = /[a-zA-Z]{2,}/;

/**
 * Guards any model-written text that ends up spoken aloud or printed on a
 * card — beat lines, comparison-card copy — against the two ways a model
 * ruins one: leaking the machinery (a claimId/UUID lands in the sentence,
 * publishing "(claimId: 09a4f349-...)" as if it were words) and leaking
 * English into a Russian channel. Both throw rather than publish, the same
 * way a hallucinated claimId does.
 */
export function assertSpokenRussian(text: string, label: string): void {
  if (LEAKED_CLAIM_ID_PATTERN.test(text)) {
    throw new Error(`${label} leaks a claimId/UUID into the spoken text: "${text}"`);
  }

  if (LATIN_LETTERS_PATTERN.test(text)) {
    throw new Error(`${label} contains Latin letters (must be Russian only): "${text}"`);
  }
}

function validateBeat(
  entry: unknown,
  index: number,
  knownClaimIds: ReadonlySet<string>
): GeneratedBeat {
  if (typeof entry !== "object" || entry === null) {
    throw new Error(`beats[${index}] is not an object`);
  }

  const { role, line, visualIntent, claimId } = entry as Record<string, unknown>;

  if (!isBeatRole(role)) {
    throw new Error(`beats[${index}].role must be one of ${BEAT_ROLES.join(", ")}`);
  }

  if (typeof line !== "string" || line.trim().length === 0) {
    throw new Error(`beats[${index}].line must be a non-empty string`);
  }

  assertSpokenRussian(line, `beats[${index}].line`);

  if (claimId !== null && typeof claimId === "string" && !knownClaimIds.has(claimId)) {
    throw new Error(
      `beats[${index}].claimId "${claimId}" is not one of the claims offered to the model`
    );
  }

  return {
    role,
    line: line.trim(),
    visualIntent:
      typeof visualIntent === "string" && visualIntent.trim() ? visualIntent.trim() : null,
    claimId: typeof claimId === "string" ? claimId : null,
  };
}

function isTemplateSlug(value: unknown): value is ScriptTemplateSlug {
  return typeof value === "string" && (SCRIPT_TEMPLATE_SLUGS as readonly string[]).includes(value);
}

function isBeatRole(value: unknown): value is BeatRole {
  return typeof value === "string" && (BEAT_ROLES as readonly string[]).includes(value);
}
