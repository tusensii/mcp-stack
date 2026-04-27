/**
 * MCP tool response wrappers. Every tool returns one of these shapes;
 * inlining them in every handler is what we're avoiding by extracting them.
 */

import { AuthExpired, RateLimited } from "./errors.js";

export interface McpToolResponse {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}

/**
 * Wrap data as a successful tool response. Strings pass through verbatim;
 * objects and arrays are pretty-printed JSON for readability in Claude.
 */
export function textContent(data: unknown): McpToolResponse {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

/** Wrap a message as a tool error response. */
export function errorContent(message: string): McpToolResponse {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Convert a thrown error into a sanitized, user-friendly string suitable
 * for `errorContent`. Recognized error classes get specific messages;
 * everything else returns `error.message` (or `String(error)`).
 *
 * Apps that want raw stack traces should branch on `env.DEBUG === "true"`
 * before calling this.
 */
export function formatToolError(error: unknown): string {
  if (error instanceof AuthExpired) {
    return error.message || "Authentication expired — re-run setup or refresh credentials.";
  }
  if (error instanceof RateLimited) {
    return error.retryAfterSeconds === undefined
      ? "Upstream rate limited; try again shortly."
      : `Upstream rate limited; retry after ${error.retryAfterSeconds}s.`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
