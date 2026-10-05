/**
 * Threads API client (graph.threads.net) — same two-step container flow as
 * Instagram (publishing/instagram.ts), different host and field names
 * (`text` not `caption`, `media_type: IMAGE` required per item). Images are
 * still `image_url`, so they need the same public-URL upload as Instagram —
 * see storage/index.ts's uploadRenderAsset.
 */

const THREADS_API_BASE = "https://graph.threads.net/v1.0";

export interface ThreadsCredentials {
  accessToken: string;
  threadsUserId: string;
}

interface ThreadsApiResponse {
  id?: string;
  error?: { message: string; type?: string; code?: number };
}

async function callThreadsApi(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<string> {
  const url = new URL(`${THREADS_API_BASE}/${path}`);
  const body = new URLSearchParams(params);

  const response = await fetch(url, { method: "POST", body, signal });
  const data = (await response.json()) as ThreadsApiResponse;

  if (!response.ok || data.error || !data.id) {
    throw new Error(`Threads API ${path} failed: ${data.error?.message ?? response.statusText}`);
  }
  return data.id;
}

async function createMediaContainer(
  creds: ThreadsCredentials,
  imageUrl: string,
  options: { text?: string; isCarouselItem?: boolean; signal?: AbortSignal } = {}
): Promise<string> {
  return callThreadsApi(
    `${creds.threadsUserId}/threads`,
    {
      media_type: "IMAGE",
      image_url: imageUrl,
      access_token: creds.accessToken,
      ...(options.text ? { text: options.text } : {}),
      ...(options.isCarouselItem ? { is_carousel_item: "true" } : {}),
    },
    options.signal
  );
}

async function createCarouselContainer(
  creds: ThreadsCredentials,
  childIds: string[],
  text: string,
  signal?: AbortSignal
): Promise<string> {
  return callThreadsApi(
    `${creds.threadsUserId}/threads`,
    {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      text,
      access_token: creds.accessToken,
    },
    signal
  );
}

async function publishContainer(
  creds: ThreadsCredentials,
  creationId: string,
  signal?: AbortSignal
): Promise<string> {
  return callThreadsApi(
    `${creds.threadsUserId}/threads_publish`,
    { creation_id: creationId, access_token: creds.accessToken },
    signal
  );
}

export interface PublishCarouselOptions {
  /** 2-10 public image URLs, in display order — Threads' own carousel limit. */
  imageUrls: string[];
  text: string;
  signal?: AbortSignal;
}

/** Publishes a multi-slide carousel thread. Returns the published post's id. */
export async function publishThreadsCarousel(
  creds: ThreadsCredentials,
  options: PublishCarouselOptions
): Promise<string> {
  if (options.imageUrls.length < 2 || options.imageUrls.length > 10) {
    throw new Error(`publishThreadsCarousel needs 2-10 images, got ${options.imageUrls.length}`);
  }

  const childIds = await Promise.all(
    options.imageUrls.map((url) =>
      createMediaContainer(creds, url, { isCarouselItem: true, signal: options.signal })
    )
  );
  const creationId = await createCarouselContainer(creds, childIds, options.text, options.signal);
  return publishContainer(creds, creationId, options.signal);
}

/** Publishes a single-image thread — used when there's only one slide to show. */
export async function publishThreadsSinglePhoto(
  creds: ThreadsCredentials,
  options: { imageUrl: string; text: string; signal?: AbortSignal }
): Promise<string> {
  const creationId = await createMediaContainer(creds, options.imageUrl, {
    text: options.text,
    signal: options.signal,
  });
  return publishContainer(creds, creationId, options.signal);
}
