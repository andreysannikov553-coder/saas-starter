import { test, mock, before } from "node:test";
import assert from "node:assert/strict";
import { BeatRole } from "@prisma/client";
import type { LLMProvider, StructuredRequest } from "../llm/types";

/**
 * generateScriptForTopic talks to Prisma directly (no dependency injection
 * for the database, unlike the LLM provider). This suite mocks "@/lib/db"
 * once, up front, with node's experimental module-mock API, and drives it
 * through mutable state (the module is only imported once — re-mocking and
 * re-importing between tests leaves the already-loaded module bound to the
 * first mock). There is no live Postgres in this sandbox; this proves the
 * orchestration logic (claim lookup -> LLM call -> persistence shape) wires
 * together correctly, not that it works against a real database.
 */

interface FakeExistingScript {
  id: string;
  topicId: string;
  templateSlug: string | null;
  beats: { claimId: string | null }[];
}

interface FakeState {
  topic: { id: string; orgId: string; title: string } | null;
  claims: { id: string; text: string; evidenceLevel: string; hedgePhrase: string | null }[];
  existingScripts: FakeExistingScript[];
  created: Record<string, unknown>[];
  updated: Record<string, unknown>[];
}

const state: FakeState = { topic: null, claims: [], existingScripts: [], created: [], updated: [] };

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      topic: {
        findUnique: async () => state.topic,
        update: async (args: { data: unknown }) => {
          state.updated.push(args.data as Record<string, unknown>);
          return state.topic;
        },
      },
      claim: {
        findMany: async () => state.claims,
      },
      script: {
        findFirst: async (args: { where: { topicId: string } }) =>
          state.existingScripts.find((s) => s.topicId === args.where.topicId) ?? null,
        create: async (args: { data: Record<string, unknown> }) => {
          state.created.push(args.data);
          const beatsInput = (args.data.beats as { create: Record<string, unknown>[] }).create;
          return {
            id: "script-1",
            templateSlug: args.data.templateSlug,
            beats: beatsInput.map((b, i) => ({ id: `beat-${i}`, ...b })),
          };
        },
      },
    },
  },
});

let generateScriptForTopic: typeof import("./generate").generateScriptForTopic;

before(async () => {
  ({ generateScriptForTopic } = await import("./generate"));
});

function fakeProvider(script: unknown): LLMProvider {
  return {
    id: "fake",
    async generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
      return request.parse(script);
    },
  };
}

test("generateScriptForTopic persists a script when the topic has claims", async () => {
  state.topic = { id: "topic-1", orgId: "org-1", title: "Sleep and longevity" };
  state.claims = [{ id: "claim-1", text: "X helps Y", evidenceLevel: "A", hedgePhrase: null }];
  state.existingScripts = [];
  state.created = [];
  state.updated = [];

  const validScript = {
    templateSlug: "mechanism-explainer",
    targetSeconds: 20,
    beats: [
      { role: BeatRole.HOOK, line: "Hook line", visualIntent: null, claimId: null },
      { role: BeatRole.CURIOSITY, line: "Curiosity line", visualIntent: null, claimId: null },
      { role: BeatRole.VALUE, line: "Value line", visualIntent: null, claimId: "claim-1" },
      { role: BeatRole.CTA, line: "CTA line", visualIntent: null, claimId: null },
    ],
  };

  const result = await generateScriptForTopic("topic-1", { provider: fakeProvider(validScript) });

  assert.equal(result.scriptId, "script-1");
  assert.equal(result.beatCount, 4);
  assert.equal(result.citedClaims, 1);
  assert.equal(state.created[0].status, "FACT_GATE_PASSED");
  assert.equal(state.updated[0].status, "SCRIPTED");
});

test("generateScriptForTopic refuses a topic with no claims", async () => {
  state.topic = { id: "topic-2", orgId: "org-1", title: "Empty topic" };
  state.claims = [];
  state.existingScripts = [];

  await assert.rejects(
    () => generateScriptForTopic("topic-2", { provider: fakeProvider({}) }),
    /has no claims to script from yet/
  );
});

test("generateScriptForTopic throws when the topic does not exist", async () => {
  state.topic = null;
  state.claims = [];
  state.existingScripts = [];

  await assert.rejects(
    () => generateScriptForTopic("missing-topic", { provider: fakeProvider({}) }),
    /Topic missing-topic not found/
  );
});

test("generateScriptForTopic reuses an existing script instead of creating a duplicate (regression)", async () => {
  state.topic = { id: "topic-3", orgId: "org-1", title: "Already scripted topic" };
  state.claims = [{ id: "claim-1", text: "X helps Y", evidenceLevel: "A", hedgePhrase: null }];
  state.existingScripts = [
    {
      id: "existing-script-1",
      topicId: "topic-3",
      templateSlug: "mechanism-explainer",
      beats: [{ claimId: "claim-1" }, { claimId: null }],
    },
  ];
  state.created = [];
  state.updated = [];

  const result = await generateScriptForTopic("topic-3", { provider: fakeProvider({}) });

  assert.equal(result.scriptId, "existing-script-1");
  assert.equal(result.templateSlug, "mechanism-explainer");
  assert.equal(result.beatCount, 2);
  assert.equal(result.citedClaims, 1);
  assert.deepEqual(state.created, []);
});
