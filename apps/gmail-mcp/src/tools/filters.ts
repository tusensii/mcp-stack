import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { gmail_v1 } from "googleapis";
import { z } from "zod";
import { textContent, errorContent, formatGmailError } from "./utils.js";

/**
 * Gmail filter tools (`create_filter`, `list_filters`, `delete_filter`).
 * Tool names, descriptions, parameter shapes, and response payload
 * formats are preserved byte-for-byte from the pre-migration JSON-RPC
 * implementation in `gmail-mcp-worker/src/tools/filters.ts`.
 *
 * `create_filter`'s `criteria` and `action` are nested `z.object` shapes
 * mirroring the original JSON-Schema `properties` blocks. Both objects
 * are required at the top level (matching `required: ['criteria', 'action']`),
 * but every field within them is optional, exactly as the source schema
 * lists no `required` arrays inside the nested objects.
 */
export function registerFilterTools(server: McpServer, gmail: gmail_v1.Gmail): void {
  server.tool(
    "create_filter",
    "Create a Gmail filter that automatically applies actions to matching incoming emails. " +
      'For negation, use a minus prefix in the query field (e.g. query: "-from:noreply@example.com"). ' +
      "The negatedQuery field is not supported by the Gmail API.",
    {
      criteria: z
        .object({
          from: z.string().optional().describe("Sender email address"),
          to: z.string().optional().describe("Recipient email address"),
          subject: z.string().optional().describe("Subject contains this string"),
          query: z
            .string()
            .optional()
            .describe(
              'Gmail search query. Supports negation with - prefix (e.g. "-label:important")',
            ),
          hasAttachment: z
            .boolean()
            .optional()
            .describe("Email has an attachment"),
          size: z.number().int().optional().describe("Email size in bytes"),
          sizeComparison: z
            .enum(["larger", "smaller"])
            .optional()
            .describe("Whether email is larger or smaller than size"),
        })
        .describe("Conditions the email must match"),
      action: z
        .object({
          addLabelIds: z
            .array(z.string())
            .optional()
            .describe(
              'Label IDs to add. Use ["TRASH"] to delete, ["SPAM"] to mark spam.',
            ),
          removeLabelIds: z
            .array(z.string())
            .optional()
            .describe(
              'Label IDs to remove. Use ["INBOX"] to skip inbox (archive on arrival).',
            ),
          forward: z
            .string()
            .optional()
            .describe("Email address to forward matching emails to"),
        })
        .describe("Actions to apply to matching emails"),
    },
    async ({ criteria, action }) => {
      try {
        const res = await gmail.users.settings.filters.create({
          userId: "me",
          requestBody: { criteria, action },
        });
        return textContent(JSON.stringify(res.data));
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );

  server.tool(
    "list_filters",
    "List all active Gmail filters.",
    {},
    async () => {
      try {
        const res = await gmail.users.settings.filters.list({ userId: "me" });
        const result = JSON.stringify({ filters: res.data.filter ?? [] });
        return textContent(result);
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );

  server.tool(
    "delete_filter",
    "Delete a Gmail filter by ID. Get filter IDs from list_filters.",
    {
      filterId: z.string().describe("Gmail filter ID to delete"),
    },
    async ({ filterId }) => {
      try {
        await gmail.users.settings.filters.delete({ userId: "me", id: filterId });
        const result = JSON.stringify({ deleted: filterId });
        return textContent(result);
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );
}
