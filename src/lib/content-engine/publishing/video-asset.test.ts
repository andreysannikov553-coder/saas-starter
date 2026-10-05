import { test, mock } from "node:test";
import assert from "node:assert/strict";

/** Mocks global fetch — storage is not reachable from this sandbox. */
function install(
  body: Uint8Array,
  init: { ok?: boolean; status?: number; contentLength?: string } = {}
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () => {
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      statusText: init.ok === false ? "Not Found" : "OK",
      headers: new Headers(init.contentLength ? { "content-length": init.contentLength } : {}),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return () => (globalThis.fetch = originalFetch);
}

test("fetchVideoAsset downloads the render as a Buffer", async () => {
  const restore = install(new Uint8Array([1, 2, 3, 4]));
  const { fetchVideoAsset } = await import("./video-asset");

  const buffer = await fetchVideoAsset("https://cdn.example.com/v.mp4");

  assert.ok(Buffer.isBuffer(buffer));
  assert.deepEqual([...buffer], [1, 2, 3, 4]);

  restore();
});

test("fetchVideoAsset reports a failed download with the URL and status", async () => {
  const restore = install(new Uint8Array(), { ok: false, status: 404 });
  const { fetchVideoAsset } = await import("./video-asset");

  await assert.rejects(
    () => fetchVideoAsset("https://cdn.example.com/missing.mp4"),
    /missing\.mp4: 404 Not Found/
  );

  restore();
});

test("fetchVideoAsset rejects an empty body", async () => {
  const restore = install(new Uint8Array());
  const { fetchVideoAsset } = await import("./video-asset");

  await assert.rejects(() => fetchVideoAsset("https://cdn.example.com/v.mp4"), /is empty/);

  restore();
});

test("fetchVideoAsset refuses an oversized asset before reading the body", async () => {
  const restore = install(new Uint8Array([1]), { contentLength: String(300 * 1024 * 1024) });
  const { fetchVideoAsset } = await import("./video-asset");

  await assert.rejects(
    () => fetchVideoAsset("https://cdn.example.com/huge.mp4"),
    /too large to buffer for upload/
  );

  restore();
});
