/**
 * AWS Cognito refresh-token client. Designed for the case where SRP
 * authentication is performed once out-of-band (in a bootstrap script
 * outside the Worker) and the resulting `RefreshToken` + `DeviceKey`
 * are stored as Worker secrets. The Worker only ever calls
 * `InitiateAuth` with `REFRESH_TOKEN_AUTH` to mint short-lived ID/access
 * tokens.
 *
 * Why not SRP in the package? SRP requires Node-only crypto (and the
 * `amazon-cognito-identity-js` library) which doesn't run in the
 * Workers runtime. Bootstrapping happens once per device on a developer
 * machine; the resulting refresh token is long-lived enough that
 * re-bootstrapping is rare.
 */

import { AuthExpired } from "@mcp-stack/mcp-core";

export interface CognitoRefreshOptions {
  /** Cognito App Client ID (e.g. from `aws cognito-idp describe-user-pool-client`). */
  clientId: string;
  /** AWS region where the user pool lives, e.g. `"us-east-1"`. */
  region: string;
  /** Long-lived refresh token captured during SRP bootstrap. */
  refreshToken: string;
  /**
   * Device key paired with the refresh token. Required when the user pool
   * has device-tracking enabled (most consumer apps).
   */
  deviceKey?: string;
  /**
   * Number of seconds before `exp` to consider the cached token stale.
   * Default 60.
   */
  expiryBufferSeconds?: number;
}

export interface CognitoTokenSet {
  idToken: string;
  accessToken: string;
  /** Unix epoch seconds at which the cached token will be re-fetched. */
  expiresAt: number;
}

export interface CognitoClient {
  /** Get a non-expired ID token, refreshing in the background if needed. */
  getIdToken(): Promise<string>;
  /** Get a non-expired access token, refreshing if needed. */
  getAccessToken(): Promise<string>;
  /**
   * The `cognito:username` claim from the current ID token. Returns
   * null until at least one token has been minted.
   */
  getUsername(): Promise<string>;
  /** Drop the cached token; the next call mints a fresh one. */
  invalidate(): void;
}

/**
 * Build a Cognito refresh-token client. Tokens are cached in-instance
 * until `expiryBufferSeconds` before their `exp` claim.
 */
export function createCognitoRefreshClient(options: CognitoRefreshOptions): CognitoClient {
  const {
    clientId,
    region,
    refreshToken,
    deviceKey,
    expiryBufferSeconds = 60,
  } = options;
  const endpoint = `https://cognito-idp.${region}.amazonaws.com/`;

  let cached: CognitoTokenSet | null = null;

  async function refresh(): Promise<CognitoTokenSet> {
    const authParameters: Record<string, string> = { REFRESH_TOKEN: refreshToken };
    if (deviceKey) authParameters["DEVICE_KEY"] = deviceKey;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: clientId,
        AuthParameters: authParameters,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 400 && /NotAuthorizedException/i.test(body)) {
        throw new AuthExpired(
          "Cognito refresh token rejected — re-run the SRP bootstrap to capture a new token.",
        );
      }
      throw new Error(`Cognito InitiateAuth failed: HTTP ${res.status} ${body}`);
    }

    const data = (await res.json()) as {
      AuthenticationResult?: {
        IdToken?: string;
        AccessToken?: string;
        ExpiresIn?: number;
      };
    };
    const result = data.AuthenticationResult;
    if (!result?.IdToken || !result.AccessToken) {
      throw new Error("Cognito InitiateAuth returned no tokens");
    }

    const claims = decodeJwtPayload(result.IdToken);
    const exp = typeof claims["exp"] === "number" ? (claims["exp"] as number) : null;
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAt = exp
      ? exp - expiryBufferSeconds
      : nowSec + (result.ExpiresIn ?? 3600) - expiryBufferSeconds;

    cached = {
      idToken: result.IdToken,
      accessToken: result.AccessToken,
      expiresAt,
    };
    return cached;
  }

  async function ensureFresh(): Promise<CognitoTokenSet> {
    const nowSec = Math.floor(Date.now() / 1000);
    if (cached && cached.expiresAt > nowSec) return cached;
    return refresh();
  }

  return {
    async getIdToken() {
      return (await ensureFresh()).idToken;
    },
    async getAccessToken() {
      return (await ensureFresh()).accessToken;
    },
    async getUsername() {
      const tokens = await ensureFresh();
      const claims = decodeJwtPayload(tokens.idToken);
      const u = claims["cognito:username"];
      if (typeof u !== "string") {
        throw new Error("ID token missing cognito:username claim");
      }
      return u;
    },
    invalidate() {
      cached = null;
    },
  };
}

/**
 * Decode the payload of a JWT. Does NOT verify the signature — Cognito's
 * tokens are minted server-side and we received them over TLS, so we
 * trust them for the purpose of reading the `exp` and `cognito:username`
 * claims. If you need verification, do it elsewhere with the JWKS.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  const payload = parts[1];
  if (!payload) throw new Error("JWT missing payload");
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const json = atob(b64);
  return JSON.parse(json) as Record<string, unknown>;
}
