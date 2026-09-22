import { createClient } from "@supabase/supabase-js";
import { env } from "@/env.mjs";

/**
 * Service-role client — bypasses RLS and can manage Auth users. Never expose
 * this to the browser and never build it from anything but the service role
 * key; it exists only for the handful of server-side operations that need
 * Auth-admin access (currently: deleting a user).
 */
export function createAdminClient() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
