import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * No real Threads account/token in this sandbox — same approach as
 * instagram.test.ts, mocking global fetch to prove the request sequence and
 * response handling, not a real post.
 */

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, statusText: "OK", json: async () => body } as Response;
}

test("publishThreadsSinglePhoto creates a container then publishes it", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; body: string }[] = [];
  globalThis.fetch = mock.fn(async (url: unknown, init: unknown) => {
    const u = String(url);
    const body = (init as { body: URLSearchParams }).body.toString();
    calls.push({ url: u, body });
    if (u.endsWith("/threads")) return jsonResponse({ id: "container-1" });
    if (u.endsWith("/threads_publish")) return jsonResponse({ id: "post-1" });
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;

  const { publishThreadsSinglePhoto } = await import("./threads");
  const id = await publishThreadsSinglePhoto(
    { accessToken: "TOKEN", threadsUserId: "9999999999" },
    { imageUrl: "https://example.com/slide0.png", text: "Hook!" }
  );

  assert.equal(id, "post-1");
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/9999999999\/threads$/);
  assert.match(calls[0].body, /media_type=IMAGE/);
  assert.match(calls[0].body, /text=Hook/);
  assert.match(calls[1].url, /\/9999999999\/threads_publish$/);
  assert.match(calls[1].body, /creation_id=container-1/);

  globalThis.fetch = originalFetch;
});

test("publishThreadsCarousel creates one child container per image, then a carousel container, then publishes", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; body: string }[] = [];
  let childCounter = 0;
  globalThis.fetch = mock.fn(async (url: unknown, init: unknown) => {
    const u = String(url);
    const body = (init as { body: URLSearchParams }).body.toString();
    calls.push({ url: u, body });
    if (u.endsWith("/threads_publish")) return jsonResponse({ id: "post-1" });
    if (u.endsWith("/threads")) {
      if (body.includes("media_type=CAROUSEL")) return jsonResponse({ id: "carousel-1" });
      childCounter += 1;
      return jsonResponse({ id: `child-${childCounter}` });
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;

  const { publishThreadsCarousel } = await import("./threads");
  const id = await publishThreadsCarousel(
    { accessToken: "TOKEN", threadsUserId: "9999999999" },
    {
      imageUrls: ["https://example.com/slide0.png", "https://example.com/slide1.png"],
      text: "Hook!",
    }
  );

  assert.equal(id, "post-1");
  assert.equal(calls.length, 4); // 2 children + 1 carousel container + 1 publish
  const carouselCall = calls.find((c) => c.body.includes("media_type=CAROUSEL"));
  assert.ok(carouselCall);
  assert.match(carouselCall!.body, /children=child-1%2Cchild-2/);

  globalThis.fetch = originalFetch;
});

test("publishThreadsCarousel rejects fewer than 2 images", async () => {
  const { publishThreadsCarousel } = await import("./threads");
  await assert.rejects(
    () =>
      publishThreadsCarousel(
        { accessToken: "TOKEN", threadsUserId: "id" },
        { imageUrls: ["https://example.com/only.png"], text: "x" }
      ),
    /needs 2-10 images, got 1/
  );
});

test("throws with the Threads API's error message on failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () =>
    jsonResponse({ error: { message: "Invalid OAuth access token", code: 190 } })
  ) as unknown as typeof fetch;

  const { publishThreadsSinglePhoto } = await import("./threads");
  await assert.rejects(
    () =>
      publishThreadsSinglePhoto(
        { accessToken: "BAD", threadsUserId: "id" },
        { imageUrl: "https://example.com/x.png", text: "x" }
      ),
    /Invalid OAuth access token/
  );

  globalThis.fetch = originalFetch;
});
