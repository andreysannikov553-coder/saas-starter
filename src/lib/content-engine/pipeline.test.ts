import { test, mock, before } from "node:test";
import assert from "node:assert/strict";

/**
 * runContentPipeline is pure orchestration over the other stage functions,
 * each of which has its own PR-level tests. This suite mocks "@/lib/db" and
 * every stage module it calls (mutable state, same pattern as the other
 * integration suites) — there is no live database or provider credentials
 * in this sandbox. It proves the sequencing and stop conditions, not real
 * research/LLM/render/publish behavior.
 */

interface FakeSource {
  id: string;
  topicId: string;
  hasClaims: boolean;
}

interface FakeState {
  sources: FakeSource[];
  claimCount: number;
  researchResult: { found: number; created: number; skipped: number };
  extractClaimsCalls: string[];
  extractClaimsExtracted: number;
  scriptResult: { scriptId: string };
  hooksResult: { hookIds: string[]; bestScore: number; belowThreshold: boolean };
  narrateResult: { videoId: string; audioUrl: string };
  publishResult: { publicationId: string; externalId: string; mode: "video" | "text" };
  textOnlyVideoId: string;
}

const state: FakeState = {
  sources: [],
  claimCount: 0,
  researchResult: { found: 0, created: 0, skipped: 0 },
  extractClaimsCalls: [],
  extractClaimsExtracted: 1,
  scriptResult: { scriptId: "script-1" },
  hooksResult: { hookIds: ["hook-1", "hook-2", "hook-3"], bestScore: 20, belowThreshold: false },
  narrateResult: { videoId: "video-1", audioUrl: "https://example.com/a.mp3" },
  publishResult: { publicationId: "pub-1", externalId: "msg-1", mode: "text" },
  textOnlyVideoId: "video-text-only",
};

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      source: {
        count: async (args: { where: { topicId: string } }) =>
          state.sources.filter((s) => s.topicId === args.where.topicId).length,
        findMany: async (args: { where: { topicId: string; claims?: { none: object } } }) => {
          let matches = state.sources.filter((s) => s.topicId === args.where.topicId);
          if (args.where.claims) {
            matches = matches.filter((s) => !s.hasClaims);
          }
          return matches.map((s) => ({ id: s.id }));
        },
      },
      claim: {
        count: async () => state.claimCount,
      },
    },
  },
});

mock.module("./research", {
  namedExports: {
    researchTopic: async () => state.researchResult,
  },
});

mock.module("./claims/extract", {
  namedExports: {
    extractClaimsForSource: async (sourceId: string) => {
      state.extractClaimsCalls.push(sourceId);
      return {
        sourceId,
        extracted: state.extractClaimsExtracted,
        saved: state.extractClaimsExtracted,
      };
    },
  },
});

mock.module("./scripts/generate", {
  namedExports: {
    generateScriptForTopic: async () => state.scriptResult,
  },
});

mock.module("./hooks/generate", {
  namedExports: {
    generateHooksForScript: async () => state.hooksResult,
  },
});

mock.module("./render/narrate-video", {
  namedExports: {
    renderNarrationForScript: async () => state.narrateResult,
    getOrCreateVideoForScript: async () => state.textOnlyVideoId,
  },
});

mock.module("./publishing/publish", {
  namedExports: {
    publishVideoToTelegram: async () => state.publishResult,
  },
});

let runContentPipeline: typeof import("./pipeline").runContentPipeline;

before(async () => {
  ({ runContentPipeline } = await import("./pipeline"));
});

function reset() {
  state.sources = [];
  state.claimCount = 0;
  state.researchResult = { found: 0, created: 0, skipped: 0 };
  state.extractClaimsCalls = [];
  state.extractClaimsExtracted = 1;
  state.scriptResult = { scriptId: "script-1" };
  state.hooksResult = {
    hookIds: ["hook-1", "hook-2", "hook-3"],
    bestScore: 20,
    belowThreshold: false,
  };
  state.narrateResult = { videoId: "video-1", audioUrl: "https://example.com/a.mp3" };
  state.publishResult = { publicationId: "pub-1", externalId: "msg-1", mode: "text" };
  state.textOnlyVideoId = "video-text-only";
}

