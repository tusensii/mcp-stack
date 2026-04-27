import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { gmail_v1 } from "googleapis";
import { z } from "zod";
import { textContent, errorContent, formatGmailError } from "./utils.js";

/**
 * Gmail email-content tools. Tool name strings, parameter shapes, and
 * response payload formats are preserved byte-for-byte from the
 * pre-migration JSON-RPC implementation. Each handler builds the same
 * JSON string the old code returned and passes it through `textContent`,
 * which preserves strings verbatim (no re-serialization / pretty-print).
 *
 * Currently registered: `search_emails`, `read_email`. The mutating
 * email tools (`send_email`, `create_draft`) land via a follow-up
 * migration sub-task.
 */

type MimePart = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: MimePart[] | null;
  filename?: string | null;
};

/**
 * Walk a Gmail MIME tree and pull out a plain-text representation of the
 * body. Verbatim from the pre-migration source so behavior (depth limit,
 * multipart/alternative preference, multipart/related text-only handling)
 * stays identical.
 */
function extractBody(part: MimePart, depth = 0): string {
  if (depth > 8) return "";

  // Leaf node with body data — only decode text/* parts
  if (part.body?.data) {
    if (!part.mimeType?.startsWith("text/")) return "";
    const raw = part.body.data.replace(/-/g, "+").replace(/_/g, "/");
    const content = atob(raw);
    if (part.mimeType === "text/plain") return content;
    if (part.mimeType === "text/html") return content.replace(/<[^>]+>/g, "");
    return content;
  }

  const children = part.parts ?? [];

  // multipart/alternative: prefer text/plain, fall back to text/html
  if (part.mimeType === "multipart/alternative") {
    const plain = children.find((p) => p.mimeType === "text/plain");
    if (plain) return extractBody(plain, depth + 1);
    const html = children.find((p) => p.mimeType === "text/html");
    if (html) return extractBody(html, depth + 1);
  }

  // multipart/related: only take the first text part (the HTML body), skip inline attachments
  if (part.mimeType === "multipart/related") {
    const textPart = children.find((p) => p.mimeType?.startsWith("text/"));
    if (textPart) return extractBody(textPart, depth + 1);
    return "";
  }

  // multipart/mixed and others: concatenate text children only
  return children
    .map((p) => extractBody(p, depth + 1))
    .filter(Boolean)
    .join("\n");
}

const MAX_BODY_CHARS = 2_500;

export function registerEmailTools(server: McpServer, gmail: gmail_v1.Gmail): void {
  server.tool(
    "search_emails",
    'Search Gmail using Gmail search syntax (e.g. "is:unread", "from:boss@example.com", "newer_than:7d"). ' +
      "Returns message IDs, thread IDs, and snippets. Pass nextPageToken from a previous response as pageToken to fetch the next page.",
    {
      query: z.string().describe("Gmail search query string"),
      maxResults: z
        .number()
        .int()
        .optional()
        .describe("Max results to return (default 10, max 500)"),
      pageToken: z
        .string()
        .optional()
        .describe("Token from previous nextPageToken to get next page"),
    },
    async ({ query, maxResults, pageToken }) => {
      try {
        const res = await gmail.users.messages.list({
          userId: "me",
          q: query,
          maxResults: maxResults ?? 10,
          pageToken,
        });
        const result = JSON.stringify({
          messages: res.data.messages ?? [],
          nextPageToken: res.data.nextPageToken ?? null,
          resultSizeEstimate: res.data.resultSizeEstimate ?? 0,
        });
        return textContent(result);
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );

  server.tool(
    "read_email",
    "Read the full content of an email by message ID. Returns headers, decoded body, and attachment filenames.",
    {
      messageId: z.string().describe("Gmail message ID"),
    },
    async ({ messageId }) => {
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "read_email timed out — message may have complex structure",
                ),
              ),
            25_000,
          ),
        );
        const res = await Promise.race([
          gmail.users.messages.get({
            userId: "me",
            id: messageId,
            format: "full",
          }),
          timeout,
        ]);
        const msg = res.data;
        const headers = msg.payload?.headers ?? [];
        const getHeader = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
            ?.value ?? "";
        const rawBody = msg.payload
          ? extractBody(msg.payload as MimePart)
          : "";
        // Normalize whitespace before truncating — collapses \r\n sequences and blank lines
        const normalized = rawBody
          .replace(/\r\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        const body =
          normalized.length > MAX_BODY_CHARS
            ? normalized.slice(0, MAX_BODY_CHARS) +
              `\n\n[truncated — ${
                normalized.length - MAX_BODY_CHARS
              } additional characters omitted]`
            : normalized;
        const attachments = (msg.payload?.parts ?? [])
          .filter((p): p is typeof p & { filename: string } =>
            Boolean((p as MimePart).filename),
          )
          .map((p) => (p as MimePart).filename);
        const result = JSON.stringify({
          id: msg.id,
          threadId: msg.threadId,
          from: getHeader("From"),
          to: getHeader("To"),
          subject: getHeader("Subject"),
          date: getHeader("Date"),
          body,
          attachments,
        });
        return textContent(result);
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );
}
