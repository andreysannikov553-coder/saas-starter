/**
 * One-time OAuth flow to mint a refresh token for the YouTube Data API v3
 * "Desktop app" OAuth client created in Google Cloud Console. Starts a local
 * HTTP server to catch the redirect (loopback flow — the client type Google
 * uses for CLI/desktop apps, no need to pre-register the exact port).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/youtube-oauth.ts
 *
 * Prints the refresh token — add it to .env.local as YOUTUBE_REFRESH_TOKEN.
 */
import http from "node:http";

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}`;
const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET in .env.local");
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.upload");
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

console.log("Open this URL and grant access:\n");
console.log(authUrl.toString());
console.log("\nWaiting for redirect on", REDIRECT_URI, "...");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", REDIRECT_URI);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h1>Ошибка: ${error}</h1>`);
    console.error("OAuth error:", error);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>Ждём код...</h1>");
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<h1>Готово, можно закрыть вкладку.</h1>");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const tokenJson = await tokenResponse.json();

  if (!tokenResponse.ok) {
    console.error("Token exchange failed:", tokenJson);
    server.close();
    process.exit(1);
  }

  console.log("\nAccess token:", tokenJson.access_token);
  console.log("Refresh token:", tokenJson.refresh_token);
  console.log("\nAdd to .env.local:");
  console.log(`YOUTUBE_REFRESH_TOKEN="${tokenJson.refresh_token}"`);

  server.close();
  process.exit(0);
});

server.listen(PORT);
