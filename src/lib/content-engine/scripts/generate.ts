import { prisma } from "@/lib/db";
import { getLLMProvider } from "../llm";
import type { LLMProvider } from "../llm/types";
import {
  GENERATED_SCRIPT_SCHEMA_NAME,
  SCRIPT_TEMPLATES,
  buildGeneratedScriptJsonSchema,
  parseGeneratedScript,
} from "./types";

const SYSTEM_PROMPT = `You write short-video scripts for a faceless health/science channel, as a
structure of beats — never as a flat paragraph, because one structure must adapt to Shorts,
TikTok, and a Telegram post alike.

Rules, non-negotiable:
- Pick exactly one of the six templates you are given and follow its shape.
- Beat roles, in the order the video plays: HOOK (the first 1-2 seconds — stop the scroll, no
  slow windup), CURIOSITY (opens a question the viewer wants answered), VALUE (the substance —
  this is where claims get cited), PAYOFF (one concrete fact or number that closes the loop
  opened by CURIOSITY), CTA (the last line).
- Every factual statement in a VALUE or PAYOFF beat MUST cite a claimId from the list you are
  given. Never state a fact that isn't backed by one of those claims. If none of the given claims
  fit the beat you want to write, write a different beat instead — do not invent a claim or cite
  claimId: null for a factual statement.
- If a cited claim carries a hedge phrase, the beat's line MUST use that hedge phrase (e.g.
  "preliminary evidence suggests...") — never state it as settled fact.
- No diagnoses, no treatment promises, no fear-based framing.
- targetSeconds: 15-35. This is the range that actually gets views (verified against real
  performing videos) — do not default to 40+.`;

export interface GenerateScriptOptions {
  provider?: LLMProvider;
  characterId?: string;
}

export interface GenerateScriptResult {
  scriptId: string;
  templateSlug: string;
  beatCount: number;
  citedClaims: number;
}

/**
 * Generates a script for a topic from its researched claims and persists it
 * as a Script + ScriptBeat rows.
 *
 * Requires the topic to already have claims (via researchTopic +
 * extractClaimsForSource) — a topic with no claims yet is refused rather than
 * generating an unfounded script, since an empty claim list would otherwise
 * silently produce a script with no factual grounding at all.
 *
 * Reuses an existing Script for this topic if one exists, rather than calling
 * the LLM again and creating a duplicate Script+ScriptBeat set — a bare
 * `create()` here would otherwise duplicate on every pipeline re-run for a
 * topic that already has a script (the same class of bug fixed for claim
 * extraction in the pipeline orchestrator).
 */
export async function generateScriptForTopic(
  topicId: string,
  options: GenerateScriptOptions = {}
): Promise<GenerateScriptResult> {
  const topic = await prisma.topic.findUnique({ where: { id: topicId } });
  if (!topic) {
    throw new Error(`Topic ${topicId} not found`);
  }

  const existingScript = await prisma.script.findFirst({
    where: { topicId: topic.id },
    include: { beats: true },
    orderBy: { createdAt: "desc" },
  });
  if (existingScript) {
    return {
      scriptId: existingScript.id,
      templateSlug: existingScript.templateSlug ?? "unknown",
      beatCount: existingScript.beats.length,
      citedClaims: existingScript.beats.filter((b) => b.claimId !== null).length,
    };
  }

  const claims = await prisma.claim.findMany({
    where: { source: { topicId: topic.id } },
    select: { id: true, text: true, evidenceLevel: true, hedgePhrase: true },
    take: 30,
  });

  if (claims.length === 0) {
    throw new Error(
      `Topic ${topicId} has no claims to script from yet — run researchTopic + extractClaimsForSource first`
    );
  }

  const provider = options.provider ?? getLLMProvider();
  const knownClaimIds = new Set(claims.map((c) => c.id));

  const generated = await provider.generateStructured({
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(topic.title, claims),
    schemaName: GENERATED_SCRIPT_SCHEMA_NAME,
    schema: buildGeneratedScriptJsonSchema(claims.map((c) => c.id)),
    parse: (raw) => parseGeneratedScript(raw, knownClaimIds),
    maxTokens: 4096,
  });

  const script = await prisma.script.create({
    data: {
      orgId: topic.orgId,
      topicId: topic.id,
      characterId: options.characterId,
      templateSlug: generated.templateSlug,
      targetSeconds: generated.targetSeconds,
      status: "FACT_GATE_PASSED", // every cited claim was validated against knownClaimIds above
      beats: {
        create: generated.beats.map((beat, index) => ({
          order: index,
          role: beat.role,
          line: beat.line,
          visualIntent: beat.visualIntent,
          claimId: beat.claimId,
        })),
      },
    },
    include: { beats: true },
  });

  await prisma.topic.update({ where: { id: topic.id }, data: { status: "SCRIPTED" } });

  return {
    scriptId: script.id,
    templateSlug: script.templateSlug ?? generated.templateSlug,
    beatCount: script.beats.length,
    citedClaims: script.beats.filter((b) => b.claimId !== null).length,
  };
}

function buildPrompt(
  topicTitle: string,
  claims: { id: string; text: string; evidenceLevel: string; hedgePhrase: string | null }[]
): string {
  const templateList = SCRIPT_TEMPLATES.map((t) => `- ${t.slug}: ${t.description}`).join("\n");
  const claimList = claims
    .map(
      (c) =>
        `- claimId=${c.id} [${c.evidenceLevel}]${c.hedgePhrase ? ` (hedge: "${c.hedgePhrase}")` : ""}: ${c.text}`
    )
    .join("\n");

  return [
    `Topic: ${topicTitle}`,
    "",
    "Available templates:",
    templateList,
    "",
    "Available claims (cite by claimId, never invent one):",
    claimList,
  ].join("\n");
}
