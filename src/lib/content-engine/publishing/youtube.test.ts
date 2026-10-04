import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * No Google OAuth client or channel in this sandbox, so these tests mock the
 * global fetch the client calls into. They prove the three-request shape of a
 * resumable upload (token refresh -> session start -> byte PUT), that the
 * session URI comes from the `Location` header, and how the API's error
 * bodies surface — not that a real video appears on a real channel.
 */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function response(
  body: unknown,
  init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: "OK",
    headers: new Headers(init.headers ?? {}),
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => text,
  } as unknown as Response;
}

const CREDS = { refreshToken: "REFRESH", clientId: "CLIENT", clientSecret: "SECRET" };
const SESSION_URI = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc";

/** Records every request and answers the full happy-path sequence. */
function installFetch(overrides: { onUpload?: () => Response } = {}) {
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

    if (u.startsWith("https://oauth2.googleapis.com/token")) {
      return response({ access_token: "ACCESS", expires_in: 3599 });
    }
    if (u.startsWith("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable")) {
      return response({}, { headers: { location: SESSION_URI } });
    }
    if (u === SESSION_URI) {
      return overrides.onUpload ? overrides.onUpload() : response({ id: "yt-video-1" });
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;

  return { calls, restore: () => (globalThis.fetch = originalFetch) };
}

test("uploadYouTubeShort refreshes the token, opens a resumable session, then PUTs the bytes", async () => {
  const { calls, restore } = installFetch();
  const { uploadYouTubeShort } = await import("./youtube");

  const id = await uploadYouTubeShort(CREDS, {
    video: Buffer.from("fake-mp4-bytes"),
    title: "Ходьба продлевает жизнь",
    description: "Разбор мета-анализа.",
  });

  assert.equal(id, "yt-video-1");
  assert.equal(calls.length, 3);

  const [token, session, upload] = calls;
  assert.match(token.url, /oauth2\.googleapis\.com\/token/);
  assert.match(String(token.body), /grant_type=refresh_token/);
  assert.match(String(token.body), /refresh_token=REFRESH/);

  assert.match(session.url, /uploadType=resumable/);
  assert.match(session.url, /part=snippet%2Cstatus/);
  assert.equal(session.headers.Authorization, "Bearer ACCESS");
  assert.equal(session.headers["X-Upload-Content-Length"], "14");
  const snippet = JSON.parse(String(session.body));
  assert.equal(snippet.snippet.title, "Ходьба продлевает жизнь");
  assert.equal(snippet.status.privacyStatus, "public");
  assert.equal(snippet.status.selfDeclaredMadeForKids, false);
  assert.equal(snippet.snippet.categoryId, "22");

  assert.equal(upload.url, SESSION_URI);
  assert.equal(upload.method, "PUT");
  assert.equal(upload.headers["Content-Type"], "video/mp4");

  restore();
});

test("appends #Shorts to the description and clamps a 100+ char title", async () => {
  const { calls, restore } = installFetch();
  const { uploadYouTubeShort } = await import("./youtube");

  await uploadYouTubeShort(CREDS, {
    video: Buffer.from("x"),
    title: "a".repeat(140),
    description: "Short description",
    privacyStatus: "unlisted",
  });

  const snippet = JSON.parse(String(calls[1].body));
  assert.equal(snippet.snippet.title.length, 100);
  assert.match(snippet.snippet.description, /#Shorts$/);
  assert.equal(snippet.status.privacyStatus, "unlisted");

  restore();
});

test("does not add a second #Shorts tag when the description already has one", async () => {
  const { calls, restore } = installFetch();
  const { uploadYouTubeShort } = await import("./youtube");

  await uploadYouTubeShort(CREDS, {
    video: Buffer.from("x"),
    title: "Title",
    description: "Body text #shorts",
  });

  const snippet = JSON.parse(String(calls[1].body));
  assert.equal(snippet.snippet.description, "Body text #shorts");

  restore();
});

test("a revoked refresh token says how to mint a new one", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () =>
    response(
      { error: "invalid_grant", error_description: "Token has been expired or revoked." },
      { ok: false, status: 400 }
    )
  ) as unknown as typeof fetch;

  const { uploadYouTubeShort } = await import("./youtube");
  await assert.rejects(
    () => uploadYouTubeShort(CREDS, { video: Buffer.from("x"), title: "t", description: "d" }),
    /Token has been expired or revoked[\s\S]*scripts\/youtube-oauth\.ts/
  );

  globalThis.fetch = originalFetch;
});

test("surfaces the API error message when the byte upload fails", async () => {
  const { restore } = installFetch({
    onUpload: () =>
      response(
        { error: { message: "The request metadata is invalid.", code: 400 } },
        { ok: false, status: 400 }
      ),
  });

  const { uploadYouTubeShort } = await import("./youtube");
  await assert.rejects(
    () => uploadYouTubeShort(CREDS, { video: Buffer.from("x"), title: "t", description: "d" }),
    /The request metadata is invalid/
  );

  restore();
});

test("fails when the resumable session comes back without a Location header", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async (url: unknown) => {
    if (String(url).includes("oauth2")) return response({ access_token: "ACCESS" });
    return response({});
  }) as unknown as typeof fetch;

  const { uploadYouTubeShort } = await import("./youtube");
  await assert.rejects(
    () => uploadYouTubeShort(CREDS, { video: Buffer.from("x"), title: "t", description: "d" }),
    /no resumable session URI/
  );

  globalThis.fetch = originalFetch;
});

test("rejects an empty video buffer before touching the network", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = mock.fn(async () => {
    called = true;
    return response({});
  }) as unknown as typeof fetch;

  const { uploadYouTubeShort } = await import("./youtube");
  await assert.rejects(
    () => uploadYouTubeShort(CREDS, { video: Buffer.alloc(0), title: "t", description: "d" }),
    /empty video buffer/
  );
  assert.equal(called, false);

  globalThis.fetch = originalFetch;
});

test("rejects a blank title", async () => {
  const { restore } = installFetch();
  const { uploadYouTubeShort } = await import("./youtube");

  await assert.rejects(
    () => uploadYouTubeShort(CREDS, { video: Buffer.from("x"), title: "   ", description: "d" }),
    /non-empty title/
  );

  restore();
});
