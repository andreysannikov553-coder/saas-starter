import { createClient } from "@supabase/supabase-js";
import { env } from "@/env.mjs";

/**
 * Storage for content-engine render artifacts (narration audio, later
 * assembled video). Uses Supabase Storage — already in the stack for auth,
 * and the only storage provider Andrey confirmed (2026-09-21) so nothing
 * else in the pipeline needs a second file-storage integration.
 *
 * A dedicated service-role client, not `@/lib/supabase/server` — that one
 * is built around a per-request cookie jar (`next/headers`), which doesn't
 * exist for content-engine pipeline stages running as background jobs.
 */
const RENDERS_BUCKET = "content-engine-renders";

function getStorageClient() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export interface UploadRenderAssetOptions {
  path: string;
  data: Buffer;
  contentType: string;
}

/**
 * Uploads a render artifact (narration audio, eventually assembled video)
 * to the renders bucket and returns its public URL.
 *
 * Overwrites any existing object at `path` (`upsert: true`) — every render
 * stage is expected to be re-runnable on the same script/video id without
 * accumulating stale objects.
 */
export async function uploadRenderAsset(options: UploadRenderAssetOptions): Promise<string> {
  const supabase = getStorageClient();

  const { error } = await supabase.storage.from(RENDERS_BUCKET).upload(options.path, options.data, {
    contentType: options.contentType,
    upsert: true,
  });

  if (error) {
    throw new Error(`Failed to upload render asset to ${options.path}: ${error.message}`);
  }

  const { data } = supabase.storage.from(RENDERS_BUCKET).getPublicUrl(options.path);
  return data.publicUrl;
}
