import { prisma } from "@/lib/db";
import { sendTelegramMessage, sendTelegramVideo } from "./telegram";
import { withStageLog } from "../observability/logger";

export interface PublishToTelegramOptions {
  /** Caption/text override — defaults to the full script, one beat's line per paragraph. */
  text?: string;
  signal?: AbortSignal;
}

export interface PublishToTelegramResult {
  publicationId: string;
  externalId: string;
  mode: "video" | "text";
}

/**
 * Publishes a Video to a Telegram PlatformAccount and records the result as
 * a Publication row.
 *
 * Falls back to a text-only post when the Video has no `assetUrl` yet (no
 * renderer is built in this pipeline stage) — Telegram is worth posting to
 * even before video rendering exists, since a text post with the full
 * script still validates the channel and the script content end to end.
 *
 * Skips sending anything if this video+account is already PUBLISHED —
 * without this, a pipeline re-run (or a caller retrying after a later stage
 * failed) would re-send the same message to the real Telegram chat every
 * time, even though the PR #6 upsert() already made the Publication row
 * itself safe to touch again. A PENDING or FAILED row still resends, same
 * as before, since those represent a publish that never actually succeeded.
 */
export async function publishVideoToTelegram(
  videoId: string,
  platformAccountId: string,
  options: PublishToTelegramOptions = {}
): Promise<PublishToTelegramResult> {
  return withStageLog(
    "publish",
    { videoId, platformAccountId },
    () => doPublish(videoId, platformAccountId, options),
    (result) => ({ ...result })
  );
}

async function doPublish(
  videoId: string,
  platformAccountId: string,
  options: PublishToTelegramOptions
): Promise<PublishToTelegramResult> {
  const [video, account] = await Promise.all([
    prisma.video.findUnique({
      where: { id: videoId },
      include: { script: { include: { beats: { orderBy: { order: "asc" } } } } },
    }),
    prisma.platformAccount.findUnique({ where: { id: platformAccountId } }),
  ]);

  if (!video) {
    throw new Error(`Video ${videoId} not found`);
  }
  if (!account) {
    throw new Error(`PlatformAccount ${platformAccountId} not found`);
  }
  if (account.platform !== "TELEGRAM") {
    throw new Error(`PlatformAccount ${platformAccountId} is not a Telegram account`);
  }

  const botToken = readBotToken(account.credentials);
  if (!botToken) {
    throw new Error(
      `PlatformAccount ${platformAccountId} has no Telegram bot token in credentials`
    );
  }

  const existing = await prisma.publication.findUnique({
    where: { videoId_platformAccountId: { videoId: video.id, platformAccountId: account.id } },
  });
  if (existing && existing.status === "PUBLISHED" && existing.externalId) {
    return {
      publicationId: existing.id,
      externalId: existing.externalId,
      mode: video.assetUrl ? "video" : "text",
    };
  }

  // Publication has a unique(videoId, platformAccountId) constraint (PR #1) so a
  // pipeline re-run for the same video+account doesn't create a duplicate row — a
  // bare create() would throw on retry after a FAILED attempt. upsert() resets an
  // existing row back to PENDING instead.
  const publication = await prisma.publication.upsert({
    where: { videoId_platformAccountId: { videoId: video.id, platformAccountId: account.id } },
    create: {
      orgId: video.orgId,
      videoId: video.id,
      platformAccountId: account.id,
      status: "PENDING",
    },
    update: { status: "PENDING" },
  });

  const caption = options.text ?? buildCaption(video.script.beats);

  try {
    const result = video.assetUrl
      ? await sendTelegramVideo({
          botToken,
          chatId: account.handle,
          videoUrl: video.assetUrl,
          caption,
          signal: options.signal,
        })
      : await sendTelegramMessage({
          botToken,
          chatId: account.handle,
          text: caption,
          signal: options.signal,
        });

    await prisma.publication.update({
      where: { id: publication.id },
      data: { status: "PUBLISHED", externalId: result.messageId, publishedAt: new Date() },
    });

    return {
      publicationId: publication.id,
      externalId: result.messageId,
      mode: video.assetUrl ? "video" : "text",
    };
  } catch (error) {
    await prisma.publication.update({
      where: { id: publication.id },
      data: { status: "FAILED" },
    });
    throw error;
  }
}

function readBotToken(credentials: unknown): string | null {
  if (typeof credentials !== "object" || credentials === null) return null;
  const token = (credentials as Record<string, unknown>).botToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** Joins every beat's line in order — the full script, not just the hook/CTA. */
function buildCaption(beats: { role: string; line: string }[]): string {
  return beats.map((b) => b.line).join("\n\n");
}
