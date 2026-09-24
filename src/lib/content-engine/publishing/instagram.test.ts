import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * No real Instagram Business account/token in this sandbox, so these tests
 * mock the global fetch the Graph API client calls into. They prove the
 * client builds the right container->publish request sequence and handles
 * the Graph API's response envelope — not that a real account receives a
 * real post.
 */

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, statusText: "OK", json: async () => body } as Response;
}

test("publishInstagramSinglePhoto creates a container then publishes it", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; body: string }[] = [];
  globalThis.fetch = mock.fn(async (url: unknown, init: unknown) => {
    const u = String(url);
    const body = (init as { body: URLSearchParams }).body.toString();
    calls.push({ url: u, body });
    if (u.endsWith("/media")) return jsonResponse({ id: "container-1" });
    if (u.endsWith("/media_publish")) return jsonResponse({ id: "post-1" });
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;

  const { publishInstagramSinglePhoto } = await import("./instagram");
  const id = await publishInstagramSinglePhoto(
    { accessToken: "TOKEN", igUserId: "17841400000000000" },
    { imageUrl: "https://example.com/slide0.png", caption: "Hook!" }
  );

  assert.equal(id, "post-1");
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/17841400000000000\/media$/);
  assert.match(calls[0].body, /image_url=https/);
  assert.match(calls[0].body, /caption=Hook/);
  assert.match(calls[1].url, /\/17841400000000000\/media_publish$/);
  assert.match(calls[1].body, /creation_id=container-1/);

  globalThis.fetch = originalFetch;
});

test("publishInstagramCarousel creates one child container per image, then a carousel container, then publishes", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; body: string }[] = [];
  let childCounter = 0;
  globalThis.fetch = mock.fn(async (url: unknown, init: unknown) => {
    const u = String(url);
    const body = (init as { body: URLSearchParams }).body.toString();
    calls.push({ url: u, body });
    if (u.endsWith("/media_publish")) return jsonResponse({ id: "post-1" });
    if (u.endsWith("/media")) {
      if (body.includes("media_type=CAROUSEL")) return jsonResponse({ id: "carousel-1" });
      childCounter += 1;
      return jsonResponse({ id: `child-${childCounter}` });
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;

  const { publishInstagramCarousel } = await import("./instagram");
  const id = await publishInstagramCarousel(
    { accessToken: "TOKEN", igUserId: "17841400000000000" },
    {
      imageUrls: [
        "https://example.com/slide0.png",
        "https://example.com/slide1.png",
        "https://example.com/slide2.png",
      ],
      caption: "Hook!",
    }
  );

  assert.equal(id, "post-1");
  // 3 child containers + 1 carousel container + 1 publish call
  assert.equal(calls.length, 5);
  const carouselCall = calls.find((c) => c.body.includes("media_type=CAROUSEL"));
  assert.ok(carouselCall);
  assert.match(carouselCall!.body, /children=child-1%2Cchild-2%2Cchild-3/);

  globalThis.fetch = originalFetch;
});

test("publishInstagramCarousel rejects fewer than 2 images", async () => {
  const { publishInstagramCarousel } = await import("./instagram");
  await assert.rejects(
    () =>
      publishInstagramCarousel(
        { accessToken: "TOKEN", igUserId: "id" },
        { imageUrls: ["https://example.com/only.png"], caption: "x" }
      ),
    /needs 2-10 images, got 1/
  );
});

test("publishInstagramCarousel rejects more than 10 images", async () => {
  const { publishInstagramCarousel } = await import("./instagram");
  await assert.rejects(
    () =>
      publishInstagramCarousel(
        { accessToken: "TOKEN", igUserId: "id" },
        {
          imageUrls: Array.from({ length: 11 }, (_, i) => `https://example.com/${i}.png`),
          caption: "x",
        }
      ),
    /needs 2-10 images, got 11/
  );
});

test("throws with the Graph API's error message on failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () =>
    jsonResponse({ error: { message: "Invalid OAuth access token", code: 190 } })
  ) as unknown as typeof fetch;

  const { publishInstagramSinglePhoto } = await import("./instagram");
  await assert.rejects(
    () =>
      publishInstagramSinglePhoto(
        { accessToken: "BAD", igUserId: "id" },
        { imageUrl: "https://example.com/x.png", caption: "x" }
      ),
    /Invalid OAuth access token/
  );

  globalThis.fetch = originalFetch;
});
