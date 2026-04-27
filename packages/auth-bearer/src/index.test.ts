import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bearerHeader, createBearerClient } from "./index.js";

describe("bearerHeader", () => {
  it("defaults to 'Authorization: Bearer <token>'", () => {
    expect(bearerHeader({ token: "abc" })).toEqual({ Authorization: "Bearer abc" });
  });

  it("supports custom header names", () => {
    expect(bearerHeader({ token: "k", header: "X-Api-Key", scheme: "" })).toEqual({
      "X-Api-Key": "k",
    });
  });

  it("rejects empty tokens", () => {
    expect(() => bearerHeader({ token: "" })).toThrow(/token is required/);
  });
});

describe("createBearerClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the bearer header on every request", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const client = createBearerClient({ token: "PAT", baseUrl: "https://api.example.com" });
    await client.json("/v1/me");
    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("Authorization")).toBe("Bearer PAT");
  });
});
