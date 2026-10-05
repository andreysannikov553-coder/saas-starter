import { prisma } from "@/lib/db";
import { withStageLog } from "../observability/logger";
import { fetchVideoAsset } from "./video-asset";
import { publishInstagramReel, type InstagramCredentials } from "./instagram";
import {
  publishTikTokVideo,
  refreshTikTokAccessToken,
  type TikTokCredentials,
  type TikTokPostMode,
  type TikTokPrivacyLevel,
} from "./tiktok";
import { uploadYouTubeShort, type YouTubeCredentials } from "./youtube";

/**
 * Publishing a *rendered video* to YouTube Shorts, Instagram Reels and
 * TikTok — the video counterpart to social.ts, which publishes the same
 * script as slide carousels/photos.
 *
 * All three share one orchestrator (doPublishVideo) with the same contract as
 * publishVideoToTelegram and publishScriptToInstagram: look up the script and
 * the PlatformAccount, read credentials out of `PlatformAccount.credentials`,
 * upsert a Publication keyed on (videoId, platformAccountId), and skip the
 * platform call entirely when that row is already PUBLISHED with an
 * externalId, so a re-run of the flow cannot double-post.
 *
 * What differs per platform is only how the bytes get there:
 *   - Instagram Reels takes a public URL and fetches the file itself.
 *   - YouTube and TikTok want the bytes in the request body, so the render is
 *     downloaded from storage first (video-asset.ts).
 *
 * Unlike the carousel path, none of this can fall back to slides: these are
 * video-only surfaces, so a script with no rendered Video.assetUrl fails with
 * MissingVideoAssetError instead of publishing something else.
 */

/** YouTube's title cap; the hook is cut to it rather than rejected. */
const YOUTUBE_TITLE_LIMIT = 100;
const INSTAGRAM_CAPTION_LIMIT = 2200;
const TIKTOK_TITLE_LIMIT = 2200;

export type VideoPublishMode = "short" | "reel" | "draft" | "direct";

export interface VideoPublishResult {
  publicationId: string;
  externalId: string;
  mode: VideoPublishMode;
}

export interface VideoPublishOptions {
  /**
   * Publish this exact Video instead of the newest rendered one for the
   * script. The fan-out (publish-all.ts) pins it so every platform gets the
   * same file even if a render lands mid-flight.
   */
  videoId?: string;
  /** Overrides the title/caption, which otherwise comes from the top-scoring hook. */
  title?: string;
  /** Overrides the description, which otherwise is every beat's line. */
  description?: string;
  signal?: AbortSignal;
}

export interface YouTubePublishOptions extends VideoPublishOptions {
  /** Defaults to "public" — pass "private" to rehearse against a real channel. */
  privacyStatus?: "public" | "unlisted" | "private";
  tags?: string[];
}

