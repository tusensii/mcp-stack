import { describe, it, expect } from "vitest";
import { buildGoogleOAuthClient } from "./index.js";
import { AuthExpired } from "@mcp-stack/mcp-core";

const KEYS = {
  installed: {
    client_id: "id-123",
    client_secret: "sec-abc",
  },
};
const CREDS = {
  access_token: "at",
  refresh_token: "rt",
  expiry_date: Date.now() + 3600_000,
};

describe("buildGoogleOAuthClient", () => {
  it("accepts parsed keys + credentials", () => {
    const client = buildGoogleOAuthClient({ keys: KEYS, credentials: CREDS });
    expect(client.credentials.refresh_token).toBe("rt");
  });

  it("accepts raw JSON strings (env-secret use case)", () => {
    const client = buildGoogleOAuthClient({
      keys: JSON.stringify(KEYS),
      credentials: JSON.stringify(CREDS),
    });
    expect(client.credentials.refresh_token).toBe("rt");
  });

  it("accepts the bare keys object too (no web/installed wrapper)", () => {
    const client = buildGoogleOAuthClient({
      keys: { client_id: "id", client_secret: "sec" },
      credentials: CREDS,
    });
    expect(client).toBeDefined();
  });

  it("throws AuthExpired when refresh_token is missing", () => {
    expect(() =>
      buildGoogleOAuthClient({
        keys: KEYS,
        credentials: { access_token: "at" } as never,
      }),
    ).toThrow(AuthExpired);
  });

  it("throws AuthExpired on malformed JSON", () => {
    expect(() =>
      buildGoogleOAuthClient({ keys: "{not json", credentials: CREDS }),
    ).toThrow(AuthExpired);
  });

  it("throws AuthExpired when keys have neither web nor installed", () => {
    expect(() =>
      buildGoogleOAuthClient({
        keys: {} as never,
        credentials: CREDS,
      }),
    ).toThrow(AuthExpired);
  });
});
