/**
 * MCP tool response wrappers. Every tool returns one of these shapes;
 * inlining them in every handler is what we're avoiding by extracting them.
 */

import { AuthExpired, RateLimited } from "./errors.js";

/**
 * A single MCP tool-response content item. Beyond plain text, the SDK's
 * `CallToolResult` also allows `image` (inline base64, standard alphabet —
 * NOT base64url) and `resource` (an embedded blob/text resource, e.g. a
 * PDF) so the client can render/handle rich content natively instead of
 * everything collapsing to a text blob.
 */
export type ToolContentItem =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | {
      type: "resource";
      resource:
        | { uri: string; mimeType?: string; blob: string }
        | { uri: string; mimeType?: string; text: string };
    };

export interface McpToolResponse {
  content: ToolContentItem[];
  isError?: true;
  /**
   * The MCP SDK's `CallToolResult` is an open shape (allows `_meta` and
   * future extensions). The index signature lets our response objects
   * be assigned directly to SDK tool callbacks without a cast.
   */
  [key: string]: unknown;
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
 * Wrap arbitrary content items (text, image, resource) as a successful
 * tool response — for handlers that need to return more than one item,
 * or a non-text item, in a single result.
 */
export function multiContent(items: ToolContentItem[]): McpToolResponse {
  return { content: items };
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