export interface InstagramReelPublishOptions extends VideoPublishOptions {
  shareToFeed?: boolean;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export interface TikTokPublishOptions extends VideoPublishOptions {
  /** Defaults to "inbox" (a draft in the creator's TikTok app) — see tiktok.ts. */
  mode?: TikTokPostMode;
  privacyLevel?: TikTokPrivacyLevel;
}

/**
 * Raised when a script has no rendered video to publish. Its own class so the
 * fan-out can report "nothing rendered yet" as a skip rather than as a
 * platform failure.
 */
export class MissingVideoAssetError extends Error {
  constructor(scriptId: string, platform: string) {
    super(
      `Script ${scriptId} has no rendered video (no Video.assetUrl) — ${platform} is video-only, so render and upload one first`
    );
    this.name = "MissingVideoAssetError";
  }
}

export interface RenderedVideo {
  id: string;
  orgId: string;
  assetUrl: string;
}

/**
 * The newest Video for this script that actually has a rendered asset.
 *
 * Deliberately not getOrCreateVideoForScript (render/narrate-video.ts): that
 * one looks for a QUEUED video and creates an empty row when it finds none,
 * which for publishing would mean inventing a Video with nothing to post.
 */
export async function findRenderedVideoForScript(scriptId: string): Promise<RenderedVideo | null> {
  const video = await prisma.video.findFirst({
    where: { scriptId, assetUrl: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, orgId: true, assetUrl: true },
  });
  return video?.assetUrl ? { id: video.id, orgId: video.orgId, assetUrl: video.assetUrl } : null;
}

export async function publishScriptToYouTube(
  scriptId: string,
  platformAccountId: string,
  options: YouTubePublishOptions = {}
): Promise<VideoPublishResult> {
  return withStageLog(
    "publish-youtube",
    { scriptId, platformAccountId },
    () =>
      doPublishVideo(scriptId, platformAccountId, options, {
        platform: "YOUTUBE_SHORTS",
        mode: "short",
        readCredentials: readYouTubeCredentials,
        publish: async (creds, video, copy, signal) => {
          const bytes = await fetchVideoAsset(video.assetUrl, signal);
          return uploadYouTubeShort(creds as YouTubeCredentials, {
            video: bytes,
            title: copy.title.slice(0, YOUTUBE_TITLE_LIMIT),
            description: copy.description,
            tags: options.tags,
            privacyStatus: options.privacyStatus,
            signal,
          });
        },
      }),
    (result) => ({ ...result })
  );
}

/**
 * Instagram Reels. Separate from publishScriptToInstagram (social.ts) rather
 * than folded into it: the carousel path is the right post for a script with
 * no render, and keeping them apart means a reel publish never silently
 * degrades into a slide post. publish-all.ts picks between the two.
 */
export async function publishScriptToInstagramReel(
  scriptId: string,
  platformAccountId: string,
  options: InstagramReelPublishOptions = {}
): Promise<VideoPublishResult> {
  return withStageLog(
    "publish-instagram-reel",
    { scriptId, platformAccountId },
    () =>
      doPublishVideo(scriptId, platformAccountId, options, {
        platform: "INSTAGRAM",
        mode: "reel",
        readCredentials: readInstagramCredentials,
        publish: (creds, video, copy, signal) =>
          publishInstagramReel(creds as InstagramCredentials, {
            videoUrl: video.assetUrl,
            caption: buildReelCaption(copy).slice(0, INSTAGRAM_CAPTION_LIMIT),
            shareToFeed: options.shareToFeed,
            pollIntervalMs: options.pollIntervalMs,
            pollTimeoutMs: options.pollTimeoutMs,
            signal,
          }),
      }),
    (result) => ({ ...result })
  );
}

export async function publishScriptToTikTok(
  scriptId: string,
  platformAccountId: string,
  options: TikTokPublishOptions = {}
): Promise<VideoPublishResult> {
  const mode = options.mode ?? "inbox";
  return withStageLog(
    "publish-tiktok",
    { scriptId, platformAccountId, mode },
    () =>
      doPublishVideo(scriptId, platformAccountId, options, {
        platform: "TIKTOK",
        mode: mode === "direct" ? "direct" : "draft",
        readCredentials: readTikTokCredentials,
        publish: async (creds, video, copy, signal) => {
          const fresh = await refreshTikTokTokenIfPossible(
            platformAccountId,
            creds as StoredTikTokCredentials,
            signal
          );
          const bytes = await fetchVideoAsset(video.assetUrl, signal);
          const result = await publishTikTokVideo(fresh, {
            video: bytes,
            title: buildReelCaption(copy).slice(0, TIKTOK_TITLE_LIMIT),
            mode,
            privacyLevel: options.privacyLevel,
            signal,
          });
          return result.publishId;
        },
      }),
    (result) => ({ ...result })
  );
}

interface VideoPlatformOps {
  platform: "YOUTUBE_SHORTS" | "INSTAGRAM" | "TIKTOK";
  /** Reported as `mode`, including on an already-PUBLISHED short-circuit. */
  mode: VideoPublishMode;
  readCredentials: (credentials: unknown) => unknown | null;
  publish: (
    creds: unknown,
    video: RenderedVideo,
    copy: VideoCopy,
    signal?: AbortSignal
  ) => Promise<string>;
}

interface VideoCopy {
  /** One line — the top-scoring hook, used as the title/first line of a caption. */
  title: string;
  /** The whole script, one beat per paragraph. */
  description: string;
}

async function doPublishVideo(
  scriptId: string,
  platformAccountId: string,
  options: VideoPublishOptions,
  ops: VideoPlatformOps
): Promise<VideoPublishResult> {
  const [script, account] = await Promise.all([
    prisma.script.findUnique({
      where: { id: scriptId },
      include: { beats: { orderBy: { order: "asc" } }, hooks: true },
    }),
    prisma.platformAccount.findUnique({ where: { id: platformAccountId } }),
  ]);

  if (!script) throw new Error(`Script ${scriptId} not found`);
  if (!account) throw new Error(`PlatformAccount ${platformAccountId} not found`);
  if (account.platform !== ops.platform) {
    throw new Error(`PlatformAccount ${platformAccountId} is not a ${ops.platform} account`);
  }

  const creds = ops.readCredentials(account.credentials);
  if (!creds) {
    throw new Error(`PlatformAccount ${platformAccountId} has no ${ops.platform} credentials`);
  }

  const video = await resolveVideo(scriptId, options.videoId, ops.platform);

  const existing = await prisma.publication.findUnique({
    where: { videoId_platformAccountId: { videoId: video.id, platformAccountId: account.id } },
  });
  if (existing && existing.status === "PUBLISHED" && existing.externalId) {
    return { publicationId: existing.id, externalId: existing.externalId, mode: ops.mode };
  }

  const publication = await prisma.publication.upsert({
    where: { videoId_platformAccountId: { videoId: video.id, platformAccountId: account.id } },
    create: {
      orgId: script.orgId,
      videoId: video.id,
      platformAccountId: account.id,
      status: "PENDING",
    },
    update: { status: "PENDING" },
  });

  const copy = buildCopy(script, options);

  try {
    const externalId = await ops.publish(creds, video, copy, options.signal);

    await prisma.publication.update({
      where: { id: publication.id },
      data: { status: "PUBLISHED", externalId, publishedAt: new Date() },
    });

    return { publicationId: publication.id, externalId, mode: ops.mode };
  } catch (error) {
    await prisma.publication.update({ where: { id: publication.id }, data: { status: "FAILED" } });
    throw error;
  }
}

async function resolveVideo(
  scriptId: string,
  videoId: string | undefined,
  platform: string
): Promise<RenderedVideo> {
  if (!videoId) {
    const found = await findRenderedVideoForScript(scriptId);
    if (!found) throw new MissingVideoAssetError(scriptId, platform);
    return found;
  }

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { id: true, orgId: true, assetUrl: true },
  });
  if (!video) throw new Error(`Video ${videoId} not found`);
  if (!video.assetUrl) throw new MissingVideoAssetError(scriptId, platform);
  return { id: video.id, orgId: video.orgId, assetUrl: video.assetUrl };
}

