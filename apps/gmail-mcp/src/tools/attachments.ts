import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { gmail_v1 } from "googleapis";
import { z } from "zod";
import {
  textContent,
  errorContent,
  multiContent,
  base64UrlToBase64,
  formatGmailError,
  titledTool,
} from "./utils.js";
import { collectAttachments, type MimePart } from "./email.js";

/**
 * Gmail attachment-retrieval tools (issue #30, MIME routing from #51).
 *
 * `list_attachments` walks the message's MIME tree (recursively, via
 * `collectAttachments` shared with `read_email`) and returns metadata only
 * — filename, MIME type, size, and the `attachmentId` needed to fetch
 * bytes.
 *
 * `get_attachment` fetches the raw attachment via
 * `users.messages.attachments.get`, looks up its MIME type from the
 * message (re-fetched rather than trusted from the caller, so routing is
 * correct even if the caller didn't pass one through from
 * `list_attachments`), and routes:
 *   - common web image types → an MCP `image` content block, so Claude's
 *     vision handles it directly.
 *   - `application/pdf` → an MCP `resource` content block (base64 blob +
 *     mimeType), leaning on the client's own document handling rather
 *     than server-side text extraction.
 *   - everything else → unchanged: raw base64url text data, same as
 *     before #51.
 *
 * Server-side docx/xlsx conversion, a size cap + `force` override, and
 * structured errors for unsupported types are deferred — see the
 * tracking issue for the reasoning (Workers CPU/memory constraints on
 * real parsing libraries, speculative until a real attachment needs it).
 */
const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
export function registerAttachmentTools(server: McpServer, gmail: gmail_v1.Gmail): void {
  titledTool(
    server,
    "list_attachments",
    "Reviewing attachments…",
    "List attachment metadata for a Gmail message by message ID: filename, MIME type, " +
      "size in bytes, and attachmentId. Pass the attachmentId to get_attachment to fetch content.",
    {
      messageId: z.string().describe("Gmail message ID"),
    },
    async ({ messageId }) => {
      try {
        const res = await gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "full",
        });
        const attachments = res.data.payload
          ? collectAttachments(res.data.payload as MimePart)
          : [];
        const result = JSON.stringify({ messageId, attachments });
        return textContent(result);
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );

  titledTool(
    server,
    "get_attachment",
    "Fetching an attachment…",
    "Fetch a Gmail attachment's content by message ID and attachmentId (from " +
      "list_attachments). Common image types (png/jpeg/webp/gif) are returned as a viewable " +
      "image; PDFs are returned as an embedded document resource. Everything else falls back " +
      "to the attachment's raw base64url-encoded data and size, per the Gmail API.",
    {
      messageId: z.string().describe("Gmail message ID"),
      attachmentId: z
        .string()
        .describe("Attachment ID, from a prior list_attachments call"),
    },
    async ({ messageId, attachmentId }) => {
      try {
        const [messageRes, attachmentRes] = await Promise.all([
          gmail.users.messages.get({ userId: "me", id: messageId, format: "full" }),
          gmail.users.messages.attachments.get({ userId: "me", messageId, id: attachmentId }),
        ]);

        const parts = messageRes.data.payload
          ? collectAttachments(messageRes.data.payload as MimePart)
          : [];
        const meta = parts.find((p) => p.attachmentId === attachmentId);
        const mimeType = meta?.mimeType ?? "application/octet-stream";
        const base64url = attachmentRes.data.data ?? "";
        const size = attachmentRes.data.size ?? 0;

        if (IMAGE_MIME_TYPES.has(mimeType)) {
          return multiContent([
            { type: "text", text: JSON.stringify({ messageId, attachmentId, mimeType, size }) },
            { type: "image", data: base64UrlToBase64(base64url), mimeType },
          ]);
        }

        if (mimeType === "application/pdf") {
          return multiContent([
            { type: "text", text: JSON.stringify({ messageId, attachmentId, mimeType, size }) },
            {
              type: "resource",
              resource: {
                uri: `gmail-attachment://${messageId}/${attachmentId}`,
                mimeType,
                blob: base64UrlToBase64(base64url),
              },
            },
          ]);
        }

        return textContent(JSON.stringify({ messageId, attachmentId, size, data: base64url }));
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );
}
