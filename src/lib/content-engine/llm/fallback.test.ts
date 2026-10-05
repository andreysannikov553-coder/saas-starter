import { test } from "node:test";
import assert from "node:assert/strict";
import { FallbackLLMProvider } from "./fallback";
import type { LLMProvider, StructuredRequest } from "./types";

function fakeProvider(id: string, run: () => Promise<unknown>): LLMProvider {
  return {
    id,
    generateStructured: async <T>(_request: StructuredRequest<T>) => run() as Promise<T>,
  };
}

const dummyRequest: StructuredRequest<{ ok: boolean }> = {
  system: "sys",
  prompt: "prompt",
  schemaName: "test",
  schema: {},
  parse: (raw) => raw as { ok: boolean },
};

test("returns the first provider's result when it succeeds", async () => {
  const calls: string[] = [];
  const a = fakeProvider("a", async () => {
    calls.push("a");
    return { ok: true };
  });
  const b = fakeProvider("b", async () => {
    calls.push("b");
    return { ok: true };
  });

  const provider = new FallbackLLMProvider([a, b]);
  const result = await provider.generateStructured(dummyRequest);

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["a"]);
});

test("falls through to the next provider when the first fails", async () => {
  const calls: string[] = [];
  const a = fakeProvider("a", async () => {
    calls.push("a");
    throw new Error("429 rate limited");
  });
  const b = fakeProvider("b", async () => {
    calls.push("b");
    return { ok: true };
  });

  const provider = new FallbackLLMProvider([a, b]);
  const result = await provider.generateStructured(dummyRequest);

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["a", "b"]);
});

test("tries every provider before giving up, then throws a combined error", async () => {
  const calls: string[] = [];
  const a = fakeProvider("a", async () => {
    calls.push("a");
    throw new Error("rate limited");
  });
  const b = fakeProvider("b", async () => {
    calls.push("b");
    throw new Error("quota exceeded");
  });

  const provider = new FallbackLLMProvider([a, b]);

  await assert.rejects(
    () => provider.generateStructured(dummyRequest),
    /a: rate limited[\s\S]*b: quota exceeded/
  );
  assert.deepEqual(calls, ["a", "b"]);
});

test("throws immediately when constructed with no providers", () => {
  assert.throws(() => new FallbackLLMProvider([]), /needs at least one provider/);
});

test("id reflects every wrapped provider", () => {
  const provider = new FallbackLLMProvider([
    fakeProvider("groq", async () => ({})),
    fakeProvider("claude", async () => ({})),
  ]);
  assert.equal(provider.id, "fallback(groq,claude)");
});
