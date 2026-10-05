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

/**
 * Reels, unlike the photo flows above, need the container polled to FINISHED
 * before it can be published — these drive that loop with a fake clock-free
 * 1ms interval rather than waiting the real 5s.
 */
function installReelFetch(statusSequence: string[]) {
  const calls: { url: string; body?: string }[] = [];
  const originalFetch = globalThis.fetch;
  let statusIndex = 0;
  globalThis.fetch = mock.fn(async (url: unknown, init: unknown) => {
    const u = String(url);
    if (u.includes("fields=status_code")) {
      calls.push({ url: u });
      const status = statusSequence[Math.min(statusIndex, statusSequence.length - 1)];
      statusIndex += 1;
      return jsonResponse({ status_code: status });
    }
    const body = (init as { body: URLSearchParams }).body.toString();
    calls.push({ url: u, body });
    if (u.endsWith("/media")) return jsonResponse({ id: "reel-container-1" });
    if (u.endsWith("/media_publish")) return jsonResponse({ id: "reel-post-1" });
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;

  return { calls, restore: () => (globalThis.fetch = originalFetch) };
}

test("publishInstagramReel creates a REELS container, waits for FINISHED, then publishes", async () => {
  const { calls, restore } = installReelFetch(["IN_PROGRESS", "IN_PROGRESS", "FINISHED"]);

  const { publishInstagramReel } = await import("./instagram");
  const id = await publishInstagramReel(
    { accessToken: "TOKEN", igUserId: "17841400000000000" },
    {
      videoUrl: "https://cdn.example.com/short.mp4",
      caption: "Hook!",
      shareToFeed: true,
      pollIntervalMs: 1,
    }
  );

  assert.equal(id, "reel-post-1");
  // container + 3 status checks + publish
  assert.equal(calls.length, 5);
  assert.match(calls[0].body!, /media_type=REELS/);
  assert.match(calls[0].body!, /video_url=https/);
  assert.match(calls[0].body!, /share_to_feed=true/);
  assert.match(calls[1].url, /\/reel-container-1\?fields=status_code/);
  assert.match(calls[4].url, /\/media_publish$/);
  assert.match(calls[4].body!, /creation_id=reel-container-1/);

  restore();
});

test("publishInstagramReel fails when Instagram cannot process the video", async () => {
  const { restore } = installReelFetch(["IN_PROGRESS", "ERROR"]);

  const { publishInstagramReel } = await import("./instagram");
  await assert.rejects(
    () =>
      publishInstagramReel(
        { accessToken: "TOKEN", igUserId: "id" },
        { videoUrl: "https://cdn.example.com/short.mp4", caption: "x", pollIntervalMs: 1 }
      ),
    /failed to process the Reel container: ERROR/
  );

  restore();
});

test("publishInstagramReel gives up with the last status when the container never finishes", async () => {
  const { restore } = installReelFetch(["IN_PROGRESS"]);

  const { publishInstagramReel } = await import("./instagram");
  await assert.rejects(
    () =>
      publishInstagramReel(
        { accessToken: "TOKEN", igUserId: "id" },
        {
          videoUrl: "https://cdn.example.com/short.mp4",
          caption: "x",
          pollIntervalMs: 1,
          pollTimeoutMs: 5,
        }
      ),
    /was still IN_PROGRESS after/
  );

  restore();
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
