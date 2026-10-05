/**
 * Pulls a rendered video back out of storage as bytes.
 *
 * Telegram takes a URL and fetches the file itself (sendTelegramVideo), but
 * YouTube's resumable upload and TikTok's FILE_UPLOAD both want the bytes in
 * the request body, so those two need the asset in memory. Shorts-length
 * renders are a few MB (see scripts/make-kinetic-video.ts output), so a
 * single Buffer is fine here; a long-form format would need a streaming
 * upload instead of this.
 */

/** Refuse anything implausibly large rather than trying to buffer it. */
const MAX_ASSET_BYTES = 256 * 1024 * 1024;

export async function fetchVideoAsset(url: string, signal?: AbortSignal): Promise<Buffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(
      `Failed to download the rendered video from ${url}: ${response.status} ${response.statusText}`
    );
  }

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_ASSET_BYTES) {
    throw new Error(
      `Rendered video at ${url} is ${declared} bytes — too large to buffer for upload (limit ${MAX_ASSET_BYTES})`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error(`Rendered video at ${url} is empty`);
  }
  if (buffer.length > MAX_ASSET_BYTES) {
    throw new Error(
      `Rendered video at ${url} is ${buffer.length} bytes — too large to buffer for upload (limit ${MAX_ASSET_BYTES})`
    );
  }
  return buffer;
}
