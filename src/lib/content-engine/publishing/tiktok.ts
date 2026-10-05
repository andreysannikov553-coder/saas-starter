/**
 * TikTok Content Posting API client (open.tiktokapis.com/v2).
 *
 * TWO MODES, AND THE DIFFERENCE MATTERS FOR PRODUCTION
 * ----------------------------------------------------
 * TikTok gates real publishing behind an app audit, so this client
 * implements both of the flows a non-audited app can actually use:
 *
 *  - mode "inbox" (the DEFAULT, and the one that works today):
 *    POST /post/publish/inbox/video/init/ with the `video.upload` scope.
 *    The video is uploaded and lands in the creator's TikTok inbox as an
 *    unfinished draft. Nothing is published: the creator opens the TikTok
 *    app, writes the caption and taps "Post" themselves. So the `title`
 *    passed here is NOT used by TikTok in this mode — the API takes no
 *    caption for an inbox upload.
 *
 *  - mode "direct": POST /post/publish/video/init/ with the `video.publish`
 *    scope. This one really posts, caption and all — but until the app
 *    passes TikTok's audit, `creator_info/query` returns SELF_ONLY as the
 *    only allowed privacy level, so the post exists and is visible to the
 *    creator alone. A public post from an unaudited app is not something
 *    this (or any) code can arrange; it needs the audit. publishTikTokVideo
 *    therefore validates the requested privacy level against what the API
 *    says is allowed and fails with that list rather than silently posting
 *    something nobody can see.
 *
 * SOURCE: bytes vs URL
 * --------------------
 * FILE_UPLOAD (the default) sends the rendered MP4 in a single PUT — the
 * only source that needs no extra setup. PULL_FROM_URL is simpler on paper
 * (TikTok fetches the file itself, like Telegram's sendVideo) but requires
 * the asset's domain to be verified under "URL ownership verification" in
 * the TikTok developer portal first; with an unverified domain — which the
 * Supabase storage host is — init fails with url_ownership_unverified.
 */

const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";
const OAUTH_TOKEN_ENDPOINT = "https://open.tiktokapis.com/v2/oauth/token/";

/**
 * TikTok's per-chunk ceiling. Everything this pipeline renders is far below
 * it, so the upload is deliberately single-chunk; a longer format would need
 * the multi-chunk protocol (5MB-64MB per chunk) instead.
 */
const MAX_SINGLE_CHUNK_BYTES = 64 * 1024 * 1024;

/** TikTok truncates a caption past this; cut it here so the API never 400s. */
const TITLE_LIMIT = 2200;

export interface TikTokCredentials {
  accessToken: string;
  /**
   * The creator's open_id. The API identifies the creator from the access
   * token itself, so no request below sends this — it is stored so an
   * account row can be matched to a TikTok user when several are connected
   * (and so a stale token can be traced to a person).
   */
  openId: string;
}

export type TikTokPostMode = "inbox" | "direct";

export interface TikTokRefreshCredentials {
  clientKey: string;
  clientSecret: string;
  refreshToken: string;
}

export interface TikTokRefreshedToken {
  accessToken: string;
  /** TikTok rotates the refresh token on every refresh — store this one back. */
  refreshToken: string;
  expiresInSeconds: number | null;
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Trades a refresh token for a fresh access token.
 *
 * TikTok access tokens live 24 hours — far shorter than Instagram's
 * long-lived token, and short enough that a stored one is stale by the next
 * cron run. The refresh token lasts a year, so an unattended publish has to
 * refresh first. Note the endpoint rotates the refresh token too: whatever
 * comes back here must replace what was stored, or the next refresh fails.
 *
 * The OAuth host answers with a flat `{ error, error_description }`, not the
 * `{ data, error }` envelope the posting endpoints use, so this does not go
 * through callTikTok.
 */
export async function refreshTikTokAccessToken(
  creds: TikTokRefreshCredentials,
  signal?: AbortSignal
): Promise<TikTokRefreshedToken> {
  const response = await fetch(OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: creds.clientKey,
      client_secret: creds.clientSecret,
      grant_type: "refresh_token",
      refresh_token: creds.refreshToken,
    }),
    signal,
  });

  const data = (await response.json()) as OAuthTokenResponse;

  if (!response.ok || !data.access_token || data.error) {
    const detail = data.error_description ?? data.error ?? response.statusText;
    throw new Error(
      `TikTok token refresh failed: ${detail} — re-authorize the account through TikTok Login Kit if the refresh token expired`
    );
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? creds.refreshToken,
    expiresInSeconds: data.expires_in ?? null,
  };
}

export type TikTokPrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

interface TikTokEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
}

interface InitData {
  publish_id?: string;
  upload_url?: string;
}

interface CreatorInfoData {
  creator_username?: string;
  privacy_level_options?: string[];
  max_video_post_duration_sec?: number;
}

export interface PublishTikTokVideoOptions {
  /** The rendered MP4 — required unless `videoUrl` is given. */
  video?: Buffer;
  /** PULL_FROM_URL source. Needs a verified domain (see the module comment). */
  videoUrl?: string;
  /** Caption. Used in "direct" mode only — inbox drafts are captioned in the app. */
  title: string;
  /** Defaults to "inbox", the mode that needs no app audit. */
  mode?: TikTokPostMode;
  /** "direct" mode only. Defaults to SELF_ONLY — the only level an unaudited app gets. */
  privacyLevel?: TikTokPrivacyLevel;
  signal?: AbortSignal;
}

export interface TikTokPublishResult {
  /**
   * TikTok's publish_id. NOT a post id: an inbox draft has no post until the
   * creator finishes it, and even a direct post only gets a
   * publicaly_available_post_id once processing completes
   * (fetchTikTokPublishStatus).
   */
  publishId: string;
  mode: TikTokPostMode;
}

