import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { gmail_v1 } from "googleapis";
import { z } from "zod";
import { textContent, errorContent, formatGmailError } from "./utils.js";

/**
 * Gmail compose tools (`send_email`, `create_draft`). Tool name strings,
 * descriptions, parameter shapes, and response payload formats are
 * preserved byte-for-byte from the pre-migration JSON-RPC implementation
 * in `gmail-mcp-worker/src/tools/email.ts`.
 *
 * `buildRfc2822` and `toBase64Url` are copied verbatim from the old
 * `email.ts` module — they live with the only tools that use them.
 */

export function buildRfc2822(args: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  isHtml?: boolean;
}): string {
  const headers = [
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    ...(args.cc ? [`Cc: ${args.cc}`] : []),
    ...(args.bcc ? [`Bcc: ${args.bcc}`] : []),
  ];

  if (args.isHtml) {
    const boundary = `boundary_${Date.now()}`;
    const plainText = args.body.replace(/<[^>]+>/g, '');
    return [
      ...headers,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      plainText,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      args.body,
      '',
      `--${boundary}--`,
    ].join('\r\n');
  }

  return [
    ...headers,
    'Content-Type: text/plain; charset=utf-8',
    '',
    args.body,
  ].join('\r\n');
}

export function toBase64Url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function registerComposeTools(server: McpServer, gmail: gmail_v1.Gmail): void {
  server.tool(
    "send_email",
    "Send an email from your Gmail account.",
    {
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body (plain text or HTML if isHtml is true)"),
      cc: z.string().optional().describe("CC recipient email address"),
      bcc: z.string().optional().describe("BCC recipient email address"),
      isHtml: z.boolean().optional().describe("Set true if body contains HTML (default false)"),
    },
    async ({ to, subject, body, cc, bcc, isHtml }) => {
      try {
        const raw = toBase64Url(buildRfc2822({ to, subject, body, cc, bcc, isHtml }));
        const res = await gmail.users.messages.send({
          userId: "me",
          requestBody: { raw },
        });
        const result = JSON.stringify({ id: res.data.id, threadId: res.data.threadId });
        return textContent(result);
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );

  server.tool(
    "create_draft",
    "Create a draft email without sending it.",
    {
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body (plain text or HTML if isHtml is true)"),
      cc: z.string().optional().describe("CC recipient email address"),
      bcc: z.string().optional().describe("BCC recipient email address"),
      isHtml: z.boolean().optional().describe("Set true if body contains HTML (default false)"),
    },
    async ({ to, subject, body, cc, bcc, isHtml }) => {
      try {
        const raw = toBase64Url(buildRfc2822({ to, subject, body, cc, bcc, isHtml }));
        const res = await gmail.users.drafts.create({
          userId: "me",
          requestBody: { message: { raw } },
        });
        const result = JSON.stringify({ id: res.data.id, message: { id: res.data.message?.id } });
        return textContent(result);
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );
}
