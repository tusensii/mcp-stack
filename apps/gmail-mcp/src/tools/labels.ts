import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { gmail_v1 } from "googleapis";
import { z } from "zod";
import { textContent, errorContent, formatGmailError } from "./utils.js";

/**
 * Gmail label tools. Tool name strings, descriptions, input parameter
 * shapes, and response payload formats are preserved byte-for-byte from
 * the pre-migration implementation in `gmail-mcp-worker/src/tools/labels.ts`.
 *
 * Each handler stringifies its result via `JSON.stringify` and passes the
 * raw string to `textContent`, which forwards strings verbatim — preserving
 * the exact byte-for-byte payload the old JSON-RPC dispatcher returned.
 */
export function registerLabelTools(server: McpServer, gmail: gmail_v1.Gmail): void {
  server.tool(
    "list_email_labels",
    "List all Gmail labels (system labels like INBOX, SENT, plus any user-created labels).",
    {},
    async () => {
      try {
        const res = await gmail.users.labels.list({ userId: "me" });
        const result = JSON.stringify({
          labels: (res.data.labels ?? []).map((l) => ({
            id: l.id,
            name: l.name,
            type: l.type,
          })),
        });
        return textContent(result);
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );

  server.tool(
    "create_label",
    "Create a new Gmail label.",
    {
      name: z.string().describe("Label name"),
      messageListVisibility: z
        .enum(["show", "hide"])
        .optional()
        .describe("Whether to show messages with this label in message list (default: show)"),
      labelListVisibility: z
        .enum(["labelShow", "labelShowIfUnread", "labelHide"])
        .optional()
        .describe("Whether to show this label in the label list (default: labelShow)"),
    },
    async ({ name, messageListVisibility, labelListVisibility }) => {
      try {
        const res = await gmail.users.labels.create({
          userId: "me",
          requestBody: { name, messageListVisibility, labelListVisibility },
        });
        return textContent(JSON.stringify(res.data));
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );

  server.tool(
    "update_label",
    "Rename or change visibility of an existing Gmail label.",
    {
      labelId: z.string().describe("Gmail label ID"),
      name: z.string().optional().describe("New label name"),
      messageListVisibility: z
        .enum(["show", "hide"])
        .optional()
        .describe("Whether to show messages with this label in message list"),
      labelListVisibility: z
        .enum(["labelShow", "labelShowIfUnread", "labelHide"])
        .optional()
        .describe("Whether to show this label in the label list"),
    },
    async ({ labelId, name, messageListVisibility, labelListVisibility }) => {
      try {
        const res = await gmail.users.labels.update({
          userId: "me",
          id: labelId,
          requestBody: { name, messageListVisibility, labelListVisibility },
        });
        return textContent(JSON.stringify(res.data));
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );

  server.tool(
    "delete_label",
    "Delete a Gmail label. System labels (INBOX, SENT, etc.) cannot be deleted.",
    {
      labelId: z.string().describe("Gmail label ID to delete"),
    },
    async ({ labelId }) => {
      try {
        await gmail.users.labels.delete({ userId: "me", id: labelId });
        return textContent(JSON.stringify({ deleted: labelId }));
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );

  server.tool(
    "get_or_create_label",
    "Return an existing label by exact name, or create it if it does not exist. Name match is case-sensitive.",
    {
      name: z.string().describe("Label name to find or create"),
    },
    async ({ name }) => {
      try {
        const listRes = await gmail.users.labels.list({ userId: "me" });
        const existing = (listRes.data.labels ?? []).find((l) => l.name === name);
        if (existing) return textContent(JSON.stringify(existing));
        const createRes = await gmail.users.labels.create({
          userId: "me",
          requestBody: { name },
        });
        return textContent(JSON.stringify(createRes.data));
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );
}
