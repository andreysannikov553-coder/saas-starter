import type { NextConfig } from "next";

/**
 * Sent on every response. These are cheap, and their absence is the default —
 * a browser applies none of them unless told to.
 */
const securityHeaders = [
  // Browsers must not sniff a response into a different type than we declared.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // No framing: this app has no embeddable surface, so clickjacking has no
  // legitimate use case here.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here uses the camera, microphone or geolocation.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  // Two years, subdomains included. Only honoured over HTTPS, so this is inert
  // in local development.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },

  images: {
    // `User.avatarUrl` accepts an arbitrary URL, so the optimizer is restricted
    // to hosts we expect rather than left open as a fetch-anything proxy.
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
