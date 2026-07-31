/**
 * Shared helpers for Gmail tool handlers.
 *
 * `textContent` and `errorContent` re-export from `@mcp-stack/mcp-core`
 * so all tool handlers wrap responses identically across the stack.
 *
 * `formatGmailError` translates upstream Gmail errors into actionable
 * user-facing messages, matching the pre-migration behavior — e.g.
 * "Gmail auth expired — re-run auth flow and re-upload GMAIL_CREDENTIALS"
 * and "Gmail rate limited — try again shortly".
 */

export { textContent, errorContent, multiContent } from "@mcp-stack/mcp-core";

/**
 * Gmail attachment `data` is base64url (RFC 4648 §5: `-`/`_`, no padding).
 * MCP `image`/`resource` content blocks expect standard base64 (`+`/`/`,
 * padded) since that's what clients' base64 decoders and the Claude API
 * expect — this is a real re-encoding, not a rename.
 */
export function base64UrlToBase64(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (base64.length % 4)) % 4;
  return base64 + "=".repeat(padding);
}

export function formatGmailError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.includes("401") || msg.includes("invalid_grant") || msg.includes("Invalid Credentials")) {
      return "Gmail auth expired — re-run auth flow and re-upload GMAIL_CREDENTIALS secret";
    }
    if (msg.includes("429") || msg.includes("Rate Limit") || msg.includes("rateLimitExceeded")) {
      return "Gmail rate limited — try again shortly";
    }
    return msg;
  }
  return String(error);
}
