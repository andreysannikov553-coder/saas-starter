/**
 * Minimal Telegram Bot API client for publishing — the one platform
 * automatable from day one with no app-review wait (discovery doc section
 * 17; Instagram/Threads need Meta app review and land as
 * PublicationStatus.MANUAL_REQUIRED instead, not built here).
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";

export interface SendVideoOptions {
  botToken: string;
  chatId: string;
  videoUrl: string;
  caption?: string;
  signal?: AbortSignal;
}

export interface SendMessageOptions {
  botToken: string;
  chatId: string;
  text: string;
  signal?: AbortSignal;
}

export interface SendPhotoOptions {
  botToken: string;
  chatId: string;
  photo: Buffer;
  /** Telegram truncates photo captions at 1024 chars — pass a short one. */
  caption?: string;
  filename?: string;
  signal?: AbortSignal;
}

export interface SendMediaGroupOptions {
  botToken: string;
  chatId: string;
  /** 2-10 photos, in display order — Telegram's own album/carousel limit. */
  photos: Buffer[];
  /** Shown under the album — only the first item's caption renders. */
  caption?: string;
  signal?: AbortSignal;
}

export interface TelegramSendResult {
  messageId: string;
}

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
  result?: { message_id: number };
}

interface TelegramMediaGroupApiResponse {
  ok: boolean;
  description?: string;
  result?: { message_id: number }[];
}

/**
 * Sends a video by URL (Telegram fetches it server-side — no upload needed
 * from here) with an optional caption, e.g. the hook line or CTA.
 */
export async function sendTelegramVideo(options: SendVideoOptions): Promise<TelegramSendResult> {
  return callTelegram(
    options.botToken,
    "sendVideo",
    {
      chat_id: options.chatId,
      video: options.videoUrl,
      caption: options.caption,
    },
    options.signal
  );
}

/** Text-only post — used when no rendered video asset exists yet. */
export async function sendTelegramMessage(
  options: SendMessageOptions
): Promise<TelegramSendResult> {
  return callTelegram(
    options.botToken,
    "sendMessage",
    {
      chat_id: options.chatId,
      text: options.text,
    },
    options.signal
  );
}

/**
 * Sends a locally-rendered image (the quote card) as a photo — used instead
 * of sendMessage when no video asset exists yet, so posts have something to
 * look at (see render/quote-card.tsx). Uploaded directly as multipart, since
 * there's no public URL for an ephemeral in-memory PNG.
 */
export async function sendTelegramPhoto(options: SendPhotoOptions): Promise<TelegramSendResult> {
  const form = new FormData();
  form.append("chat_id", options.chatId);
  if (options.caption) form.append("caption", options.caption);
  form.append(
    "photo",
    new Blob([new Uint8Array(options.photo)], { type: "image/png" }),
    options.filename ?? "card.png"
  );

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${options.botToken}/sendPhoto`, {
    method: "POST",
    body: form,
    signal: options.signal,
  });

  const data = (await response.json()) as TelegramApiResponse;

  if (!response.ok || !data.ok || !data.result) {
    throw new Error(`Telegram sendPhoto failed: ${data.description ?? response.statusText}`);
  }

  return { messageId: String(data.result.message_id) };
}

/**
 * Sends a swipeable album — the carousel format (render/quote-card.tsx's
 * renderCarouselSlides): one slide per beat instead of a single card plus a
 * wall of text below it. Telegram requires 2-10 items in a media group.
 */
export async function sendTelegramMediaGroup(
  options: SendMediaGroupOptions
): Promise<TelegramSendResult> {
  if (options.photos.length < 2 || options.photos.length > 10) {
    throw new Error(`sendTelegramMediaGroup needs 2-10 photos, got ${options.photos.length}`);
  }

  const form = new FormData();
  form.append("chat_id", options.chatId);

  const media = options.photos.map((_, index) => {
    const item: Record<string, unknown> = {
      type: "photo",
      media: `attach://photo${index}`,
    };
    if (index === 0 && options.caption) item.caption = options.caption;
    return item;
  });
  form.append("media", JSON.stringify(media));

  options.photos.forEach((photo, index) => {
    form.append(
      `photo${index}`,
      new Blob([new Uint8Array(photo)], { type: "image/png" }),
      `slide${index}.png`
    );
  });

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${options.botToken}/sendMediaGroup`, {
    method: "POST",
    body: form,
    signal: options.signal,
  });

  const data = (await response.json()) as TelegramMediaGroupApiResponse;

  if (!response.ok || !data.ok || !data.result || data.result.length === 0) {
    throw new Error(`Telegram sendMediaGroup failed: ${data.description ?? response.statusText}`);
  }

  return { messageId: String(data.result[0].message_id) };
}

async function callTelegram(
  botToken: string,
  method: "sendVideo" | "sendMessage",
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<TelegramSendResult> {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  const data = (await response.json()) as TelegramApiResponse;

  if (!response.ok || !data.ok || !data.result) {
    throw new Error(`Telegram ${method} failed: ${data.description ?? response.statusText}`);
  }

  return { messageId: String(data.result.message_id) };
}
