import { createBearerClient } from "@mcp-stack/auth-bearer";
import { HttpError, RateLimitError, type FetchClient } from "@mcp-stack/http-fetch";

const GITHUB_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";
const USER_AGENT = "mcp-stack-github-mcp/0.1";

export class GitHubApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly retryAfter?: string,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export class GitHubClient {
  private readonly http: FetchClient;

  constructor(token: string) {
    this.http = createBearerClient({
      token,
      baseUrl: GITHUB_BASE,
      userAgent: USER_AGENT,
      defaultHeaders: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
      },
    });
  }

  async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${GITHUB_BASE}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    return this.request<T>("GET", url.toString().slice(GITHUB_BASE.length));
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("DELETE", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { "Content-Type": "application/json" };
    }

    try {
      const res = await this.http.fetch(path, init);
      if (res.status === 204) return undefined as T;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw mapHttpError(res.status, text, res.headers.get("Retry-After") ?? undefined);
      }
      return (await res.json()) as T;
    } catch (e) {
      throw mapClientError(e);
    }
  }
}

function mapHttpError(status: number, body: string, retryAfter?: string): GitHubApiError {
  let detail: string | undefined;
  if (body) {
    try {
      const parsed = JSON.parse(body) as { message?: string; errors?: unknown };
      detail = parsed.message;
      if (parsed.errors) {
        detail = `${detail ?? "request failed"}: ${JSON.stringify(parsed.errors)}`;
      }
    } catch {
      detail = body.slice(0, 500);
    }
  }
  return new GitHubApiError(status, `GitHub API error ${status}: ${detail ?? "request failed"}`, retryAfter);
}

function mapClientError(e: unknown): Error {
  if (e instanceof GitHubApiError) return e;
  if (e instanceof RateLimitError) {
    const ra = e.retryAfterSeconds;
    return new GitHubApiError(
      429,
      `GitHub API rate limited${ra ? ` (Retry-After: ${ra}s)` : ""}`,
      ra === undefined ? undefined : String(ra),
    );
  }
  if (e instanceof HttpError) {
    return new GitHubApiError(e.status, `GitHub API error ${e.status}: ${e.message}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}
