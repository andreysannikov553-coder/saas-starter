import { prisma } from "@/lib/db";
import { researchTopic, type ResearchTopicOptions } from "./research";
import { extractClaimsForSource } from "./claims/extract";
import { generateScriptForTopic } from "./scripts/generate";
import { generateHooksForScript } from "./hooks/generate";
import { renderNarrationForScript, getOrCreateVideoForScript } from "./render/narrate-video";
import { publishVideoToTelegram } from "./publishing/publish";
import { publishVideoToAllPlatforms, type PlatformPublishOutcome } from "./publishing/publish-all";
import { withStageLog } from "./observability/logger";

export interface RunContentPipelineOptions {
  research?: ResearchTopicOptions;
  /** Skip research/claim extraction — use when the topic already has claims. */
  skipResearch?: boolean;
  /**
   * Publish once a script exists. Omitted entirely to stop after scoring
   * hooks — publishing needs a real Telegram bot this sandbox doesn't have,
   * so callers can run everything up to that point without one.
   */
  publish?: {
    /**
     * Narrate with this ElevenLabs voice before publishing. Omitted to
     * publish the script as text only — worth doing on its own, since
     * narration needs a separate ElevenLabs key that publishing doesn't.
     */
    ttsVoiceId?: string;
    /** Publish to this one Telegram account — the original, narrowest option. */
    telegramPlatformAccountId?: string;
    /**
     * Fan out to every platform account configured on the org instead
     * (YouTube Shorts, Instagram, TikTok, Telegram — see
     * publishing/publish-all.ts). Independent per platform: one platform
     * failing does not fail the pipeline run, and each outcome lands in
     * `platformResults`.
     */
    allPlatforms?: { orgId: string };
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
  /** The Telegram publish's Publication id, or the first successful one of a fan-out. */
  publicationId: string | null;
  /** One row per platform account, when `publish.allPlatforms` was used. */
  platformResults: PlatformPublishOutcome[] | null;
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
 * `publish` is optional and separate from the rest on purpose: publishing
 * needs live platform credentials this sandbox doesn't have, so a caller can
 * exercise research through hook-scoring (the parts with automated tests
 * behind them) without any. Within `publish`, `ttsVoiceId` is itself
 * optional — narration needs a separate ElevenLabs key, so a caller can
 * publish the script as text before that key exists.
 *
 * `publish.allPlatforms` swaps the single Telegram post for the fan-out
 * across every platform account on the org (publishing/publish-all.ts):
 * YouTube Shorts and TikTok take the rendered video, Instagram takes a Reel
 * when there's a render and a slide carousel when there isn't.
 */
export async function runContentPipeline(
  topicId: string,
  options: RunContentPipelineOptions = {}
): Promise<RunContentPipelineResult> {
  return withStageLog(
    "pipeline",
    { topicId },
    () => doRunContentPipeline(topicId, options),
    (result) => ({ stoppedAt: result.stoppedAt, publicationId: result.publicationId })
  );
}

async function doRunContentPipeline(
  topicId: string,
  options: RunContentPipelineOptions
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
    platformResults: null,
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

    // Only sources with no claims yet — extractClaimsForSource has no dedup guard of
    // its own, so re-running the pipeline for a topic with existing sources would
    // otherwise re-extract (and duplicate) claims for every source on every run.
    const sources = await prisma.source.findMany({
      where: { topicId, claims: { none: {} } },
      select: { id: true },
    });
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

  result.videoId = options.publish.ttsVoiceId
    ? (
        await renderNarrationForScript(script.scriptId, {
          voiceId: options.publish.ttsVoiceId,
        })
      ).videoId
    : await getOrCreateVideoForScript(script.scriptId);

  if (options.publish.allPlatforms) {
    const outcomes = await publishVideoToAllPlatforms(
      script.scriptId,
      options.publish.allPlatforms.orgId
    );
    result.platformResults = outcomes;
    result.publicationId = outcomes.find((o) => o.status === "PUBLISHED")?.publicationId ?? null;
    return result;
  }

  if (!options.publish.telegramPlatformAccountId) {
    throw new Error(
      "publish needs either telegramPlatformAccountId or allPlatforms: { orgId } — neither was given"
    );
  }

  const publication = await publishVideoToTelegram(
    result.videoId,
    options.publish.telegramPlatformAccountId
  );
  result.publicationId = publication.publicationId;

  return result;
}