function buildCopy(
  script: {
    beats: { role: string; line: string }[];
    hooks: { text: string; score: unknown }[] | null;
  },
  options: VideoPublishOptions
): VideoCopy {
  const topHook = pickTopHook(script.hooks);
  const title = (options.title ?? topHook?.text ?? script.beats[0]?.line ?? "").trim();
  const description = (options.description ?? script.beats.map((b) => b.line).join("\n\n")).trim();

  if (!title) {
    throw new Error("Cannot publish a video with no title — the script has no hooks and no beats");
  }
  return { title, description: description || title };
}

/** Hook first, then the script — the shape a Reels/TikTok caption wants. */
function buildReelCaption(copy: VideoCopy): string {
  return copy.description.startsWith(copy.title)
    ? copy.description
    : `${copy.title}\n\n${copy.description}`;
}

/** Highest-scoring hook (by total), if any were generated for this script. */
function pickTopHook(
  hooks: { text: string; score: unknown }[] | null | undefined
): { text: string } | null {
  if (!hooks || hooks.length === 0) return null;
  return hooks.reduce((best, h) => {
    const total = (h.score as { total?: number } | null)?.total ?? 0;
    const bestTotal = (best.score as { total?: number } | null)?.total ?? 0;
    return total > bestTotal ? h : best;
  });
}

