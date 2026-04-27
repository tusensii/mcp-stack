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

export { textContent, errorContent } from "@mcp-stack/mcp-core";

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
