import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCognitoRefreshClient, decodeJwtPayload } from "./index.js";
import { AuthExpired } from "@mcp-stack/mcp-core";

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const body = btoa(JSON.stringify(payload))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${header}.${body}.signature`;
}

describe("decodeJwtPayload", () => {
  it("decodes claims without verifying", () => {
    const token = buildJwt({ "cognito:username": "abc-123", exp: 9999999999 });
    const claims = decodeJwtPayload(token);
    expect(claims["cognito:username"]).toBe("abc-123");
  });

  it("throws on a malformed token", () => {
    expect(() => decodeJwtPayload("not-a-jwt")).toThrow();
  });
});

describe("createCognitoRefreshClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls InitiateAuth and returns the ID token + username", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const idToken = buildJwt({ "cognito:username": "user-uuid", exp: futureExp });
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          AuthenticationResult: {
            IdToken: idToken,
            AccessToken: "access-tok",
            ExpiresIn: 3600,
          },
        }),
        { status: 200 },
      ),
    );

    const client = createCognitoRefreshClient({
      clientId: "abc",
      region: "us-east-1",
      refreshToken: "rt",
      deviceKey: "dk",
    });

    expect(await client.getIdToken()).toBe(idToken);
    expect(await client.getUsername()).toBe("user-uuid");
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      AuthFlow: string;
      AuthParameters: Record<string, string>;
    };
    expect(body.AuthFlow).toBe("REFRESH_TOKEN_AUTH");
    expect(body.AuthParameters["REFRESH_TOKEN"]).toBe("rt");
    expect(body.AuthParameters["DEVICE_KEY"]).toBe("dk");
  });

  it("throws AuthExpired when Cognito returns NotAuthorizedException", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(
      new Response('{"__type":"NotAuthorizedException","message":"Refresh Token has expired"}', {
        status: 400,
      }),
    );

    const client = createCognitoRefreshClient({
      clientId: "abc",
      region: "us-east-1",
      refreshToken: "stale",
    });

    await expect(client.getIdToken()).rejects.toBeInstanceOf(AuthExpired);
  });

  it("caches the token across calls", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const idToken = buildJwt({ "cognito:username": "user-uuid", exp: futureExp });
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          AuthenticationResult: { IdToken: idToken, AccessToken: "at", ExpiresIn: 3600 },
        }),
        { status: 200 },
      ),
    );

    const client = createCognitoRefreshClient({
      clientId: "abc",
      region: "us-east-1",
      refreshToken: "rt",
    });

    await client.getIdToken();
    await client.getIdToken();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
