import { EvidenceLevel } from "@prisma/client";

/**
 * Provider-agnostic LLM interface for the content engine.
 *
 * Andrey chose to run both Claude and OpenAI (2026-09-21) rather than commit to
 * one, so every LLM-backed stage of the pipeline (claim extraction, scripting,
 * hook generation, ...) is written against this interface, never against a
 * provider SDK directly. Swapping the default provider, or running two stages
 * on two different providers, is a config change — not a rewrite.
 */
export interface LLMProvider {
  /** Short id for logging and for picking a provider by name (e.g. in Experiment rows). */
  readonly id: string;

  /**
   * Runs a prompt and returns output that has already been validated against
   * `schema` — never a raw string the caller has to parse and hope is JSON.
   * Implementations use each provider's native structured-output mechanism
   * (Claude: a forced tool call; OpenAI: `response_format: json_schema`) so a
   * malformed response is a provider-level error, not a JSON.parse crash deep
   * in a pipeline stage.
   */
  generateStructured<T>(request: StructuredRequest<T>): Promise<T>;
}

export interface StructuredRequest<T> {
  /** Fixed instructions for the task — the part that stays the same across calls. */
  system: string;
  /** The actual input for this call (the source text, the topic, ...). */
  prompt: string;
  /** Name for the structured output shape, used by providers that require one. */
  schemaName: string;
  /** JSON Schema the response must validate against. */
  schema: Record<string, unknown>;
  /** Runtime validator — parses the provider's raw JSON into `T` or throws. */
  parse: (raw: unknown) => T;
  maxTokens?: number;
}

/** One fact pulled out of a source, ready to become a `Claim` row. */
export interface ExtractedClaim {
  text: string;
  evidenceLevel: EvidenceLevel;
  /** Required whenever evidenceLevel is C or D — see validateExtractedClaim. */
  hedgePhrase: string | null;
}

export const EXTRACTED_CLAIMS_SCHEMA_NAME = "extracted_claims";

/**
 * JSON Schema for claim extraction, shared by every provider so the prompt
 * and the parser stay in lockstep however many providers we add.
 *
 * Evidence levels are the ones from the discovery doc (section 5): A/B come
 * from meta-analyses, systematic reviews or well-powered studies and can be
 * stated plainly; C/D are preliminary or expert-opinion and MUST carry a
 * hedge phrase — enforced by `validateExtractedClaim` below, not just asked
 * for in the prompt, because a model can forget a "must" in a schema comment.
 */
export const EXTRACTED_CLAIMS_JSON_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description:
              "One specific, checkable factual claim, in plain language, attributable to this source alone.",
          },
          evidenceLevel: {
            type: "string",
            enum: ["A", "B", "C", "D"],
            description:
              "A: meta-analysis/systematic review/official-body consensus. B: a single well-powered study. C: a small or preliminary study. D: expert opinion without direct data.",
          },
          hedgePhrase: {
            type: ["string", "null"],
            description:
              "Required (non-null) for C and D: a phrase like 'preliminary evidence suggests' or 'some experts believe' the script must use when stating this claim. Null for A and B.",
          },
        },
        required: ["text", "evidenceLevel", "hedgePhrase"],
        additionalProperties: false,
      },
    },
  },
  required: ["claims"],
  additionalProperties: false,
} as const;

/**
 * Validates and narrows a raw parsed object into ExtractedClaim[], enforcing
 * the hedge-phrase rule the medical-safety section of the discovery doc
 * requires (never state a C/D claim as if it were settled science).
 */
export function parseExtractedClaims(raw: unknown): ExtractedClaim[] {
  if (typeof raw !== "object" || raw === null || !("claims" in raw)) {
    throw new Error("Expected an object with a 'claims' array");
  }

  const claims = (raw as { claims: unknown }).claims;
  if (!Array.isArray(claims)) {
    throw new Error("'claims' must be an array");
  }

  return claims.map((entry, index) => validateExtractedClaim(entry, index));
}

function validateExtractedClaim(entry: unknown, index: number): ExtractedClaim {
  if (typeof entry !== "object" || entry === null) {
    throw new Error(`claims[${index}] is not an object`);
  }

  const { text, evidenceLevel, hedgePhrase } = entry as Record<string, unknown>;

  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error(`claims[${index}].text must be a non-empty string`);
  }

  if (!isEvidenceLevel(evidenceLevel)) {
    throw new Error(`claims[${index}].evidenceLevel must be one of A, B, C, D`);
  }

  const needsHedge = evidenceLevel === "C" || evidenceLevel === "D";
  if (needsHedge && (typeof hedgePhrase !== "string" || hedgePhrase.trim().length === 0)) {
    throw new Error(
      `claims[${index}] has evidenceLevel ${evidenceLevel} and must carry a non-empty hedgePhrase`
    );
  }

  return {
    text: text.trim(),
    evidenceLevel,
    hedgePhrase: typeof hedgePhrase === "string" && hedgePhrase.trim() ? hedgePhrase.trim() : null,
  };
}

function isEvidenceLevel(value: unknown): value is EvidenceLevel {
  return value === "A" || value === "B" || value === "C" || value === "D";
}
