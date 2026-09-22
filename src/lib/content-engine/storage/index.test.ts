import { test, mock, before } from "node:test";
import assert from "node:assert/strict";

/**
 * uploadRenderAsset talks to Supabase Storage via @supabase/supabase-js.
 * No real Supabase project/bucket exists in this sandbox, so this suite
 * mocks createClient (via "@supabase/supabase-js" module mock) to prove the
 * upload call is built correctly and its result mapped correctly — not that
 * a real bucket receives anything.
 */

interface FakeState {
  uploadError: { message: string } | null;
  uploadCalls: { path: string; contentType: string; upsert: boolean }[];
  publicUrl: string;
}

const state: FakeState = { uploadError: null, uploadCalls: [], publicUrl: "" };

mock.module("@supabase/supabase-js", {
  namedExports: {
    createClient: () => ({
      storage: {
        from: (_bucket: string) => ({
          upload: async (
            path: string,
            _data: Buffer,
            options: { contentType: string; upsert: boolean }
          ) => {
            state.uploadCalls.push({
              path,
              contentType: options.contentType,
              upsert: options.upsert,
            });
            return { error: state.uploadError };
          },
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `${state.publicUrl}/${path}` },
          }),
        }),
      },
    }),
  },
});

let uploadRenderAsset: typeof import("./index").uploadRenderAsset;

before(async () => {
  ({ uploadRenderAsset } = await import("./index"));
});

test("uploadRenderAsset uploads with upsert:true and returns the public URL", async () => {
  state.uploadError = null;
  state.uploadCalls = [];
  state.publicUrl = "https://fake.supabase.co/storage/v1/object/public/content-engine-renders";

  const url = await uploadRenderAsset({
    path: "org-1/video-1/narration.mp3",
    data: Buffer.from("fake-audio"),
    contentType: "audio/mpeg",
  });

  assert.equal(state.uploadCalls.length, 1);
  assert.equal(state.uploadCalls[0].path, "org-1/video-1/narration.mp3");
  assert.equal(state.uploadCalls[0].contentType, "audio/mpeg");
  assert.equal(state.uploadCalls[0].upsert, true);
  assert.equal(
    url,
    "https://fake.supabase.co/storage/v1/object/public/content-engine-renders/org-1/video-1/narration.mp3"
  );
});

test("uploadRenderAsset throws with Supabase's error message on failure", async () => {
  state.uploadError = { message: "bucket not found" };

  await assert.rejects(
    () =>
      uploadRenderAsset({
        path: "org-1/video-1/narration.mp3",
        data: Buffer.from("fake-audio"),
        contentType: "audio/mpeg",
      }),
    /Failed to upload render asset to org-1\/video-1\/narration.mp3: bucket not found/
  );
});
