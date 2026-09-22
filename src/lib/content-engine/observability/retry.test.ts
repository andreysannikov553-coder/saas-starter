import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "./retry";

function noSleep() {
  return async () => {};
}

test("withRetry returns the result on first success without retrying", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      return "ok";
    },
    { sleep: noSleep() }
  );

  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("withRetry retries on failure and succeeds within the attempt budget", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error(`fail ${calls}`);
      return "ok";
    },
    { attempts: 3, sleep: noSleep() }
  );

  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withRetry rethrows the last error once attempts are exhausted", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          throw new Error(`fail ${calls}`);
        },
        { attempts: 3, sleep: noSleep() }
      ),
    /fail 3/
  );

  assert.equal(calls, 3);
});

test("withRetry stops immediately when shouldRetry returns false", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          throw new Error("not retryable");
        },
        { attempts: 5, shouldRetry: () => false, sleep: noSleep() }
      ),
    /not retryable/
  );

  assert.equal(calls, 1);
});

test("withRetry backs off exponentially between attempts", async () => {
  const delays: number[] = [];
  let calls = 0;

  await assert.rejects(() =>
    withRetry(
      async () => {
        calls += 1;
        throw new Error("fail");
      },
      {
        attempts: 4,
        baseDelayMs: 100,
        sleep: async (ms) => {
          delays.push(ms);
        },
      }
    )
  );

  assert.equal(calls, 4);
  assert.deepEqual(delays, [100, 200, 400]);
});
