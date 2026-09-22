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

export interface TelegramSendResult {
  messageId: string;
}

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
  result?: { message_id: number };
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
