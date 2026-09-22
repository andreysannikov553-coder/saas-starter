import { prisma } from "@/lib/db";
import { getLLMProvider } from "../llm";
import type { LLMProvider } from "../llm/types";
import {
  GENERATED_HOOKS_JSON_SCHEMA,
  GENERATED_HOOKS_SCHEMA_NAME,
  HOOK_SCORE_THRESHOLD,
  HOOK_VARIANTS_PER_SCRIPT,
  parseGeneratedHooks,
} from "./types";

const SYSTEM_PROMPT = `You write hook variants for a faceless health/science short-video script and
score each one, as the Hook Optimizer stage of the pipeline.

Rules, non-negotiable:
- Write exactly ${HOOK_VARIANTS_PER_SCRIPT} distinct hook variants for the given script. Vary the
  angle (e.g. обвинение / гипотеза / скрытая деталь), not just the wording of the same idea.
- Each hook must be something the given script can actually deliver on — never promise a fact the
  script's VALUE/PAYOFF beats don't contain.
- Score every hook 0-5 on each of five criteria:
  - understandingSpeed (скорость понимания): can a viewer get it in under 1 second?
  - personalRelevance (личная релевантность): does it land as "about me"?
  - knowledgeGap (разрыв в знании): how strong is the open curiosity loop?
  - promiseHonesty (честность обещания): does the script actually pay off what this hook
    promises? Score 0 if it overpromises relative to the script's content.
  - noveltyOfPhrasing (новизна формулировки): is the phrasing fresh, not a cliche opener?
- Be an honest critic, not a cheerleader — a mediocre hook should score low. The pipeline uses
  these scores to decide whether to rewrite, so inflated scores defeat the point.`;

export interface GenerateHooksOptions {
  provider?: LLMProvider;
}

export interface GenerateHooksResult {
  scriptId: string;
  hookIds: string[];
  bestScore: number;
  belowThreshold: boolean;
}

/**
 * Generates hook variants for a script's HOOK beat, scores each against the
 * five discovery-doc criteria, and persists them as Hook rows.
 *
 * Does not decide anything on the script's behalf — `belowThreshold` tells
 * the caller (or a human) that even the best variant scored under the
 * threshold, so the script should go back for a rewrite rather than move
 * on to rendering. This stage only scores; it doesn't loop or rewrite.
 */
export async function generateHooksForScript(
  scriptId: string,
  options: GenerateHooksOptions = {}
): Promise<GenerateHooksResult> {
  const script = await prisma.script.findUnique({
    where: { id: scriptId },
    include: { beats: { orderBy: { order: "asc" } } },
  });
  if (!script) {
    throw new Error(`Script ${scriptId} not found`);
  }

  const provider = options.provider ?? getLLMProvider();

  const generated = await provider.generateStructured({
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(script.templateSlug, script.beats),
    schemaName: GENERATED_HOOKS_SCHEMA_NAME,
    schema: GENERATED_HOOKS_JSON_SCHEMA,
    parse: parseGeneratedHooks,
    maxTokens: 2048,
  });

  const created = await prisma.$transaction(
    generated.hooks.map((hook) =>
      prisma.hook.create({
        data: {
          scriptId: script.id,
          text: hook.text,
          hookType: hook.hookType,
          score: { ...hook.score, total: hook.total },
        },
      })
    )
  );

  const bestScore = Math.max(...generated.hooks.map((h) => h.total));

  return {
    scriptId: script.id,
    hookIds: created.map((h) => h.id),
    bestScore,
    belowThreshold: bestScore < HOOK_SCORE_THRESHOLD,
  };
}

function buildPrompt(templateSlug: string | null, beats: { role: string; line: string }[]): string {
  const beatLines = beats.map((b) => `- [${b.role}] ${b.line}`).join("\n");

  return [
    `Template: ${templateSlug ?? "unspecified"}`,
    "",
    "Script beats (the hook must be payable by this content — see beats below):",
    beatLines,
  ].join("\n");
}
