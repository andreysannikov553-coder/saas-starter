/**
 * Route access policy, shared by the proxy and by server-side guards.
 *
 * The proxy runs on every request, so this is the single place that decides
 * what an anonymous visitor may reach. Everything not listed here requires a
 * session.
 */

/** Reachable without a session. Exact matches only. */
const PUBLIC_ROUTES = new Set<string>([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/pricing",
]);

/**
 * Reachable without a session, together with everything below them.
 *
 * `/auth` carries the Supabase callback, which by definition runs before a
 * session exists. `/api/webhooks` is called by payment providers, which
 * present a signature rather than a cookie and do not follow redirects — a
 * redirect here silently breaks billing.
 */
const PUBLIC_PREFIXES = ["/auth/", "/api/webhooks/"] as const;

export function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Where to send a signed-in user who lands on a signed-out-only page. */
export const AFTER_LOGIN_ROUTE = "/dashboard";

/** Where to send an anonymous visitor who asks for a protected page. */
export const LOGIN_ROUTE = "/login";
