/**
 * YouTube Data API v3 client for publishing Shorts.
 *
 * Two differences from the Telegram/Instagram clients in this folder:
 *
 *  1. Auth is OAuth, not a static token. The PlatformAccount holds the
 *     long-lived refresh token minted once by scripts/youtube-oauth.ts plus
 *     the Desktop-app client id/secret; every upload trades them for a
 *     one-hour access token first (exchangeRefreshToken). Nothing is cached
 *     between calls — a publish happens a few times a day at most, so the
 *     extra token round-trip is cheaper than holding state that can go
 *     stale.
 *  2. The video is uploaded as bytes, not fetched from a URL. videos.insert
 *     has no `video_url` equivalent, so the caller downloads the render from
 *     storage first (see video-asset.ts) and the bytes go up through the
 *     resumable protocol: one POST that carries only the metadata and
 *     returns a session URI in the `Location` header, then one PUT of the
 *     file to that URI. Resumable rather than multipart because it is the
 *     mode Google documents for anything that is not tiny, and because a
 *     failed PUT can be retried against the same session URI.
 *
 * "Shorts" is not a parameter: YouTube classifies an upload as a Short from
 * the video itself (vertical, under 3 minutes — what render/kinetic-video.ts
 * produces). The `#Shorts` tag in the description is only a hint.
 */

const OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const RESUMABLE_UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/youtube/v3/videos";

/** YouTube's own hard limits — exceeding either is a 400, not a truncation. */
const TITLE_LIMIT = 100;
const DESCRIPTION_LIMIT = 5000;

/** "People & Blogs" — the neutral default for health/sport talking-point Shorts. */
const DEFAULT_CATEGORY_ID = "22";

export interface YouTubeCredentials {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface VideoResource {
  id?: string;
  error?: { message?: string; code?: number };
}

/**
 * Trades the stored refresh token for a short-lived access token.
 *
 * A revoked/expired refresh token surfaces here as `invalid_grant`, which is
 * the one failure Andrey has to fix by hand (re-run scripts/youtube-oauth.ts)
 * — so it is reported with Google's own error text rather than a generic
 * "upload failed" further down.
 */
export async function exchangeRefreshToken(
  creds: YouTubeCredentials,
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch(OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    }),
    signal,
  });

  const data = (await response.json()) as TokenResponse;

  if (!response.ok || !data.access_token) {
    const detail = data.error_description ?? data.error ?? response.statusText;
    throw new Error(
      `YouTube token refresh failed: ${detail}` +
        (data.error === "invalid_grant"
          ? " — re-run scripts/youtube-oauth.ts to mint a new refresh token"
          : "")
    );
  }

  return data.access_token;
}

export interface UploadShortOptions {
  /** The rendered MP4 — see video-asset.ts's fetchVideoAsset. */
  video: Buffer;
  title: string;
  description: string;
  tags?: string[];
  /** Defaults to "public". Use "private"/"unlisted" for a dry run on a real channel. */
  privacyStatus?: "public" | "unlisted" | "private";
  categoryId?: string;
  signal?: AbortSignal;
}

/**
 * Uploads a video and returns its YouTube video id (the `abc123` in
 * youtube.com/shorts/abc123).
 *
 * `selfDeclaredMadeForKids: false` is sent explicitly: YouTube rejects an
 * upload that declares nothing, and health/sport content is not made for
 * kids.
 */
export async function uploadYouTubeShort(
  creds: YouTubeCredentials,
  options: UploadShortOptions
): Promise<string> {
  if (options.video.length === 0) {
    throw new Error("uploadYouTubeShort was given an empty video buffer");
  }

  const accessToken = await exchangeRefreshToken(creds, options.signal);
  const sessionUri = await startResumableSession(accessToken, options);
  return uploadSessionBytes(sessionUri, accessToken, options);
}

/** Step 1: metadata-only POST whose `Location` header is the upload session. */
async function startResumableSession(
  accessToken: string,
  options: UploadShortOptions
): Promise<string> {
  const url = new URL(RESUMABLE_UPLOAD_ENDPOINT);
  url.searchParams.set("uploadType", "resumable");
  url.searchParams.set("part", "snippet,status");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(options.video.length),
      "X-Upload-Content-Type": "video/mp4",
    },
    body: JSON.stringify({
      snippet: {
        title: sanitizeTitle(options.title),
        description: withShortsTag(options.description),
        tags: options.tags,
        categoryId: options.categoryId ?? DEFAULT_CATEGORY_ID,
      },
      status: {
        privacyStatus: options.privacyStatus ?? "public",
        selfDeclaredMadeForKids: false,
      },
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`YouTube videos.insert failed to start: ${await readApiError(response)}`);
  }

  const sessionUri = response.headers.get("location");
  if (!sessionUri) {
    throw new Error("YouTube videos.insert returned no resumable session URI (no Location header)");
  }
  return sessionUri;
}

/** Step 2: the file itself, in one PUT to the session URI. */
async function uploadSessionBytes(
  sessionUri: string,
  accessToken: string,
  options: UploadShortOptions
): Promise<string> {
  const response = await fetch(sessionUri, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "video/mp4",
      "Content-Length": String(options.video.length),
    },
    body: new Uint8Array(options.video),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`YouTube video upload failed: ${await readApiError(response)}`);
  }

  const data = (await response.json()) as VideoResource;
  if (data.error || !data.id) {
    throw new Error(
      `YouTube video upload failed: ${data.error?.message ?? "response carried no video id"}`
    );
  }
  return data.id;
}

/**
 * Google's error body is `{ error: { message, code } }` on the JSON APIs but
 * can be plain text on the upload host, so this falls back to the raw body
 * instead of throwing a parse error over the real failure.
 */
async function readApiError(response: Response): Promise<string> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    return `${response.status} ${response.statusText}`;
  }

  try {
    const parsed = JSON.parse(body) as VideoResource;
    if (parsed.error?.message) return `${response.status} ${parsed.error.message}`;
  } catch {
    // Not JSON — fall through to the raw body below.
  }
  return `${response.status} ${response.statusText}${body ? ` ${body.slice(0, 300)}` : ""}`;
}

/** YouTube rejects `<`/`>` in a title outright, and anything over 100 chars. */
function sanitizeTitle(title: string): string {
  const cleaned = title.replace(/[<>]/g, "").trim();
  if (cleaned.length === 0) {
    throw new Error("uploadYouTubeShort needs a non-empty title");
  }
  return cleaned.length > TITLE_LIMIT ? `${cleaned.slice(0, TITLE_LIMIT - 1).trimEnd()}…` : cleaned;
}

function withShortsTag(description: string): string {
  const cleaned = description.replace(/[<>]/g, "").trim();
  const tagged = /#shorts\b/i.test(cleaned) ? cleaned : `${cleaned}\n\n#Shorts`.trim();
  return tagged.slice(0, DESCRIPTION_LIMIT);
}
