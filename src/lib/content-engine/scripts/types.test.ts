import { test } from "node:test";
import assert from "node:assert/strict";
import { BeatRole } from "@prisma/client";
import { buildGeneratedScriptJsonSchema, parseGeneratedScript } from "./types";

const CLAIM_A = "claim-a";
const CLAIM_B = "claim-b";
const KNOWN = new Set([CLAIM_A, CLAIM_B]);

function validRaw(overrides: Record<string, unknown> = {}) {
  return {
    templateSlug: "mechanism-explainer",
    targetSeconds: 25,
    beats: [
      { role: BeatRole.HOOK, line: "Did you know...", visualIntent: null, claimId: null },
      { role: BeatRole.CURIOSITY, line: "But why?", visualIntent: "close-up", claimId: null },
      { role: BeatRole.VALUE, line: "Because X.", visualIntent: null, claimId: CLAIM_A },
      { role: BeatRole.PAYOFF, line: "So Y.", visualIntent: null, claimId: CLAIM_B },
    ],
    ...overrides,
  };
}

test("parseGeneratedScript accepts a valid full script", () => {
  const result = parseGeneratedScript(validRaw(), KNOWN);
  assert.equal(result.templateSlug, "mechanism-explainer");
  assert.equal(result.targetSeconds, 25);
  assert.equal(result.beats.length, 4);
  assert.equal(result.beats[2].claimId, CLAIM_A);
});

test("parseGeneratedScript rejects a hallucinated claimId", () => {
  const raw = validRaw({
    beats: [
      { role: BeatRole.HOOK, line: "Hi", visualIntent: null, claimId: null },
      { role: BeatRole.CURIOSITY, line: "Hi", visualIntent: null, claimId: null },
      { role: BeatRole.VALUE, line: "Hi", visualIntent: null, claimId: "made-up-id" },
      { role: BeatRole.PAYOFF, line: "Hi", visualIntent: null, claimId: null },
    ],
  });
  assert.throws(() => parseGeneratedScript(raw, KNOWN), /not one of the claims offered/);
});

test("parseGeneratedScript rejects targetSeconds out of the 15-35 range", () => {
  const raw = validRaw({ targetSeconds: 40 });
  assert.throws(
    () => parseGeneratedScript(raw, KNOWN),
    /targetSeconds must be an integer between 15 and 35/
  );
});

test("parseGeneratedScript rejects an invalid template slug", () => {
  const raw = validRaw({ templateSlug: "not-a-real-template" });
  assert.throws(() => parseGeneratedScript(raw, KNOWN), /templateSlug must be one of/);
});

test("parseGeneratedScript rejects too few beats", () => {
  const raw = validRaw({
    beats: [{ role: BeatRole.HOOK, line: "Hi", visualIntent: null, claimId: null }],
  });
  assert.throws(
    () => parseGeneratedScript(raw, KNOWN),
    /beats must be an array with at least 4 entries/
  );
});

test("buildGeneratedScriptJsonSchema embeds claim ids as an enum when claims exist", () => {
  const schema = buildGeneratedScriptJsonSchema([CLAIM_A, CLAIM_B]);
  const claimIdSchema = schema.properties.beats.items.properties.claimId as {
    enum: (string | null)[];
  };
  assert.deepEqual(claimIdSchema.enum, [CLAIM_A, CLAIM_B, null]);
});

test("buildGeneratedScriptJsonSchema forces null-only claimId when there are no claims", () => {
  const schema = buildGeneratedScriptJsonSchema([]);
  const claimIdSchema = schema.properties.beats.items.properties.claimId as { type: string };
  assert.equal(claimIdSchema.type, "null");
});
