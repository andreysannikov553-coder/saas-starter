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
