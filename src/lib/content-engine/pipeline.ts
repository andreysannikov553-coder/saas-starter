import { prisma } from "@/lib/db";
import { researchTopic, type ResearchTopicOptions } from "./research";
import { extractClaimsForSource } from "./claims/extract";
import { generateScriptForTopic } from "./scripts/generate";
import { generateHooksForScript } from "./hooks/generate";
import { renderNarrationForScript } from "./render/narrate-video";
import { publishVideoToTelegram } from "./publishing/publish";

export interface RunContentPipelineOptions {
  research?: ResearchTopicOptions;
  /** Skip research/claim extraction — use when the topic already has claims. */
  skipResearch?: boolean;
  /**
   * Narrate and publish once a script exists. Omitted entirely to stop after
   * scoring hooks — narration/publishing need real credentials this
   * sandbox doesn't have, so callers can run everything up to that point
   * without them.
   */
  publish?: {
    ttsVoiceId: string;
    telegramPlatformAccountId: string;
  };
}

export interface RunContentPipelineResult {
  topicId: string;
  sourcesFound: number;
  sourcesCreated: number;
  claimsExtracted: number;
  scriptId: string | null;
  hookIds: string[];
  bestHookScore: number | null;
  hookBelowThreshold: boolean | null;
  videoId: string | null;
  publicationId: string | null;
  /** Where the run stopped, when it didn't reach publishing — never a thrown error for an expected stop. */
  stoppedAt: "research" | "claims" | "script" | "hooks" | "publish" | null;
}

/**
 * Runs the full content pipeline for a topic: research -> claim extraction
 * -> script -> hooks -> (optionally) narration + Telegram publish.
 *
 * Ties together every stage built across PRs #2-#8 into the one sequence
 * the discovery doc's flowchart describes (Trend Scanner/Idea Generator
 * feed the Topic; this function starts from an existing Topic row). Each
 * stage's own gate (researchTopic requires topic.title, generateScriptForTopic
 * refuses on zero claims, etc.) still applies — this function stops and
 * reports where, rather than trying to push through with no input.
 *
 * `publish` is optional and separate from the rest on purpose: narration
 * needs an ElevenLabs key and publishing needs a live Telegram bot, neither
 * of which exist in this sandbox, so a caller can exercise research through
 * hook-scoring (the parts with automated tests behind them) without those.
 */
export async function runContentPipeline(
  topicId: string,
  options: RunContentPipelineOptions = {}
): Promise<RunContentPipelineResult> {
  const result: RunContentPipelineResult = {
    topicId,
    sourcesFound: 0,
    sourcesCreated: 0,
    claimsExtracted: 0,
    scriptId: null,
    hookIds: [],
    bestHookScore: null,
    hookBelowThreshold: null,
    videoId: null,
    publicationId: null,
    stoppedAt: null,
  };

  if (!options.skipResearch) {
    const research = await researchTopic(topicId, options.research);
    result.sourcesFound = research.found;
    result.sourcesCreated = research.created;

    if (research.created === 0) {
      const existingSources = await prisma.source.count({ where: { topicId } });
      if (existingSources === 0) {
        result.stoppedAt = "research";
        return result;
      }
    }

    const sources = await prisma.source.findMany({ where: { topicId }, select: { id: true } });
    for (const source of sources) {
      const extracted = await extractClaimsForSource(source.id);
      result.claimsExtracted += extracted.extracted;
    }
  }

  const claimCount = await prisma.claim.count({ where: { source: { topicId } } });
  if (claimCount === 0) {
    result.stoppedAt = "claims";
    return result;
  }

  const script = await generateScriptForTopic(topicId);
  result.scriptId = script.scriptId;

  const hooks = await generateHooksForScript(script.scriptId);
  result.hookIds = hooks.hookIds;
  result.bestHookScore = hooks.bestScore;
  result.hookBelowThreshold = hooks.belowThreshold;

  if (hooks.belowThreshold) {
    result.stoppedAt = "hooks";
    return result;
  }

  if (!options.publish) {
    result.stoppedAt = "publish";
    return result;
  }

  const narration = await renderNarrationForScript(script.scriptId, {
    voiceId: options.publish.ttsVoiceId,
  });
  result.videoId = narration.videoId;

  const publication = await publishVideoToTelegram(
    narration.videoId,
    options.publish.telegramPlatformAccountId
  );
  result.publicationId = publication.publicationId;

  return result;
}
