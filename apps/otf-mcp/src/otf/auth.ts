import { createCognitoRefreshClient, type CognitoClient } from "@mcp-stack/auth-cognito";

// Cognito constants — sourced from otf_api/auth/auth.py lines 33-37
const COGNITO_CLIENT_ID = "1457d19r0pcjgmp5agooi0rb1b"; // from android app
const COGNITO_REGION = "us-east-1";

// Late-cancel window — OTF published policy, NOT from API response.
// Update this constant if OTF changes their cancellation terms.
export const LATE_CANCEL_WINDOW_HOURS = 8;

export interface AuthEnv {
  OTF_REFRESH_TOKEN: string;
  OTF_DEVICE_KEY: string;
}

// Per-isolate cache: one Cognito client per refresh-token. The client itself
// memoizes the most recent ID token until ~60s before its `exp` claim, matching
// the previous in-instance cache behavior.
let cachedClient: CognitoClient | null = null;
let cachedClientKey: string | null = null;

function getClient(env: AuthEnv): CognitoClient {
  // Key on the refresh token so a secret rotation invalidates the cache.
  const key = `${env.OTF_REFRESH_TOKEN}|${env.OTF_DEVICE_KEY}`;
  if (cachedClient && cachedClientKey === key) return cachedClient;
  cachedClient = createCognitoRefreshClient({
    clientId: COGNITO_CLIENT_ID,
    region: COGNITO_REGION,
    refreshToken: env.OTF_REFRESH_TOKEN,
    deviceKey: env.OTF_DEVICE_KEY,
  });
  cachedClientKey = key;
  return cachedClient;
}

/**
 * Returns a non-expired Cognito ID token plus the `cognito:username` claim
 * (which is the OTF member UUID). Backwards-compatible signature with the
 * original inline implementation — `client.ts` and `member_info.ts` rely on it.
 */
export async function getIdToken(env: AuthEnv): Promise<{ idToken: string; memberUuid: string }> {
  const client = getClient(env);
  const [idToken, memberUuid] = await Promise.all([
    client.getIdToken(),
    client.getUsername(),
  ]);
  return { idToken, memberUuid };
}
