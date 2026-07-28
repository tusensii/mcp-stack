import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { gmail_v1 } from "googleapis";
import { z } from "zod";
import { textContent, errorContent, formatGmailError } from "./utils.js";
import { collectAttachments, type MimePart } from "./email.js";

/**
 * Gmail attachment-retrieval tools (issue #30).
 *
 * `list_attachments` walks the message's MIME tree (recursively, via
 * `collectAttachments` shared with `read_email`) and returns metadata only
 * — filename, MIME type, size, and the `attachmentId` needed to fetch
 * bytes. `get_attachment` fetches the raw attachment via
 * `users.messages.attachments.get` and returns it as base64url data,
 * unchanged from what the Gmail API returns (Gmail's attachment `data` is
 * base64url — `-`/`_` instead of `+`/`/` — and is passed through verbatim
 * rather than re-encoded).
 *
 * MIME-aware routing (image content blocks, PDF/docx/xlsx text
 * extraction), the size cap + `force` override, and end-to-end smoke
 * testing against real attachments are deferred — see the tracking issue
 * referenced in the PR that introduced this file.
 */
export function registerAttachmentTools(server: McpServer, gmail: gmail_v1.Gmail): void {
  server.tool(
    "list_attachments",
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

  server.tool(
    "get_attachment",
    "Fetch a Gmail attachment's raw content by message ID and attachmentId (from " +
      "list_attachments). Returns the attachment's base64url-encoded data, per the Gmail API, " +
      "and its size in bytes.",
    {
      messageId: z.string().describe("Gmail message ID"),
      attachmentId: z
        .string()
        .describe("Attachment ID, from a prior list_attachments call"),
    },
    async ({ messageId, attachmentId }) => {
      try {
        const res = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: attachmentId,
        });
        const result = JSON.stringify({
          messageId,
          attachmentId,
          size: res.data.size ?? 0,
          data: res.data.data ?? "",
        });
        return textContent(result);
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );
}
