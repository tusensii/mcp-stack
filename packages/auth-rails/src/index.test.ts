import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractFormToken,
  extractMetaCsrf,
  createRailsAuthClient,
  InvalidCredentials,
  CsrfMismatch,
} from "./index.js";

describe("extractFormToken", () => {
  it("finds token when name precedes value", () => {
    const html = `<input type="hidden" name="authenticity_token" value="abc123==" />`;
    expect(extractFormToken(html)).toBe("abc123==");
  });

  it("finds token when value precedes name (Rails sometimes reorders)", () => {
    const html = `<input type="hidden" value="xyz789==" name="authenticity_token" />`;
    expect(extractFormToken(html)).toBe("xyz789==");
  });

  it("returns null when absent", () => {
    expect(extractFormToken("<form></form>")).toBeNull();
  });
});

describe("extractMetaCsrf", () => {
  it("finds the meta csrf-token", () => {
    const html = `<head><meta name="csrf-token" content="meta-tok-123" /></head>`;
    expect(extractMetaCsrf(html)).toBe("meta-tok-123");
  });

  it("does not match the form token (input element)", () => {
    const html = `<input name="authenticity_token" value="form-tok" />`;
    expect(extractMetaCsrf(html)).toBeNull();
  });
});

describe("createRailsAuthClient login flow", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("performs the GET → POST → GET handshake and applies X-CSRF-Token", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(`<input name="authenticity_token" value="form-tok" />`, { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "/", "Set-Cookie": "session=abc" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(`<meta name="csrf-token" content="xhr-tok" />`, { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));

    const client = createRailsAuthClient({
      baseUrl: "https://app.example.com",
      email: "u@example.com",
      password: "secret",
      loginPath: "/users/sign_in",
      postLoginPath: "/dashboard",
      resource: "user",
    });

    const data = await client.json<{ ok: boolean }>("/api/me");
    expect(data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const apiInit = fetchMock.mock.calls[3]?.[1];
    const apiHeaders = new Headers((apiInit as RequestInit).headers);
    expect(apiHeaders.get("X-CSRF-Token")).toBe("xhr-tok");
  });

  it("throws CsrfMismatch when login POST returns the form with InvalidAuthenticityToken", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(`<input name="authenticity_token" value="form-tok" />`, { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response("Invalid authenticity token", { status: 200 }),
      );

    const client = createRailsAuthClient({
      baseUrl: "https://app.example.com",
      email: "u@example.com",
      password: "secret",
      loginPath: "/users/sign_in",
    });

    await expect(client.fetch("/api/me")).rejects.toBeInstanceOf(CsrfMismatch);
  });

  it("throws InvalidCredentials when the login form rejects creds", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(`<input name="authenticity_token" value="form-tok" />`, { status: 200 }),
      )
      .mockResolvedValueOnce(new Response("Invalid email or password", { status: 200 }));

    const client = createRailsAuthClient({
      baseUrl: "https://app.example.com",
      email: "u@example.com",
      password: "wrong",
      loginPath: "/users/sign_in",
    });

    await expect(client.fetch("/api/me")).rejects.toBeInstanceOf(InvalidCredentials);
  });
});
