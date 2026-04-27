/**
 * Google OAuth 2.0 client builder. Wraps `OAuth2Client` from
 * `google-auth-library` with refresh-token credentials, so apps can
 * import `google.gmail()` / `google.calendar()` from `googleapis`
 * and pass the configured auth straight in.
 *
 * Refresh handling is delegated to the library — it auto-refreshes
 * the access token on 401 using the refresh token. The package's
 * value is normalizing how secrets are shaped (raw JSON or parsed
 * objects), and translating common failure modes into `AuthExpired`.
 */

import { OAuth2Client } from "google-auth-library";
import { AuthExpired } from "@mcp-stack/mcp-core";

export interface GoogleOAuthKeys {
  client_id: string;
  client_secret: string;
  /** Optional; omitted in installed-app flows. */
  redirect_uris?: string[];
}

/**
 * Shape produced by Google Cloud Console's "Download JSON" — the keys
 * live under either `web` or `installed` depending on the OAuth client
 * type. Pass the whole object and the package picks the right one.
 */
export interface GoogleOAuthKeysFile {
  web?: GoogleOAuthKeys;
  installed?: GoogleOAuthKeys;
}

export interface GoogleOAuthCredentials {
  access_token?: string;
  refresh_token: string;
  /** Unix epoch milliseconds. */
  expiry_date?: number;
  token_type?: string;
  scope?: string;
}

export interface GoogleOAuthClientOptions {
  /** Either a parsed keys file/keys object, or the raw JSON string. */
  keys: GoogleOAuthKeysFile | GoogleOAuthKeys | string;
  /** Either parsed credentials, or the raw JSON string. */
  credentials: GoogleOAuthCredentials | string;
}

/**
 * Construct a configured `OAuth2Client`. The returned client has the
 * refresh token set, so Google API calls will auto-refresh the access
 * token on first use (or when it expires).
 *
 * Throws `AuthExpired` if the keys/credentials are malformed in a way
 * that suggests the operator must re-run the auth flow.
 */
export function buildGoogleOAuthClient(options: GoogleOAuthClientOptions): OAuth2Client {
  const keysObj = parseJsonIfString<GoogleOAuthKeysFile | GoogleOAuthKeys>(
    options.keys,
    "GoogleOAuth keys",
  );
  const keys = pickKeys(keysObj);
  if (!keys.client_id || !keys.client_secret) {
    throw new AuthExpired(
      "Google OAuth keys missing client_id/client_secret — re-download the OAuth client JSON.",
    );
  }

  const credentials = parseJsonIfString<GoogleOAuthCredentials>(
    options.credentials,
    "GoogleOAuth credentials",
  );
  if (!credentials.refresh_token) {
    throw new AuthExpired(
      "Google OAuth credentials missing refresh_token — re-run the auth flow to capture one.",
    );
  }

  const client = new OAuth2Client(keys.client_id, keys.client_secret);
  client.setCredentials(credentials);
  return client;
}

function pickKeys(value: GoogleOAuthKeysFile | GoogleOAuthKeys): GoogleOAuthKeys {
  if ("client_id" in value && "client_secret" in value) {
    return value;
  }
  const file = value;
  const inner = file.web ?? file.installed;
  if (!inner) {
    throw new AuthExpired(
      'Google OAuth keys file has no "web" or "installed" section.',
    );
  }
  return inner;
}

function parseJsonIfString<T>(value: T | string, label: string): T {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new AuthExpired(`Invalid ${label} JSON: ${msg}`);
  }
}

export { OAuth2Client };
