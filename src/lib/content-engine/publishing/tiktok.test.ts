import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * No TikTok app or creator token in this sandbox, so these tests mock the
 * global fetch the client calls into. They prove the request shape of both
 * posting modes — inbox draft (what an unaudited app can do) and direct post
 * (what needs the audit) — plus the single-chunk FILE_UPLOAD and the
 * envelope's `error.code` handling, not that a real video reaches TikTok.
 */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const UPLOAD_URL = "https://open-upload.tiktokapis.com/upload/?upload_id=1";

function envelope(data: unknown, error: Record<string, unknown> = { code: "ok" }): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ data, error }),
  } as unknown as Response;
}

const CREDS = { accessToken: "TOKEN", openId: "open-id-1" };

function installFetch(handlers: { creatorInfo?: () => Response; init?: () => Response } = {}) {
  const calls: Call[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async (url: unknown, init: unknown) => {
    const u = String(url);
    const request = (init ?? {}) as {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    };
    calls.push({
      url: u,
      method: request.method ?? "GET",
      headers: request.headers ?? {},
      body: request.body,
    });

    if (u.endsWith("/creator_info/query/")) {
      return handlers.creatorInfo
        ? handlers.creatorInfo()
        : envelope({
            creator_username: "channel_of_health",
            privacy_level_options: ["SELF_ONLY"],
          });
    }
    if (u.endsWith("/video/init/")) {
      return handlers.init
        ? handlers.init()
        : envelope({ publish_id: "publish-1", upload_url: UPLOAD_URL });
    }
    if (u === UPLOAD_URL) {
      return { ok: true, status: 201, statusText: "Created" } as unknown as Response;
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;

  return { calls, restore: () => (globalThis.fetch = originalFetch) };
}

test("inbox mode inits an inbox upload and PUTs the file as one chunk", async () => {
  const { calls, restore } = installFetch();
  const { publishTikTokVideo } = await import("./tiktok");

  const result = await publishTikTokVideo(CREDS, {
    video: Buffer.from("fake-mp4-bytes"),
    title: "ignored for an inbox draft",
  });

  assert.deepEqual(result, { publishId: "publish-1", mode: "inbox" });
  assert.equal(calls.length, 2);

  const [init, upload] = calls;
  assert.match(init.url, /\/v2\/post\/publish\/inbox\/video\/init\/$/);
  assert.equal(init.headers.Authorization, "Bearer TOKEN");
  const initBody = JSON.parse(String(init.body));
  assert.equal(initBody.source_info.source, "FILE_UPLOAD");
  assert.equal(initBody.source_info.video_size, 14);
  assert.equal(initBody.source_info.total_chunk_count, 1);
  // An inbox upload carries no caption — TikTok takes none for a draft.
  assert.equal(initBody.post_info, undefined);

  assert.equal(upload.url, UPLOAD_URL);
  assert.equal(upload.method, "PUT");
  assert.equal(upload.headers["Content-Range"], "bytes 0-13/14");

  restore();
});

test("direct mode checks creator_info, then posts with the caption and privacy level", async () => {
  const { calls, restore } = installFetch();
  const { publishTikTokVideo } = await import("./tiktok");

  const result = await publishTikTokVideo(CREDS, {
    video: Buffer.from("bytes"),
    title: "Ходьба продлевает жизнь",
    mode: "direct",
  });

  assert.deepEqual(result, { publishId: "publish-1", mode: "direct" });
  assert.match(calls[0].url, /\/creator_info\/query\/$/);
  assert.match(calls[1].url, /\/v2\/post\/publish\/video\/init\/$/);

  const initBody = JSON.parse(String(calls[1].body));
  assert.equal(initBody.post_info.title, "Ходьба продлевает жизнь");
  assert.equal(initBody.post_info.privacy_level, "SELF_ONLY");
  assert.equal(initBody.source_info.source, "FILE_UPLOAD");

  restore();
});

test("direct mode refuses a privacy level the account is not allowed, naming what is", async () => {
  const { restore } = installFetch();
  const { publishTikTokVideo } = await import("./tiktok");

  await assert.rejects(
    () =>
      publishTikTokVideo(CREDS, {
        video: Buffer.from("bytes"),
        title: "t",
        mode: "direct",
        privacyLevel: "PUBLIC_TO_EVERYONE",
      }),
    /allowed: SELF_ONLY[\s\S]*audit/
  );

  restore();
});

test("PULL_FROM_URL skips the byte upload entirely", async () => {
  const { calls, restore } = installFetch({
    init: () => envelope({ publish_id: "publish-2" }),
  });
  const { publishTikTokVideo } = await import("./tiktok");

  const result = await publishTikTokVideo(CREDS, {
    videoUrl: "https://cdn.example.com/video.mp4",
    title: "t",
  });

  assert.equal(result.publishId, "publish-2");
  assert.equal(calls.length, 1);
  const initBody = JSON.parse(String(calls[0].body));
  assert.equal(initBody.source_info.source, "PULL_FROM_URL");
  assert.equal(initBody.source_info.video_url, "https://cdn.example.com/video.mp4");

  restore();
});

test("reports the envelope's error code and message on failure", async () => {
  const { restore } = installFetch({
    init: () =>
      envelope(undefined, { code: "url_ownership_unverified", message: "verify the domain" }),
  });
  const { publishTikTokVideo } = await import("./tiktok");

  await assert.rejects(
    () => publishTikTokVideo(CREDS, { videoUrl: "https://cdn.example.com/v.mp4", title: "t" }),
    /url_ownership_unverified verify the domain/
  );

  restore();
});

test("needs either bytes or a URL", async () => {
  const { publishTikTokVideo } = await import("./tiktok");
  await assert.rejects(
    () => publishTikTokVideo(CREDS, { title: "t" }),
    /needs either `video` bytes or a `videoUrl`/
  );
});

test("refuses a file past the single-chunk ceiling", async () => {
  const { publishTikTokVideo } = await import("./tiktok");
  await assert.rejects(
    () =>
      publishTikTokVideo(CREDS, {
        // Sparse buffer: only the length matters to the guard.
        video: { length: 65 * 1024 * 1024 } as Buffer,
        title: "t",
      }),
    /chunked upload is not implemented/
  );
});

test("refreshTikTokAccessToken returns the rotated token pair", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = mock.fn(async (url: unknown, init: unknown) => {
    calls.push(String((init as { body: URLSearchParams }).body));
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        access_token: "fresh-access",
        refresh_token: "rotated-refresh",
        expires_in: 86400,
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const { refreshTikTokAccessToken } = await import("./tiktok");
  const fresh = await refreshTikTokAccessToken({
    clientKey: "KEY",
    clientSecret: "SECRET",
    refreshToken: "old-refresh",
  });

  assert.deepEqual(fresh, {
    accessToken: "fresh-access",
    refreshToken: "rotated-refresh",
    expiresInSeconds: 86400,
  });
  assert.match(calls[0], /grant_type=refresh_token/);
  assert.match(calls[0], /refresh_token=old-refresh/);

  globalThis.fetch = originalFetch;
});

test("refreshTikTokAccessToken reports an expired refresh token as needing re-auth", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(
    async () =>
      ({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({
          error: "invalid_grant",
          error_description: "Refresh token is invalid or expired.",
        }),
      }) as unknown as Response
  ) as unknown as typeof fetch;

  const { refreshTikTokAccessToken } = await import("./tiktok");
  await assert.rejects(
    () =>
      refreshTikTokAccessToken({
        clientKey: "KEY",
        clientSecret: "SECRET",
        refreshToken: "dead",
      }),
    /Refresh token is invalid or expired[\s\S]*Login Kit/
  );

  globalThis.fetch = originalFetch;
});

test("fetchTikTokPublishStatus reads back the post id once there is one", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () =>
    envelope({ status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["7300000000000000000"] })
  ) as unknown as typeof fetch;

  const { fetchTikTokPublishStatus } = await import("./tiktok");
  const status = await fetchTikTokPublishStatus(CREDS, "publish-1");

  assert.deepEqual(status, {
    status: "PUBLISH_COMPLETE",
    failReason: null,
    postId: "7300000000000000000",
  });

  globalThis.fetch = originalFetch;
});
