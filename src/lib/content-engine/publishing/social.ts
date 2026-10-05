import { prisma } from "@/lib/db";
import { getOrCreateVideoForScript } from "../render/narrate-video";
import { renderQuoteCard } from "../render/quote-card";
import { renderPostSlides } from "../render/slides";
import { uploadRenderAsset } from "../storage";
import { withStageLog } from "../observability/logger";
import {
  publishInstagramCarousel,
  publishInstagramSinglePhoto,
  type InstagramCredentials,
} from "./instagram";
import {
  publishThreadsCarousel,
  publishThreadsSinglePhoto,
  type ThreadsCredentials,
} from "./threads";

/**
 * Instagram/Threads publishing — same carousel-slide idea as Telegram
 * (publish.ts), but both platforms need a *public URL* per image (their
 * Graph APIs fetch it server-side) instead of a direct multipart upload, so
 * every slide goes through Supabase Storage first. Not yet wired into
 * runContentPipeline's `publish` option — that's a content-strategy choice
 * (teaser-vs-full-payoff split across platforms) Andrey hasn't made yet, see
 * chat 2026-09-23/24. These are standalone, independently callable in the
 * meantime, same shape as publishVideoToTelegram.
 */

const INSTAGRAM_CAPTION_LIMIT = 2200;
const THREADS_TEXT_LIMIT = 500;

export interface SocialPublishResult {
  publicationId: string;
  externalId: string;
  mode: "carousel" | "photo";
}

export async function publishScriptToInstagram(
  scriptId: string,
  platformAccountId: string,
  options: { signal?: AbortSignal } = {}
): Promise<SocialPublishResult> {
  return withStageLog(
    "publish-instagram",
    { scriptId, platformAccountId },
    () =>
      doPublishSocial(
        scriptId,
        platformAccountId,
        "INSTAGRAM",
        INSTAGRAM_CAPTION_LIMIT,
        {
          carousel: (creds, imageUrls, caption, signal) =>
            publishInstagramCarousel(creds as InstagramCredentials, {
              imageUrls,
              caption,
              signal,
            }),
          single: (creds, imageUrl, caption, signal) =>
            publishInstagramSinglePhoto(creds as InstagramCredentials, {
              imageUrl,
              caption,
              signal,
            }),
          readCredentials: readInstagramCredentials,
        },
        options.signal
      ),
    (result) => ({ ...result })
  );
}

export async function publishScriptToThreads(
  scriptId: string,
  platformAccountId: string,
  options: { signal?: AbortSignal } = {}
): Promise<SocialPublishResult> {
  return withStageLog(
    "publish-threads",
    { scriptId, platformAccountId },
    () =>
      doPublishSocial(
        scriptId,
        platformAccountId,
        "THREADS",
        THREADS_TEXT_LIMIT,
        {
          carousel: (creds, imageUrls, text, signal) =>
            publishThreadsCarousel(creds as ThreadsCredentials, { imageUrls, text, signal }),
          single: (creds, imageUrl, text, signal) =>
            publishThreadsSinglePhoto(creds as ThreadsCredentials, { imageUrl, text, signal }),
          readCredentials: readThreadsCredentials,
        },
        options.signal
      ),
    (result) => ({ ...result })
  );
}

interface PlatformOps {
  carousel: (
    creds: unknown,
    imageUrls: string[],
    caption: string,
    signal?: AbortSignal
  ) => Promise<string>;
  single: (
    creds: unknown,
    imageUrl: string,
    caption: string,
    signal?: AbortSignal
  ) => Promise<string>;
  readCredentials: (credentials: unknown) => InstagramCredentials | ThreadsCredentials | null;
}

async function doPublishSocial(
  scriptId: string,
  platformAccountId: string,
  expectedPlatform: "INSTAGRAM" | "THREADS",
  captionLimit: number,
  ops: PlatformOps,
  signal?: AbortSignal
): Promise<SocialPublishResult> {
  const [script, account] = await Promise.all([
    prisma.script.findUnique({
      where: { id: scriptId },
      include: { beats: { orderBy: { order: "asc" } }, hooks: true },
    }),
    prisma.platformAccount.findUnique({ where: { id: platformAccountId } }),
  ]);

  if (!script) throw new Error(`Script ${scriptId} not found`);
  if (!account) throw new Error(`PlatformAccount ${platformAccountId} not found`);
  if (account.platform !== expectedPlatform) {
    throw new Error(`PlatformAccount ${platformAccountId} is not a ${expectedPlatform} account`);
  }

  const creds = ops.readCredentials(account.credentials);
  if (!creds) {
    throw new Error(`PlatformAccount ${platformAccountId} has no ${expectedPlatform} credentials`);
  }

  const videoId = await getOrCreateVideoForScript(scriptId);

  const existing = await prisma.publication.findUnique({
    where: { videoId_platformAccountId: { videoId, platformAccountId: account.id } },
  });
  if (existing && existing.status === "PUBLISHED" && existing.externalId) {
    return { publicationId: existing.id, externalId: existing.externalId, mode: "carousel" };
  }

  const publication = await prisma.publication.upsert({
    where: { videoId_platformAccountId: { videoId, platformAccountId: account.id } },
    create: {
      orgId: script.orgId,
      videoId,
      platformAccountId: account.id,
      status: "PENDING",
    },
    update: { status: "PENDING" },
  });

  const topHook = pickTopHook(script.hooks);
  const caption = (topHook?.text ?? script.beats[0]?.line ?? "").slice(0, captionLimit);

  try {
    const slides = await renderPostSlides(script);
    let externalId: string;
    let mode: SocialPublishResult["mode"];

    if (slides.length >= 2) {
      const imageUrls = await uploadSlides(videoId, expectedPlatform, slides);
      externalId = await ops.carousel(creds, imageUrls, caption, signal);
      mode = "carousel";
    } else {
      const card = await renderQuoteCard({ headline: topHook?.text ?? caption });
      const [imageUrl] = await uploadSlides(videoId, expectedPlatform, [card]);
      externalId = await ops.single(creds, imageUrl, caption, signal);
      mode = "photo";
    }

    await prisma.publication.update({
      where: { id: publication.id },
      data: { status: "PUBLISHED", externalId, publishedAt: new Date() },
    });

    return { publicationId: publication.id, externalId, mode };
  } catch (error) {
    await prisma.publication.update({ where: { id: publication.id }, data: { status: "FAILED" } });
    throw error;
  }
}

/** Uploads each slide to public storage — Instagram/Threads fetch images by URL, not upload. */
async function uploadSlides(
  videoId: string,
  platform: string,
  slides: Buffer[]
): Promise<string[]> {
  return Promise.all(
    slides.map((slide, index) =>
      uploadRenderAsset({
        path: `slides/${videoId}/${platform.toLowerCase()}/${index}.png`,
        data: slide,
        contentType: "image/png",
      })
    )
  );
}

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

function readInstagramCredentials(credentials: unknown): InstagramCredentials | null {
  if (typeof credentials !== "object" || credentials === null) return null;
  const c = credentials as Record<string, unknown>;
  if (typeof c.accessToken !== "string" || typeof c.igUserId !== "string") return null;
  return { accessToken: c.accessToken, igUserId: c.igUserId };
}

function readThreadsCredentials(credentials: unknown): ThreadsCredentials | null {
  if (typeof credentials !== "object" || credentials === null) return null;
  const c = credentials as Record<string, unknown>;
  if (typeof c.accessToken !== "string" || typeof c.threadsUserId !== "string") return null;
  return { accessToken: c.accessToken, threadsUserId: c.threadsUserId };
}
