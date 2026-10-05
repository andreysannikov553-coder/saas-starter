import { prisma } from "@/lib/db";
import { getLLMProvider } from "../llm";
import { withStageLog } from "../observability/logger";
import {
  EXTRACTED_CLAIMS_JSON_SCHEMA,
  EXTRACTED_CLAIMS_SCHEMA_NAME,
  parseExtractedClaims,
  type LLMProvider,
} from "../llm/types";

const SYSTEM_PROMPT = `You extract factual claims from scientific source metadata for a health/science
content pipeline. Rules, non-negotiable:
- Only extract claims that are directly supported by the given title, abstract (when present), and
  metadata. Never invent a finding the source does not state.
- Every claim gets an evidenceLevel from A (meta-analysis / systematic review / official body
  consensus) to D (expert opinion, no direct data) — see the schema for the full definitions.
- Every C or D claim MUST carry a hedgePhrase a script can use verbatim ("preliminary evidence
  suggests...", "some researchers believe..."). A and B claims get hedgePhrase: null.
- No medical advice, diagnosis, or treatment recommendation — extract the finding, not a
  recommendation to act on it.
- If the given text does not support any checkable claim, return an empty claims array. An empty
  result is correct and expected sometimes — never force a claim out of a title alone.`;

export interface ExtractClaimsOptions {
  provider?: LLMProvider;
}

export interface ExtractClaimsResult {
  sourceId: string;
  extracted: number;
  saved: number;
}

/**
 * Extracts claims from one source and persists them.
 *
 * Runs against the source's title, type, and abstract when Europe PMC's
 * `core` result type returned one (europe-pmc.ts). Many records — especially
 * older ones or those outside PMC's open-access subset — have no abstract
 * text, so this stays conservative for those: title alone rarely supports
 * more than zero or one claim, and the prompt is written to return an empty
 * array rather than guess.
 */
export async function extractClaimsForSource(
  sourceId: string,
  options: ExtractClaimsOptions = {}
): Promise<ExtractClaimsResult> {
  return withStageLog(
    "claims",
    { sourceId },
    async () => {
      const source = await prisma.source.findUnique({ where: { id: sourceId } });
      if (!source) {
        throw new Error(`Source ${sourceId} not found`);
      }

      const provider = options.provider ?? getLLMProvider();

      const extracted = await provider.generateStructured({
        system: SYSTEM_PROMPT,
        prompt: [
          `Title: ${source.title}`,
          `Declared type: ${source.sourceType}`,
          source.publishedAt ? `Published: ${source.publishedAt.toISOString().slice(0, 10)}` : null,
          source.abstract ? `Abstract: ${source.abstract}` : null,
          `URL: ${source.url}`,
        ]
          .filter(Boolean)
          .join("\n"),
        schemaName: EXTRACTED_CLAIMS_SCHEMA_NAME,
        schema: EXTRACTED_CLAIMS_JSON_SCHEMA,
        parse: parseExtractedClaims,
      });

      if (extracted.length > 0) {
        await prisma.claim.createMany({
          data: extracted.map((claim) => ({
            sourceId: source.id,
            text: claim.text,
            evidenceLevel: claim.evidenceLevel,
            hedgePhrase: claim.hedgePhrase,
          })),
        });
      }

      return { sourceId: source.id, extracted: extracted.length, saved: extracted.length };
    },
    (result) => ({ ...result })
  );
}
