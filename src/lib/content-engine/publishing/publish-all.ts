import { prisma } from "@/lib/db";
import { withStageLog } from "../observability/logger";
import { getOrCreateVideoForScript } from "../render/narrate-video";
import { publishVideoToTelegram } from "./publish";
import { publishScriptToInstagram } from "./social";
import {
  findRenderedVideoForScript,
  publishScriptToInstagramReel,
  publishScriptToTikTok,
  publishScriptToYouTube,
  type InstagramReelPublishOptions,
  type RenderedVideo,
  type TikTokPublishOptions,
  type YouTubePublishOptions,
} from "./video-publish";

/**
 * Publishes one rendered video everywhere the org is set up to post, in one
 * call — the last step of the pipeline, after render.
 *
 * Fan-out, not all-or-nothing: every account is attempted with
 * Promise.allSettled, so a revoked TikTok token or an Instagram container
 * that fails to transcode cannot stop the YouTube upload. Each platform gets
 * its own outcome row with the Publication id/externalId or the error
 * message, and each platform's own Publication row already records
 * PUBLISHED/FAILED independently (see video-publish.ts), so a partial run is
 * re-runnable: the platforms that succeeded short-circuit on the next call
 * and only the failures are retried.
 *
 * The Video is resolved once up front and pinned for every platform, so a
 * render finishing mid-flight cannot have half the platforms posting one file
 * and half another.
 */

export type VideoPlatform = "YOUTUBE_SHORTS" | "INSTAGRAM" | "TIKTOK" | "TELEGRAM";

/** Every platform this flow knows how to post a video to, in publish order. */
const ALL_VIDEO_PLATFORMS: VideoPlatform[] = ["YOUTUBE_SHORTS", "INSTAGRAM", "TIKTOK", "TELEGRAM"];

export interface PlatformPublishOutcome {
  platform: VideoPlatform;
  platformAccountId: string;
  handle: string;
  /** SKIPPED means nothing was attempted — not a failure to retry blindly. */
  status: "PUBLISHED" | "SKIPPED" | "FAILED";
  /** Platform-specific: "short" | "reel" | "draft" | "direct" | "video" | "carousel" | "photo" | "text". */
  mode?: string;
  publicationId?: string;
  externalId?: string;
  /** Why it was skipped, or what went wrong. */
  reason?: string;
}

export interface PublishVideoToAllPlatformsOptions {
  /** Restrict the fan-out — defaults to every platform with an account on the org. */
  platforms?: VideoPlatform[];
  /** Only post to accounts with PlatformAccount.autoPublish set. */
  autoPublishOnly?: boolean;
  youtube?: Omit<YouTubePublishOptions, "videoId" | "signal">;
  instagram?: Omit<InstagramReelPublishOptions, "videoId" | "signal">;
  tiktok?: Omit<TikTokPublishOptions, "videoId" | "signal">;
  signal?: AbortSignal;
}

export async function publishVideoToAllPlatforms(
  scriptId: string,
  orgId: string,
  options: PublishVideoToAllPlatformsOptions = {}
): Promise<PlatformPublishOutcome[]> {
  return withStageLog(
    "publish-all",
    { scriptId, orgId },
    () => doPublishAll(scriptId, orgId, options),
    (results) => ({
      attempted: results.length,
      published: results.filter((r) => r.status === "PUBLISHED").length,
      failed: results.filter((r) => r.status === "FAILED").length,
      skipped: results.filter((r) => r.status === "SKIPPED").length,
    })
  );
}

async function doPublishAll(
  scriptId: string,
  orgId: string,
  options: PublishVideoToAllPlatformsOptions
): Promise<PlatformPublishOutcome[]> {
  const platforms = options.platforms ?? ALL_VIDEO_PLATFORMS;

  const accounts = await prisma.platformAccount.findMany({
    where: {
      orgId,
      platform: { in: platforms },
      ...(options.autoPublishOnly ? { autoPublish: true } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, platform: true, handle: true },
  });

  if (accounts.length === 0) return [];

  const video = await findRenderedVideoForScript(scriptId);

  const settled = await Promise.allSettled(
    accounts.map((account) =>
      publishToAccount(
        scriptId,
        { id: account.id, platform: account.platform as VideoPlatform, handle: account.handle },
        video,
        options
      )
    )
  );

  return settled.map((outcome, index) => {
    const account = accounts[index];
    if (outcome.status === "fulfilled") return outcome.value;
    return {
      platform: account.platform as VideoPlatform,
      platformAccountId: account.id,
      handle: account.handle,
      status: "FAILED" as const,
      reason: errorMessage(outcome.reason),
    };
  });
}

interface AccountRef {
  id: string;
  platform: VideoPlatform;
  handle: string;
}

async function publishToAccount(
  scriptId: string,
  account: AccountRef,
  video: RenderedVideo | null,
  options: PublishVideoToAllPlatformsOptions
): Promise<PlatformPublishOutcome> {
  const base = {
    platform: account.platform,
    platformAccountId: account.id,
    handle: account.handle,
  };

  try {
    switch (account.platform) {
      case "YOUTUBE_SHORTS":
      case "TIKTOK": {
        // Video-only surfaces: with nothing rendered there is nothing to
        // post, and recording a FAILED Publication for a render that simply
        // has not happened yet would be misleading.
        if (!video) {
          return { ...base, status: "SKIPPED", reason: "no rendered video (Video.assetUrl)" };
        }
        const result =
          account.platform === "YOUTUBE_SHORTS"
            ? await publishScriptToYouTube(scriptId, account.id, {
                ...options.youtube,
                videoId: video.id,
                signal: options.signal,
              })
            : await publishScriptToTikTok(scriptId, account.id, {
                ...options.tiktok,
                videoId: video.id,
                signal: options.signal,
              });
        return { ...base, status: "PUBLISHED", ...result };
      }

      case "INSTAGRAM": {
        // A Reel when there is a render, the slide carousel when there is
        // not — the carousel is a real post for this content, not a
        // degraded one (see social.ts).
        const result = video
          ? await publishScriptToInstagramReel(scriptId, account.id, {
              ...options.instagram,
              videoId: video.id,
              signal: options.signal,
            })
          : await publishScriptToInstagram(scriptId, account.id, { signal: options.signal });
        return { ...base, status: "PUBLISHED", ...result };
      }

      case "TELEGRAM": {
        // Telegram publishes from a Video row and degrades to a carousel or
        // text itself, so it needs a video id either way.
        const videoId = video?.id ?? (await getOrCreateVideoForScript(scriptId));
        const result = await publishVideoToTelegram(videoId, account.id, {
          signal: options.signal,
        });
        return { ...base, status: "PUBLISHED", ...result };
      }
    }
  } catch (error) {
    return { ...base, status: "FAILED", reason: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
