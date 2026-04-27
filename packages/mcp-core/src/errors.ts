/**
 * Error classes that auth packages and tool handlers throw. `mcp-core`'s
 * `formatToolError` recognizes them and produces a sanitized, actionable
 * message; otherwise they look like ordinary `Error`s.
 */

/**
 * The cached/stored credentials are stale. Tools should not retry —
 * the operator must re-authorize (re-run a bootstrap script, refresh
 * an OAuth token, or update a secret).
 */
export class AuthExpired extends Error {
  override readonly name = "AuthExpired";
  constructor(message?: string) {
    super(message ?? "Authentication expired");
  }
}

/**
 * Upstream API returned a rate-limit signal (HTTP 429 or equivalent).
 * `retryAfterSeconds`, when present, is the upstream-suggested backoff.
 */
export class RateLimited extends Error {
  override readonly name = "RateLimited";
  constructor(public readonly retryAfterSeconds?: number) {
    super(
      retryAfterSeconds === undefined
        ? "Rate limited"
        : `Rate limited; retry after ${retryAfterSeconds}s`,
    );
  }
}
