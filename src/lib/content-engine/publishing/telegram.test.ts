import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * No real Telegram bot/chat in this sandbox, so these tests mock the global
 * fetch Telegram's Bot API client calls into. They prove the client builds
 * the right request and handles Telegram's response envelope correctly —
 * not that a real bot token/chat actually receives anything.
 */

test("sendTelegramVideo posts to the sendVideo endpoint and returns the message id", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: unknown;
  globalThis.fetch = mock.fn(async (url: unknown, init: unknown) => {
    capturedBody = JSON.parse((init as { body: string }).body);
    assert.equal(url, "https://api.telegram.org/botTOKEN123/sendVideo");
    return {
      ok: true,
      statusText: "OK",
      json: async () => ({ ok: true, result: { message_id: 42 } }),
    } as Response;
  }) as unknown as typeof fetch;

  const { sendTelegramVideo } = await import("./telegram");
  const result = await sendTelegramVideo({
    botToken: "TOKEN123",
    chatId: "@mychannel",
    videoUrl: "https://example.com/v.mp4",
    caption: "hook line",
  });

  assert.equal(result.messageId, "42");
  assert.deepEqual(capturedBody, {
    chat_id: "@mychannel",
    video: "https://example.com/v.mp4",
    caption: "hook line",
  });

  globalThis.fetch = originalFetch;
});

test("sendTelegramMessage posts to the sendMessage endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: unknown;
  globalThis.fetch = mock.fn(async (url: unknown) => {
    capturedUrl = url;
    return {
      ok: true,
      statusText: "OK",
      json: async () => ({ ok: true, result: { message_id: 7 } }),
    } as Response;
  }) as unknown as typeof fetch;

  const { sendTelegramMessage } = await import("./telegram");
  const result = await sendTelegramMessage({
    botToken: "TOKEN123",
    chatId: "@mychannel",
    text: "hello",
  });

  assert.equal(result.messageId, "7");
  assert.equal(capturedUrl, "https://api.telegram.org/botTOKEN123/sendMessage");

  globalThis.fetch = originalFetch;
});

test("throws with Telegram's description when the API reports ok: false", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () => {
    return {
      ok: true,
      statusText: "OK",
      json: async () => ({ ok: false, description: "chat not found" }),
    } as Response;
  }) as unknown as typeof fetch;

  const { sendTelegramMessage } = await import("./telegram");
  await assert.rejects(
    () => sendTelegramMessage({ botToken: "TOKEN123", chatId: "@bad", text: "hi" }),
    /Telegram sendMessage failed: chat not found/
  );

  globalThis.fetch = originalFetch;
});

test("throws when the HTTP response itself is not ok", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () => {
    return {
      ok: false,
      statusText: "Unauthorized",
      json: async () => ({ ok: false }),
    } as Response;
  }) as unknown as typeof fetch;

  const { sendTelegramMessage } = await import("./telegram");
  await assert.rejects(
    () => sendTelegramMessage({ botToken: "BAD", chatId: "@x", text: "hi" }),
    /Telegram sendMessage failed: Unauthorized/
  );

  globalThis.fetch = originalFetch;
});
