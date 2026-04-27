import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { gmail_v1 } from "googleapis";
import { z } from "zod";
import { textContent, errorContent, formatGmailError } from "./utils.js";

/**
 * Gmail permanent-deletion tools (`delete_email`, `batch_delete_emails`).
 * Tool names, descriptions, parameter shapes, and response payload
 * formats are preserved byte-for-byte from the pre-migration JSON-RPC
 * implementation in `gmail-mcp-worker/src/tools/delete.ts`.
 */
export function registerDeleteTools(server: McpServer, gmail: gmail_v1.Gmail): void {
  server.tool(
    "delete_email",
    "PERMANENT — Delete an email, bypassing trash. This cannot be undone. " +
      'Use modify_email_labels with removeLabelIds:["INBOX"] to archive instead.',
    {
      messageId: z.string().describe("Gmail message ID to permanently delete"),
    },
    async ({ messageId }) => {
      try {
        await gmail.users.messages.delete({ userId: "me", id: messageId });
        const result = JSON.stringify({ deleted: messageId });
        return textContent(result);
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );

  server.tool(
    "batch_delete_emails",
    "PERMANENT — Delete multiple emails, bypassing trash. This cannot be undone. " +
      'Use batch_modify_emails with removeLabelIds:["INBOX"] to archive instead.',
    {
      messageIds: z
        .array(z.string())
        .describe("Gmail message IDs to permanently delete"),
    },
    async ({ messageIds }) => {
      try {
        await gmail.users.messages.batchDelete({
          userId: "me",
          requestBody: { ids: messageIds },
        });
        const result = JSON.stringify({ deleted: messageIds.length });
        return textContent(result);
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );
}
