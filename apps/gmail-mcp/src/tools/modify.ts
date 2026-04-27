import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { gmail_v1 } from "googleapis";
import { z } from "zod";
import { textContent, errorContent, formatGmailError } from "./utils.js";

/**
 * Gmail label-modification tools (`modify_email_labels`,
 * `batch_modify_emails`). Tool names, descriptions, parameter shapes, and
 * response payload formats are preserved byte-for-byte from the
 * pre-migration JSON-RPC implementation in
 * `gmail-mcp-worker/src/tools/modify.ts`.
 */
export function registerModifyTools(server: McpServer, gmail: gmail_v1.Gmail): void {
  server.tool(
    "modify_email_labels",
    'Add or remove labels on a single email. Archive by passing removeLabelIds: ["INBOX"]. ' +
      "Get label IDs from list_email_labels.",
    {
      messageId: z.string().describe("Gmail message ID"),
      addLabelIds: z.array(z.string()).optional().describe("Label IDs to add"),
      removeLabelIds: z
        .array(z.string())
        .optional()
        .describe('Label IDs to remove. Use ["INBOX"] to archive.'),
    },
    async ({ messageId, addLabelIds, removeLabelIds }) => {
      try {
        const res = await gmail.users.messages.modify({
          userId: "me",
          id: messageId,
          requestBody: { addLabelIds, removeLabelIds },
        });
        const result = JSON.stringify({ id: res.data.id, labelIds: res.data.labelIds });
        return textContent(result);
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );

  server.tool(
    "batch_modify_emails",
    "Apply the same label change to multiple emails in a single API call (up to 1000 message IDs). " +
      'Archive pattern: removeLabelIds: ["INBOX"].',
    {
      messageIds: z.array(z.string()).describe("List of Gmail message IDs"),
      addLabelIds: z
        .array(z.string())
        .optional()
        .describe("Label IDs to add to all messages"),
      removeLabelIds: z
        .array(z.string())
        .optional()
        .describe('Label IDs to remove from all messages. Use ["INBOX"] to archive.'),
    },
    async ({ messageIds, addLabelIds, removeLabelIds }) => {
      try {
        await gmail.users.messages.batchModify({
          userId: "me",
          requestBody: { ids: messageIds, addLabelIds, removeLabelIds },
        });
        const result = JSON.stringify({ modified: messageIds.length });
        return textContent(result);
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );
}