test("stops at 'research' when nothing is found and no sources exist yet", async () => {
  reset();
  state.researchResult = { found: 0, created: 0, skipped: 0 };

  const result = await runContentPipeline("topic-1");

  assert.equal(result.stoppedAt, "research");
  assert.equal(result.scriptId, null);
});

test("stops at 'claims' when research found sources but none have claims after extraction", async () => {
  reset();
  state.sources = [{ id: "source-1", topicId: "topic-2", hasClaims: false }];
  state.researchResult = { found: 1, created: 1, skipped: 0 };
  state.claimCount = 0;
  state.extractClaimsExtracted = 0;

  const result = await runContentPipeline("topic-2");

  assert.equal(result.stoppedAt, "claims");
  assert.deepEqual(state.extractClaimsCalls, ["source-1"]);
});

test("only extracts claims for sources without claims yet (regression for the duplicate-claims fix)", async () => {
  reset();
  state.sources = [
    { id: "source-old", topicId: "topic-3", hasClaims: true },
    { id: "source-new", topicId: "topic-3", hasClaims: false },
  ];
  state.researchResult = { found: 2, created: 1, skipped: 1 };
  state.claimCount = 3;

  await runContentPipeline("topic-3");

  assert.deepEqual(state.extractClaimsCalls, ["source-new"]);
});

test("stops at 'hooks' when the best hook is below threshold", async () => {
  reset();
  state.sources = [{ id: "source-1", topicId: "topic-4", hasClaims: false }];
  state.researchResult = { found: 1, created: 1, skipped: 0 };
  state.claimCount = 1;
  state.hooksResult = { hookIds: ["h1", "h2", "h3"], bestScore: 10, belowThreshold: true };

  const result = await runContentPipeline("topic-4");

  assert.equal(result.stoppedAt, "hooks");
  assert.equal(result.scriptId, "script-1");
  assert.equal(result.videoId, null);
});

test("stops at 'publish' when hooks pass but no publish option is given", async () => {
  reset();
  state.sources = [{ id: "source-1", topicId: "topic-5", hasClaims: false }];
  state.researchResult = { found: 1, created: 1, skipped: 0 };
  state.claimCount = 1;

  const result = await runContentPipeline("topic-5");

  assert.equal(result.stoppedAt, "publish");
  assert.equal(result.bestHookScore, 20);
  assert.equal(result.videoId, null);
});

test("runs narration and publishing through to completion when publish is given", async () => {
  reset();
  state.sources = [{ id: "source-1", topicId: "topic-6", hasClaims: false }];
  state.researchResult = { found: 1, created: 1, skipped: 0 };
  state.claimCount = 1;

  const result = await runContentPipeline("topic-6", {
    publish: { ttsVoiceId: "voice-1", telegramPlatformAccountId: "account-1" },
  });

  assert.equal(result.stoppedAt, null);
  assert.equal(result.videoId, "video-1");
  assert.equal(result.publicationId, "pub-1");
});

test("publishes as text without narration when ttsVoiceId is omitted", async () => {
  reset();
  state.sources = [{ id: "source-1", topicId: "topic-6b", hasClaims: false }];
  state.researchResult = { found: 1, created: 1, skipped: 0 };
  state.claimCount = 1;

  const result = await runContentPipeline("topic-6b", {
    publish: { telegramPlatformAccountId: "account-1" },
  });

  assert.equal(result.stoppedAt, null);
  assert.equal(result.videoId, "video-text-only");
  assert.equal(result.publicationId, "pub-1");
});

test("skipResearch skips researchTopic/extractClaimsForSource and uses existing claim count", async () => {
  reset();
  state.claimCount = 5;

  const result = await runContentPipeline("topic-7", { skipResearch: true });

  assert.equal(state.extractClaimsCalls.length, 0);
  assert.equal(result.scriptId, "script-1");
  assert.equal(result.stoppedAt, "publish");
});
