import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { searchEuropePmc } from "./europe-pmc";

/**
 * No network access to Europe PMC in this sandbox, so this suite mocks the
 * global fetch the client calls into. It proves the retry wiring added
 * alongside the pre-production audit's observability work, not a real
 * Europe PMC round trip (see the pure-function tests for classification/
 * URL-building logic, which don't need a network call at all).
 */

const emptyBody = { resultList: { result: [] } };

test("searchEuropePmc does not retry a 4xx", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = mock.fn(async () => {
    calls += 1;
    return { ok: false, status: 400, statusText: "Bad Request" } as Response;
  }) as unknown as typeof fetch;

  await assert.rejects(() => searchEuropePmc("sleep"), /Europe PMC search failed: 400/);

  assert.equal(calls, 1);
  globalThis.fetch = originalFetch;
});

test("searchEuropePmc retries a transient 5xx and succeeds (regression: no retry was wired before)", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = mock.fn(async () => {
    calls += 1;
    if (calls < 2) {
      return { ok: false, status: 502, statusText: "Bad Gateway" } as Response;
    }
    return { ok: true, json: async () => emptyBody } as Response;
  }) as unknown as typeof fetch;

  const result = await searchEuropePmc("sleep");

  assert.equal(calls, 2);
  assert.deepEqual(result, []);
  globalThis.fetch = originalFetch;
});
