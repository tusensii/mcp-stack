import { google, type gmail_v1 } from "googleapis";
import { buildGoogleOAuthClient } from "@mcp-stack/auth-oauth-google";
import type { Env } from "./types.js";

/**
 * Build a Gmail API client. The OAuth refresh-token flow is delegated
 * to `buildGoogleOAuthClient` from `@mcp-stack/auth-oauth-google`,
 * which validates `GMAIL_OAUTH_KEYS` and `GMAIL_CREDENTIALS` env shapes
 * and returns a configured `OAuth2Client`. The googleapis library
 * auto-refreshes the access token on 401.
 */
export function buildGmailClient(env: Env): gmail_v1.Gmail {
  const auth = buildGoogleOAuthClient({
    keys: env.GMAIL_OAUTH_KEYS,
    credentials: env.GMAIL_CREDENTIALS,
  });
  return google.gmail({ version: "v1", auth });
}
