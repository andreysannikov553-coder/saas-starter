import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { AuthenticationError } from "@/lib/utils/error";
import { getEntitlements } from "@/lib/billing/entitlements";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";

/**
 * Get the current authenticated user
 * Cached per request for performance
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Get the current session
 */
export async function getSession() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

/**
 * Require authentication - throws if not authenticated
 */
export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthenticationError();
  }
  return user;
}

/**
 * Make sure the signed-in Supabase identity has a matching `users` row.
 *
 * Supabase Auth is the source of truth for identity; this table holds the
 * profile and the relations hanging off it. Creating the row at sign-up time
 * meant two writes to two systems with no transaction between them, so a
 * failure on the second left an account that could sign in but had no profile
 * — permanently, since sign-up never ran again for that user.
 *
 * Doing it here instead makes it a reconciliation step: idempotent, and it
 * repairs a missing row on the next request rather than failing forever.
 */
export const ensureUserRecord = cache(async (): Promise<string | null> => {
  const user = await getCurrentUser();
  if (!user?.email) return null;

  const name = typeof user.user_metadata?.name === "string" ? user.user_metadata.name : undefined;
  const avatarUrl =
    typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : undefined;

  await prisma.user.upsert({
    where: { id: user.id },
    create: {
      id: user.id,
      email: user.email,
      name,
      avatarUrl,
    },
    // Email is authoritative in Supabase, so keep it in sync. Name and avatar
    // are editable in settings, so an existing row keeps whatever it has.
    update: { email: user.email },
  });

  return user.id;
});

/**
 * The authenticated user's id, with their `users` row guaranteed to exist.
 */
export async function requireUserId(): Promise<string> {
  const user = await requireAuth();
  await ensureUserRecord();
  return user.id;
}

/**
 * Check if user has an active (paid) subscription.
 *
 * Delegates to `getEntitlements`, which is also what decides usage limits —
 * previously this checked status alone while limits were computed
 * separately, so the two could disagree about who was actually paying.
 */
export async function hasActiveSubscription(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;

  const entitlements = await getEntitlements(user.id);
  return entitlements.plan !== "free";
}