async function callTikTok<T>(
  path: string,
  accessToken: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(`${TIKTOK_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
    signal,
  });

  const envelope = (await response.json()) as TikTokEnvelope<T>;
  // TikTok answers 200 with error.code "ok" on success, and reports real
  // failures in the same envelope — so the status alone proves nothing.
  const code = envelope.error?.code;
  if (!response.ok || (code && code !== "ok") || !envelope.data) {
    const detail = envelope.error?.message ?? response.statusText;
    throw new Error(`TikTok ${path} failed: ${code ?? response.status} ${detail}`);
  }
  return envelope.data;
}

/**
 * The creator's posting options — privacy levels above all, since that is
 * what the app audit actually unlocks. TikTok's own guidelines require this
 * call before a direct post, so publishTikTokVideo makes it rather than
 * guessing what the account allows.
 */
export async function fetchTikTokCreatorInfo(
  creds: TikTokCredentials,
  signal?: AbortSignal
): Promise<{ username: string | null; privacyLevelOptions: string[] }> {
  const data = await callTikTok<CreatorInfoData>(
    "/post/publish/creator_info/query/",
    creds.accessToken,
    {},
    signal
  );
  return {
    username: data.creator_username ?? null,
    privacyLevelOptions: data.privacy_level_options ?? [],
  };
}

/**
 * Uploads a video to TikTok. Returns the publish_id — see
 * TikTokPublishResult on why that is not a post id.
 */
export async function publishTikTokVideo(
  creds: TikTokCredentials,
  options: PublishTikTokVideoOptions
): Promise<TikTokPublishResult> {
  const mode = options.mode ?? "inbox";

  if (!options.video && !options.videoUrl) {
    throw new Error("publishTikTokVideo needs either `video` bytes or a `videoUrl`");
  }
  if (options.video && options.video.length > MAX_SINGLE_CHUNK_BYTES) {
    throw new Error(
      `TikTok single-chunk upload supports up to ${MAX_SINGLE_CHUNK_BYTES} bytes, got ${options.video.length} — chunked upload is not implemented`
    );
  }

  const postInfo =
    mode === "direct"
      ? {
          post_info: {
            title: options.title.slice(0, TITLE_LIMIT),
            privacy_level: await resolvePrivacyLevel(creds, options),
            disable_comment: false,
            disable_duet: false,
            disable_stitch: false,
          },
        }
      : {};

  const sourceInfo = options.video
    ? {
        source_info: {
          source: "FILE_UPLOAD",
          video_size: options.video.length,
          chunk_size: options.video.length,
          total_chunk_count: 1,
        },
      }
    : { source_info: { source: "PULL_FROM_URL", video_url: options.videoUrl } };

  const path = mode === "direct" ? "/post/publish/video/init/" : "/post/publish/inbox/video/init/";
  const data = await callTikTok<InitData>(
    path,
    creds.accessToken,
    { ...postInfo, ...sourceInfo },
    options.signal
  );

  if (!data.publish_id) {
    throw new Error(`TikTok ${path} returned no publish_id`);
  }

  if (options.video) {
    if (!data.upload_url) {
      throw new Error(`TikTok ${path} returned no upload_url for a FILE_UPLOAD source`);
    }
    await putVideoChunk(data.upload_url, options.video, options.signal);
  }

  return { publishId: data.publish_id, mode };
}

/**
 * Refuses a privacy level the account cannot actually use. For an unaudited
 * app that means anything but SELF_ONLY, and the error names what TikTok did
 * offer so the cause (audit not passed) is visible from the message alone.
 */
async function resolvePrivacyLevel(
  creds: TikTokCredentials,
  options: PublishTikTokVideoOptions
): Promise<TikTokPrivacyLevel> {
  const requested = options.privacyLevel ?? "SELF_ONLY";
  const info = await fetchTikTokCreatorInfo(creds, options.signal);

  if (info.privacyLevelOptions.length > 0 && !info.privacyLevelOptions.includes(requested)) {
    throw new Error(
      `TikTok rejects privacy level ${requested} for this account — allowed: ${info.privacyLevelOptions.join(", ")}. ` +
        "An app that has not passed TikTok's audit only gets SELF_ONLY."
    );
  }
  return requested;
}

/** The whole file in one PUT — see MAX_SINGLE_CHUNK_BYTES. */
async function putVideoChunk(
  uploadUrl: string,
  video: Buffer,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(video.length),
      "Content-Range": `bytes 0-${video.length - 1}/${video.length}`,
    },
    body: new Uint8Array(video),
    signal,
  });

  if (!response.ok) {
    throw new Error(`TikTok video upload failed: ${response.status} ${response.statusText}`.trim());
  }
}

export interface TikTokPublishStatus {
  status: string;
  failReason: string | null;
  /** Set once a direct post is live; always null for an inbox draft. */
  postId: string | null;
}

/**
 * Polls what became of a publish_id. Not called by the publish path — a
 * direct post keeps processing after init returns, so this exists for
 * checking on a publish after the fact (and for the analytics stage to find
 * the real post id later).
 */
export async function fetchTikTokPublishStatus(
  creds: TikTokCredentials,
  publishId: string,
  signal?: AbortSignal
): Promise<TikTokPublishStatus> {
  const data = await callTikTok<{
    status?: string;
    fail_reason?: string;
    publicaly_available_post_id?: string[];
  }>("/post/publish/status/fetch/", creds.accessToken, { publish_id: publishId }, signal);

  return {
    status: data.status ?? "UNKNOWN",
    failReason: data.fail_reason ?? null,
    postId: data.publicaly_available_post_id?.[0] ?? null,
  };
}
