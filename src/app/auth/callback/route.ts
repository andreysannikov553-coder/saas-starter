import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureUserRecord } from "@/lib/auth";
import { logger } from "@/lib/utils/logger";
import { AFTER_LOGIN_ROUTE } from "@/lib/routes";

/**
 * Exchange the code from a Supabase email link for a session.
 *
 * Email confirmation and password reset links both land here. Without this
 * route neither flow can complete: the user clicks the link and arrives at a
 * page with no session.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  // Only same-origin paths, so a crafted link cannot bounce the user off-site
  // with a fresh session in hand.
  const destination =
    next && next.startsWith("/") && !next.startsWith("//") ? next : AFTER_LOGIN_ROUTE;

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    logger.warn("Auth callback failed to exchange code", error.message);
    return NextResponse.redirect(`${origin}/login?error=invalid_link`);
  }

  await ensureUserRecord();

  return NextResponse.redirect(`${origin}${destination}`);
}