function readYouTubeCredentials(credentials: unknown): YouTubeCredentials | null {
  if (typeof credentials !== "object" || credentials === null) return null;
  const c = credentials as Record<string, unknown>;
  if (
    typeof c.refreshToken !== "string" ||
    typeof c.clientId !== "string" ||
    typeof c.clientSecret !== "string"
  ) {
    return null;
  }
  return { refreshToken: c.refreshToken, clientId: c.clientId, clientSecret: c.clientSecret };
}

function readInstagramCredentials(credentials: unknown): InstagramCredentials | null {
  if (typeof credentials !== "object" || credentials === null) return null;
  const c = credentials as Record<string, unknown>;
  if (typeof c.accessToken !== "string" || typeof c.igUserId !== "string") return null;
  return { accessToken: c.accessToken, igUserId: c.igUserId };
}

/**
 * TikTok credentials, optionally with the OAuth triple needed to refresh
 * them. `accessToken` alone is enough for a publish right now; the triple is
 * what keeps an unattended cron working, since a TikTok access token expires
 * after 24 hours (see refreshTikTokAccessToken).
 */
interface StoredTikTokCredentials extends TikTokCredentials {
  clientKey?: string;
  clientSecret?: string;
  refreshToken?: string;
}

function readTikTokCredentials(credentials: unknown): StoredTikTokCredentials | null {
  if (typeof credentials !== "object" || credentials === null) return null;
  const c = credentials as Record<string, unknown>;
  if (typeof c.openId !== "string") return null;

  const refreshable =
    typeof c.clientKey === "string" &&
    typeof c.clientSecret === "string" &&
    typeof c.refreshToken === "string";

  // Either a usable token now, or the means to mint one.
  if (typeof c.accessToken !== "string" && !refreshable) return null;

  return {
    accessToken: typeof c.accessToken === "string" ? c.accessToken : "",
    openId: c.openId,
    ...(refreshable
      ? {
          clientKey: c.clientKey as string,
          clientSecret: c.clientSecret as string,
          refreshToken: c.refreshToken as string,
        }
      : {}),
  };
}

/**
 * Refreshes the access token when the account stores the OAuth triple, and
 * writes the rotated pair back so the next run can refresh too. Accounts
 * holding only a manually-pasted access token are returned untouched — they
 * work until that token expires, which is the trade-off of not completing
 * the OAuth setup.
 */
async function refreshTikTokTokenIfPossible(
  platformAccountId: string,
  stored: StoredTikTokCredentials,
  signal?: AbortSignal
): Promise<TikTokCredentials> {
  if (!stored.clientKey || !stored.clientSecret || !stored.refreshToken) {
    return { accessToken: stored.accessToken, openId: stored.openId };
  }

  const fresh = await refreshTikTokAccessToken(
    {
      clientKey: stored.clientKey,
      clientSecret: stored.clientSecret,
      refreshToken: stored.refreshToken,
    },
    signal
  );

  await prisma.platformAccount.update({
    where: { id: platformAccountId },
    data: {
      credentials: {
        ...stored,
        accessToken: fresh.accessToken,
        refreshToken: fresh.refreshToken,
      },
    },
  });

  return { accessToken: fresh.accessToken, openId: stored.openId };
}
