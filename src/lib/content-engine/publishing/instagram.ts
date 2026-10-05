/**
 * Instagram Graph API client — "Instagram API with Instagram Login" variant
 * (no linked Facebook Page required, unlike the older Business-login flow).
 * Publishing is a two-step container flow, unlike Telegram's single call:
 *   1. Create a media container per image (createMediaContainer) — for a
 *      carousel, one container per slide with isCarouselItem, then one more
 *      "parent" CAROUSEL container referencing them by id.
 *   2. Publish the container (publishContainer) to make it a real post.
 * Every image is passed as `image_url` — Instagram fetches it server-side,
 * so it must already be a public URL (see storage/index.ts's
 * uploadRenderAsset; there's no direct-upload equivalent of Telegram's
 * multipart sendPhoto here).
 *
 * Reels (publishInstagramReel, at the bottom) follow the same two steps from
 * a `video_url`, with one addition: the container has to be polled until
 * Instagram finishes transcoding before it can be published.
 */

const GRAPH_API_BASE = "https://graph.instagram.com/v21.0";

export interface InstagramCredentials {
  accessToken: string;
  igUserId: string;
}

interface GraphApiResponse {
  id?: string;
  error?: { message: string; type?: string; code?: number };
}

async function callGraphApi(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<string> {
  const url = new URL(`${GRAPH_API_BASE}/${path}`);
  const body = new URLSearchParams(params);

  const response = await fetch(url, { method: "POST", body, signal });
  const data = (await response.json()) as GraphApiResponse;

  if (!response.ok || data.error || !data.id) {
    throw new Error(
      `Instagram Graph API ${path} failed: ${data.error?.message ?? response.statusText}`
    );
  }
  return data.id;
}

/** One container per slide. `isCarouselItem` is required for anything but a lone single-image post. */
async function createMediaContainer(
  creds: InstagramCredentials,
  imageUrl: string,
  options: { caption?: string; isCarouselItem?: boolean; signal?: AbortSignal } = {}
): Promise<string> {
  return callGraphApi(
    `${creds.igUserId}/media`,
    {
      image_url: imageUrl,
      access_token: creds.accessToken,
      ...(options.caption ? { caption: options.caption } : {}),
      ...(options.isCarouselItem ? { is_carousel_item: "true" } : {}),
    },
    options.signal
  );
}

async function createCarouselContainer(
  creds: InstagramCredentials,
  childIds: string[],
  caption: string,
  signal?: AbortSignal
): Promise<string> {
  return callGraphApi(
    `${creds.igUserId}/media`,
    {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption,
      access_token: creds.accessToken,
    },
    signal
  );
}

async function publishContainer(
  creds: InstagramCredentials,
  creationId: string,
  signal?: AbortSignal
): Promise<string> {
  return callGraphApi(
    `${creds.igUserId}/media_publish`,
    { creation_id: creationId, access_token: creds.accessToken },
    signal
  );
}

export interface PublishCarouselOptions {
  /** 2-10 public image URLs, in display order — Instagram's own carousel limit. */
  imageUrls: string[];
  caption: string;
  signal?: AbortSignal;
}

/** Publishes a multi-slide carousel post. Returns the published media's id. */
export async function publishInstagramCarousel(
  creds: InstagramCredentials,
  options: PublishCarouselOptions
): Promise<string> {
  if (options.imageUrls.length < 2 || options.imageUrls.length > 10) {
    throw new Error(`publishInstagramCarousel needs 2-10 images, got ${options.imageUrls.length}`);
  }

  const childIds = await Promise.all(
    options.imageUrls.map((url) =>
      createMediaContainer(creds, url, { isCarouselItem: true, signal: options.signal })
    )
  );
  const creationId = await createCarouselContainer(
    creds,
    childIds,
    options.caption,
    options.signal
  );
  return publishContainer(creds, creationId, options.signal);
}

/** Publishes a single-image post — used when there's only one slide to show. */
export async function publishInstagramSinglePhoto(
  creds: InstagramCredentials,
  options: { imageUrl: string; caption: string; signal?: AbortSignal }
): Promise<string> {
  const creationId = await createMediaContainer(creds, options.imageUrl, {
    caption: options.caption,
    signal: options.signal,
  });
  return publishContainer(creds, creationId, options.signal);
}

/**
 * Reels — the video half of this API, and the one real asymmetry with the
 * photo flows above: a REELS container is not ready the moment /media
 * returns. Instagram downloads and transcodes the video asynchronously, and
 * publishing a container that is still IN_PROGRESS fails, so the container's
 * `status_code` has to be polled to FINISHED first. Everything else is the
 * same two-step container -> media_publish dance.
 */
const REEL_POLL_INTERVAL_MS = 5_000;
const REEL_POLL_TIMEOUT_MS = 5 * 60_000;

export interface PublishReelOptions {
  /** Public URL of the rendered MP4 — Instagram fetches it server-side. */
  videoUrl: string;
  caption: string;
  /** Also show the reel on the profile feed grid. Instagram defaults this to true. */
  shareToFeed?: boolean;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  signal?: AbortSignal;
}

/** Publishes a Reel from a public video URL. Returns the published media's id. */
export async function publishInstagramReel(
  creds: InstagramCredentials,
  options: PublishReelOptions
): Promise<string> {
  const creationId = await callGraphApi(
    `${creds.igUserId}/media`,
    {
      media_type: "REELS",
      video_url: options.videoUrl,
      caption: options.caption,
      access_token: creds.accessToken,
      ...(options.shareToFeed === undefined ? {} : { share_to_feed: String(options.shareToFeed) }),
    },
    options.signal
  );

  await waitForContainerReady(creds, creationId, options);

  return publishContainer(creds, creationId, options.signal);
}

interface ContainerStatusResponse {
  status_code?: string;
  status?: string;
  error?: { message: string };
}

/** Polls the container until Instagram finishes transcoding the video. */
async function waitForContainerReady(
  creds: InstagramCredentials,
  creationId: string,
  options: PublishReelOptions
): Promise<void> {
  const intervalMs = options.pollIntervalMs ?? REEL_POLL_INTERVAL_MS;
  const timeoutMs = options.pollTimeoutMs ?? REEL_POLL_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const url = new URL(`${GRAPH_API_BASE}/${creationId}`);
    url.searchParams.set("fields", "status_code,status");
    url.searchParams.set("access_token", creds.accessToken);

    const response = await fetch(url, { signal: options.signal });
    const data = (await response.json()) as ContainerStatusResponse;

    if (!response.ok || data.error) {
      throw new Error(
        `Instagram container status check failed: ${data.error?.message ?? response.statusText}`
      );
    }

    // PUBLISHED can only mean someone else published this container already;
    // either way there is nothing left to wait for.
    if (data.status_code === "FINISHED" || data.status_code === "PUBLISHED") return;
    if (data.status_code === "ERROR" || data.status_code === "EXPIRED") {
      throw new Error(
        `Instagram failed to process the Reel container: ${data.status_code}${data.status ? ` (${data.status})` : ""}`
      );
    }

    if (Date.now() + intervalMs > deadline) {
      throw new Error(
        `Instagram Reel container ${creationId} was still ${data.status_code ?? "unknown"} after ${Math.round(timeoutMs / 1000)}s`
      );
    }
    await sleep(intervalMs, options.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
