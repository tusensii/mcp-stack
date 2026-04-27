/**
 * Fetch wrapper with the patterns every MCP needs:
 * a per-instance cookie jar, retries on 5xx, per-call timeout,
 * `Retry-After`-aware rate-limit detection, and User-Agent injection.
 *
 * The cookie jar lives on the client instance (not module-global) so
 * concurrent requests across users can never cross-contaminate.
 */

export class HttpError extends Error {
  override readonly name = "HttpError";
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: string,
  ) {
    super(message);
  }
}

export class TimeoutError extends Error {
  override readonly name = "TimeoutError";
  constructor(public readonly timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
  }
}

export class RateLimitError extends Error {
  override readonly name = "RateLimitError";
  constructor(public readonly retryAfterSeconds?: number) {
    super(
      retryAfterSeconds === undefined
        ? "Rate limited"
        : `Rate limited; retry after ${retryAfterSeconds}s`,
    );
  }
}

/**
 * Per-instance cookie jar. Stores cookies as a name → value map and
 * serializes to a single `Cookie` header. Supports both Workers'
 * `Headers.getAll()` extension and Node's `Headers.getSetCookie()`.
 */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  /** Read all `Set-Cookie` headers from a response and store them. */
  setFromResponse(headers: Headers): void {
    for (const raw of getSetCookieHeaders(headers)) {
      const head = raw.split(";")[0]?.trim();
      if (!head) continue;
      const eq = head.indexOf("=");
      if (eq < 0) continue;
      const name = head.slice(0, eq).trim();
      const value = head.slice(eq + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  /** Serialize to a `Cookie` header value, or empty string if no cookies. */
  toHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  /** Drop all cookies — e.g. before a re-auth attempt. */
  clear(): void {
    this.cookies.clear();
  }

  /** Number of stored cookies. */
  get size(): number {
    return this.cookies.size;
  }
}

function getSetCookieHeaders(headers: Headers): string[] {
  const node = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof node === "function") return node.call(headers);
  const cf = (headers as unknown as { getAll?: (name: string) => string[] }).getAll;
  if (typeof cf === "function") return cf.call(headers, "set-cookie");
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

export interface FetchClientOptions {
  /** Prepended to non-absolute URLs. */
  baseUrl?: string;
  /** Sent as `User-Agent` on every request. */
  userAgent?: string;
  /** Merged onto every request, before per-call headers. */
  defaultHeaders?: Record<string, string>;
  /** Per-call timeout. Default 30s. */
  timeoutMs?: number;
  /** Retry attempts for transient failures. Default 1 (i.e. 2 total attempts). */
  retries?: number;
  /** Base delay for exponential backoff in ms. Default 500. */
  retryBaseMs?: number;
  /**
   * Predicate over status codes deciding whether to retry. Default: 5xx.
   * Network errors are always retried up to `retries`.
   */
  retryOn?: (status: number) => boolean;
}

export interface FetchClient {
  /** Raw fetch with cookie/UA/header/timeout/retry applied. */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** Convenience: fetch and parse JSON; throws `HttpError` on non-2xx. */
  json<T>(url: string, init?: RequestInit): Promise<T>;
  /** The client's cookie jar. */
  readonly jar: CookieJar;
}

/**
 * Build a fetch client. Each call returns an isolated client with its
 * own cookie jar — never share clients across user sessions.
 */
export function createFetchClient(options: FetchClientOptions = {}): FetchClient {
  const {
    baseUrl,
    userAgent,
    defaultHeaders = {},
    timeoutMs = 30_000,
    retries = 1,
    retryBaseMs = 500,
    retryOn = (s) => s >= 500 && s < 600,
  } = options;

  const jar = new CookieJar();

  async function rawFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const target = resolveUrl(url, baseUrl);

    const headers = new Headers(defaultHeaders);
    if (userAgent) headers.set("User-Agent", userAgent);
    const cookieHeader = jar.toHeader();
    if (cookieHeader) headers.set("Cookie", cookieHeader);
    if (init.headers) {
      const incoming = new Headers(init.headers);
      incoming.forEach((v, k) => headers.set(k, v));
    }

    let attempt = 0;
    let lastErr: unknown;
    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(target, { ...init, headers, signal: controller.signal });
        clearTimeout(timer);
        jar.setFromResponse(res.headers);

        if (res.status === 429) {
          const ra = res.headers.get("Retry-After");
          throw new RateLimitError(ra ? Number.parseInt(ra, 10) || undefined : undefined);
        }
        if (retryOn(res.status) && attempt < retries) {
          attempt++;
          await sleep(retryBaseMs * 2 ** (attempt - 1));
          continue;
        }
        return res;
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof RateLimitError) throw e;
        if (isAbortError(e)) throw new TimeoutError(timeoutMs);
        if (attempt >= retries) throw lastErr ?? e;
        attempt++;
        lastErr = e;
        await sleep(retryBaseMs * 2 ** (attempt - 1));
      }
    }
  }

  async function json<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await rawFetch(url, init);
    if (!res.ok) {
      let body: string | undefined;
      try {
        body = await res.text();
      } catch {
        body = undefined;
      }
      throw new HttpError(res.status, `HTTP ${res.status} ${res.statusText}`, body);
    }
    return (await res.json()) as T;
  }

  return { fetch: rawFetch, json, jar };
}

function resolveUrl(url: string, baseUrl?: string): string {
  if (!baseUrl) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url, baseUrl).toString();
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.message.includes("aborted"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
