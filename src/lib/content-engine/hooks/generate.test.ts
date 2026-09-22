import { test, mock, before } from "node:test";
import assert from "node:assert/strict";
import type { LLMProvider, StructuredRequest } from "../llm/types";

/**
 * generateHooksForScript talks to Prisma directly. This suite mocks
 * "@/lib/db" once, up front, with node's experimental module-mock API and
 * drives it through mutable state — there is no live database in this
 * sandbox. It proves the orchestration wiring (script+beats lookup -> LLM
 * call -> Hook persistence shape -> bestScore/belowThreshold computation),
 * not a real database round trip.
 */

interface FakeScript {
  id: string;
  templateSlug: string | null;
  beats: { role: string; line: string }[];
}

interface FakeState {
  script: FakeScript | null;
  created: Record<string, unknown>[];
}

const state: FakeState = { script: null, created: [] };

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      script: {
        findUnique: async () => state.script,
      },
      hook: {
        create: async (args: { data: Record<string, unknown> }) => {
          const id = `hook-${state.created.length}`;
          state.created.push(args.data);
          return { id, ...args.data };
        },
      },
      $transaction: async (promises: Promise<unknown>[]) => Promise.all(promises),
    },
  },
});

let generateHooksForScript: typeof import("./generate").generateHooksForScript;

before(async () => {
  ({ generateHooksForScript } = await import("./generate"));
});

function fakeProvider(hooks: unknown): LLMProvider {
  return {
    id: "fake",
    async generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
      return request.parse(hooks);
    },
  };
}

function score(overrides: Partial<Record<string, number>> = {}) {
  return {
    understandingSpeed: 4,
    personalRelevance: 4,
    knowledgeGap: 4,
    promiseHonesty: 4,
    noveltyOfPhrasing: 4,
    ...overrides,
  };
}

test("generateHooksForScript persists 3 hooks and reports the best score", async () => {
  state.script = {
    id: "script-1",
    templateSlug: "mechanism-explainer",
    beats: [{ role: "HOOK", line: "Did you know..." }],
  };
  state.created = [];

  const generated = {
    hooks: [
      { text: "Hook A", hookType: "обвинение", score: score() },
      { text: "Hook B", hookType: "гипотеза", score: score({ noveltyOfPhrasing: 5 }) },
      { text: "Hook C", hookType: "скрытая деталь", score: score() },
    ],
  };

  const result = await generateHooksForScript("script-1", { provider: fakeProvider(generated) });

  assert.equal(result.scriptId, "script-1");
  assert.equal(result.hookIds.length, 3);
  assert.equal(result.bestScore, 21);
  assert.equal(result.belowThreshold, false);
  assert.equal(state.created.length, 3);
  assert.deepEqual(state.created[1].score, { ...score({ noveltyOfPhrasing: 5 }), total: 21 });
});

test("generateHooksForScript reports belowThreshold for a weak hook set", async () => {
  state.script = {
    id: "script-2",
    templateSlug: null,
    beats: [{ role: "HOOK", line: "Hi" }],
  };
  state.created = [];

  const weak = score({
    understandingSpeed: 1,
    personalRelevance: 1,
    knowledgeGap: 1,
    noveltyOfPhrasing: 1,
  });
  const generated = {
    hooks: [
      { text: "Hook A", hookType: "x", score: weak },
      { text: "Hook B", hookType: "x", score: weak },
      { text: "Hook C", hookType: "x", score: weak },
    ],
  };

  const result = await generateHooksForScript("script-2", { provider: fakeProvider(generated) });

  assert.equal(result.belowThreshold, true);
});

test("generateHooksForScript throws when the script does not exist", async () => {
  state.script = null;

  await assert.rejects(
    () => generateHooksForScript("missing-script", { provider: fakeProvider({}) }),
    /Script missing-script not found/
  );
});
