import { createBearerClient } from "@mcp-stack/auth-bearer";
import { HttpError, RateLimitError, type FetchClient } from "@mcp-stack/http-fetch";
import type { OuraListResponse } from "./types.js";

const OURA_BASE = "https://api.ouraring.com/v2/usercollection";

export class OuraApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly retryAfter?: string,
  ) {
    super(message);
    this.name = "OuraApiError";
  }
}

export class OuraClient {
  private readonly http: FetchClient;

  constructor(pat: string) {
    this.http = createBearerClient({ token: pat });
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${OURA_BASE}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    try {
      return await this.http.json<T>(url.toString());
    } catch (e) {
      throw mapOuraError(e);
    }
  }

  async paginate<T>(
    path: string,
    params: Record<string, string>,
    maxPages = 5,
  ): Promise<T[]> {
    const results: T[] = [];
    let nextToken: string | undefined;

    for (let i = 0; i < maxPages; i++) {
      const queryParams = { ...params };
      if (nextToken) queryParams["next_token"] = nextToken;

      const page = await this.get<OuraListResponse<T>>(path, queryParams);
      results.push(...page.data);

      if (!page.next_token) break;
      nextToken = page.next_token;
    }

    return results;
  }
}

function mapOuraError(e: unknown): Error {
  if (e instanceof RateLimitError) {
    const ra = e.retryAfterSeconds;
    return new OuraApiError(
      429,
      `Oura API error 429: rate limited${ra ? ` (Retry-After: ${ra}s)` : ""}`,
      ra === undefined ? undefined : String(ra),
    );
  }
  if (e instanceof HttpError) {
    let detail: string | undefined;
    if (e.body) {
      try {
        const parsed = JSON.parse(e.body) as { detail?: string; message?: string };
        detail = parsed.detail ?? parsed.message;
      } catch {
        // body wasn't JSON; fall through to default message
      }
    }
    return new OuraApiError(e.status, `Oura API error ${e.status}: ${detail ?? "request failed"}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}
