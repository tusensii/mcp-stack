import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFetchClient, CookieJar, HttpError, RateLimitError, TimeoutError } from "./index.js";

describe("CookieJar", () => {
  it("parses cookies from a Set-Cookie header and serializes back", () => {
    const jar = new CookieJar();
    const headers = new Headers();
    headers.append("Set-Cookie", "session=abc; Path=/; HttpOnly");
    headers.append("Set-Cookie", "csrf=xyz; Secure");
    jar.setFromResponse(headers);
    expect(jar.size).toBe(2);
    expect(jar.toHeader()).toContain("session=abc");
    expect(jar.toHeader()).toContain("csrf=xyz");
  });

  it("overwrites by name when the same cookie reappears", () => {
    const jar = new CookieJar();
    const first = new Headers();
    first.append("Set-Cookie", "session=old");
    jar.setFromResponse(first);
    const second = new Headers();
    second.append("Set-Cookie", "session=new");
    jar.setFromResponse(second);
    expect(jar.size).toBe(1);
    expect(jar.toHeader()).toBe("session=new");
  });
});

describe("createFetchClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("injects User-Agent and Cookie headers and parses JSON", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

    const client = createFetchClient({ baseUrl: "https://api.example.com", userAgent: "mcp-stack-test/1.0" });
    const data = await client.json<{ ok: boolean }>("/v1/ping");

    expect(data.ok).toBe(true);
    const [calledUrl, init] = fetchMock.mock.calls[0] ?? [];
    expect(calledUrl).toBe("https://api.example.com/v1/ping");
    const sent = new Headers((init as RequestInit).headers);
    expect(sent.get("User-Agent")).toBe("mcp-stack-test/1.0");
  });

  it("throws HttpError on non-2xx with the body attached", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(new Response("nope", { status: 404, statusText: "Not Found" }));
    const client = createFetchClient();
    await expect(client.json("https://example.com/missing")).rejects.toMatchObject({
      name: "HttpError",
      status: 404,
      body: "nope",
    });
    expect(HttpError).toBeDefined();
  });

  it("retries 5xx and succeeds on second attempt", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(new Response("err", { status: 503 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const client = createFetchClient({ retries: 1, retryBaseMs: 1 });
    const data = await client.json<{ ok: boolean }>("https://example.com/r");
    expect(data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws RateLimitError on 429 with parsed Retry-After", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(
      new Response("slow down", { status: 429, headers: { "Retry-After": "12" } }),
    );
    const client = createFetchClient({ retries: 0 });
    await expect(client.fetch("https://example.com/limited")).rejects.toMatchObject({
      name: "RateLimitError",
      retryAfterSeconds: 12,
    });
    expect(RateLimitError).toBeDefined();
  });

  it("throws TimeoutError when fetch is aborted by the timeout", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const client = createFetchClient({ timeoutMs: 5, retries: 0 });
    await expect(client.fetch("https://example.com/slow")).rejects.toMatchObject({
      name: "TimeoutError",
      timeoutMs: 5,
    });
    expect(TimeoutError).toBeDefined();
  });
});
