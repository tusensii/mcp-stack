#!/usr/bin/env tsx
/**
 * One-shot Google OAuth flow to capture a refresh token for the OTF
 * Worker's calendar integration. Run on a developer machine.
 *
 * What it does:
 *   1. Prints a URL to Google's consent screen, scoped to
 *      `calendar.events` (narrower than `calendar` — cannot read or
 *      modify ACLs, settings, or other calendars' metadata).
 *   2. Spins up a local HTTP listener for the OAuth redirect.
 *   3. Captures the auth code, exchanges for a refresh token.
 *   4. Prints the refresh token + the wrangler commands to set the
 *      Worker secrets. NEVER writes credentials to disk.
 *
 * Usage:
 *   pnpm --filter otf-mcp run google-auth -- \
 *     --client-id=<id from Google Cloud Console> \
 *     --client-secret=<secret> \
 *     [--port=9876]
 */

import { OAuth2Client } from "google-auth-library";
import http from "node:http";
import { exec } from "node:child_process";
import { parseArgs } from "node:util";

const SCOPE = "https://www.googleapis.com/auth/calendar.events";

const { values } = parseArgs({
  options: {
    "client-id": { type: "string" },
    "client-secret": { type: "string" },
    port: { type: "string", default: "9876" },
  },
});

const clientId = values["client-id"];
const clientSecret = values["client-secret"];
if (!clientId || !clientSecret) {
  console.error(
    "Usage: pnpm --filter otf-mcp run google-auth -- " +
      "--client-id=<id> --client-secret=<secret> [--port=9876]",
  );
  process.exit(1);
}

const port = Number.parseInt(values.port ?? "9876", 10);
const redirectUri = `http://localhost:${port}/callback`;

const client = new OAuth2Client(clientId, clientSecret, redirectUri);
const authUrl = client.generateAuthUrl({
  access_type: "offline",
  scope: [SCOPE],
  prompt: "consent",
});

console.log(`Opening browser to authorize...`);
console.log(`If the browser doesn't open, visit:\n  ${authUrl}\n`);

const opener =
  process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
exec(`${opener} "${authUrl}"`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error) {
    res
      .writeHead(400, { "Content-Type": "text/plain" })
      .end(`OAuth error: ${error}\nYou can close this tab.`);
    console.error(`OAuth error: ${error}`);
    process.exit(1);
  }
  if (!code) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end("Missing ?code");
    return;
  }

  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error(
        "No refresh_token in response. Try revoking the app at " +
          "https://myaccount.google.com/permissions and re-running.",
      );
    }
    res
      .writeHead(200, { "Content-Type": "text/html" })
      .end(
        "<html><body><h1>Done — you can close this tab.</h1>" +
          "<p>Return to the terminal for the next steps.</p></body></html>",
      );

    console.log("\nRefresh token captured.\n");
    console.log("Set the following Worker secrets (run each, paste the listed value):\n");
    console.log("  pnpm --filter otf-mcp exec wrangler secret put GOOGLE_OAUTH_CLIENT_ID");
    console.log(`    paste: ${clientId}\n`);
    console.log("  pnpm --filter otf-mcp exec wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET");
    console.log(`    paste: ${clientSecret}\n`);
    console.log("  pnpm --filter otf-mcp exec wrangler secret put GOOGLE_OAUTH_REFRESH_TOKEN");
    console.log(`    paste: ${tokens.refresh_token}\n`);
    console.log("  pnpm --filter otf-mcp exec wrangler secret put GOOGLE_CALENDAR_ID");
    console.log(`    paste: primary  (or your calendar email if it is not 'primary')\n`);
    console.log("After all four are set, redeploy with: pnpm --filter otf-mcp run deploy");

    server.close();
    setTimeout(() => process.exit(0), 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.writeHead(500, { "Content-Type": "text/plain" }).end(`Token exchange failed: ${msg}`);
    console.error(`Token exchange failed: ${msg}`);
    process.exit(1);
  }
});

server.listen(port, () => {
  console.log(`Listening on http://localhost:${port}/callback`);
});
