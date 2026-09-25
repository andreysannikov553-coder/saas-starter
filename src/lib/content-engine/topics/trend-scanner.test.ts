import { test, mock, before } from "node:test";
import assert from "node:assert/strict";

/**
 * No real network/LLM calls in this sandbox: mocks global fetch (Google News
 * RSS) and "../llm" (getLLMProvider) to prove the headline parsing and the
 * headlines->topics request shape, not a real scan. "../llm" is mocked once
 * at module load (same pattern as publish.test.ts/social.test.ts) — node:test
 * disallows re-mocking the same module mid-file.
 */

interface FakeState {
  llmResponse: { topics: string[] };
  capturedPrompt: string;
  llmCalled: boolean;
}

const state: FakeState = {
  llmResponse: { topics: [] },
  capturedPrompt: "",
  llmCalled: false,
};

mock.module("../llm", {
  namedExports: {
    getLLMProvider: () => ({
      id: "fake",
      generateStructured: async (req: { prompt: string; parse: (raw: unknown) => unknown }) => {
        state.llmCalled = true;
        state.capturedPrompt = req.prompt;
        // Real providers call `parse` on the raw response before returning —
        // mirror that here so the parser (lowercasing, etc.) is exercised too.
        return req.parse(state.llmResponse);
      },
    }),
  },
});

let fetchTrendingHealthHeadlines: typeof import("./trend-scanner").fetchTrendingHealthHeadlines;
let scanTrendingHealthTopics: typeof import("./trend-scanner").scanTrendingHealthTopics;

before(async () => {
  ({ fetchTrendingHealthHeadlines, scanTrendingHealthTopics } = await import("./trend-scanner"));
});

function resetState() {
  state.llmResponse = { topics: [] };
  state.capturedPrompt = "";
  state.llmCalled = false;
}

function rssResponse(titles: string[]): Response {
  const items = titles.map((t) => `<item><title>${t}</title></item>`).join("");
  const xml = `<?xml version="1.0"?><rss><channel><title>"q" - Google News</title>${items}</channel></rss>`;
  return { ok: true, status: 200, statusText: "OK", text: async () => xml } as Response;
}

test("fetchTrendingHealthHeadlines dedupes titles across queries and drops the feed's own title", async () => {
  resetState();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () =>
    rssResponse([
      "Steps and mortality study",
      "Steps and mortality study",
      "Sleep and heart health",
    ])
  ) as unknown as typeof fetch;

  const headlines = await fetchTrendingHealthHeadlines();

  assert.ok(headlines.includes("Steps and mortality study"));
  assert.ok(headlines.includes("Sleep and heart health"));
  assert.ok(!headlines.some((h) => h.includes("Google News")));
  // every seed query returns the same 2 unique titles -> still just 2 after dedup
  assert.equal(headlines.length, 2);

  globalThis.fetch = originalFetch;
});

test("fetchTrendingHealthHeadlines tolerates one query failing", async () => {
  resetState();
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = mock.fn(async () => {
    call += 1;
    if (call === 1) throw new Error("network error");
    return rssResponse(["Some headline"]);
  }) as unknown as typeof fetch;

  const headlines = await fetchTrendingHealthHeadlines();

  assert.ok(headlines.includes("Some headline"));

  globalThis.fetch = originalFetch;
});

test("scanTrendingHealthTopics turns headlines into topics via the LLM and passes existing topics to skip", async () => {
  resetState();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () =>
    rssResponse(["10000 steps myth debunked by new study"])
  ) as unknown as typeof fetch;
  state.llmResponse = { topics: ["daily steps and mortality", "DAILY STEPS AND MORTALITY"] };

  const result = await scanTrendingHealthTopics(["sleep duration and cardiovascular mortality"]);

  assert.ok(result.headlinesScanned >= 1);
  assert.deepEqual(result.topics, ["daily steps and mortality", "daily steps and mortality"]);
  assert.match(state.capturedPrompt, /10000 steps myth debunked by new study/);
  assert.match(state.capturedPrompt, /sleep duration and cardiovascular mortality/);

  globalThis.fetch = originalFetch;
});

test("scanTrendingHealthTopics returns no topics without calling the LLM when no headlines come back", async () => {
  resetState();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () => {
    throw new Error("all queries fail");
  }) as unknown as typeof fetch;

  const result = await scanTrendingHealthTopics([]);

  assert.equal(result.headlinesScanned, 0);
  assert.deepEqual(result.topics, []);
  assert.equal(state.llmCalled, false);

  globalThis.fetch = originalFetch;
});
