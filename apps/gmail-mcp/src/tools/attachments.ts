import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { gmail_v1 } from "googleapis";
import { z } from "zod";
import { textContent, errorContent, formatGmailError } from "./utils.js";
import type { Env } from "../types.js";

/**
 * Gmail attachment tools.
 *
 * `gmail_list_attachments` walks a message's MIME tree and returns
 * metadata for every part with a `body.attachmentId`. The model can
 * use that metadata to decide whether to spend bytes / CPU on
 * `gmail_get_attachment`.
 *
 * `gmail_get_attachment` fetches base64url bytes via
 * `users.messages.attachments.get`, then routes by MIME type:
 *   - images → MCP image content block (model sees it natively)
 *   - text-like → decoded UTF-8 text
 *   - PDF → server-side text extraction via `unpdf`
 *   - `.docx` → markdown via `mammoth`
 *   - `.xlsx` → CSV (first sheet) or JSON-of-CSVs (multi-sheet) via SheetJS
 *   - anything else → structured error naming the MIME type + filename
 *
 * A size guard (default 10 MiB, configurable via env
 * `GMAIL_ATTACHMENT_BYTE_CAP`) refuses oversize fetches unless the
 * caller passes `force: true`.
 *
 * PDF page rasterization is out of scope — only text extraction is
 * performed. Heavy parsing (large PDFs / spreadsheets) is wrapped in
 * try/catch so we surface a clear error rather than time out silently.
 */

/** MIME types we treat as in-line images. */
const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/**
 * Non-`text/*` MIME types we still decode as UTF-8 text. `text/*`
 * itself is matched via a prefix check, not this set.
 */
const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "application/yaml",
  "application/x-sh",
  "application/x-www-form-urlencoded",
  "application/sql",
  "application/csv",
]);

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const DEFAULT_BYTE_CAP = 10 * 1024 * 1024; // 10 MiB

type AttachmentPart = {
  filename?: string | null;
  mimeType?: string | null;
  body?: { attachmentId?: string | null; size?: number | null } | null;
  parts?: AttachmentPart[] | null;
};

export interface AttachmentMeta {
  filename: string;
  mime_type: string;
  size_bytes: number;
  attachment_id: string;
}

/**
 * Walk a Gmail MIME tree and collect every part with a non-empty
 * `body.attachmentId`. Inline images (Content-Disposition: inline)
 * are included too — Gmail still surfaces them as attachments.
 */
export function collectAttachments(
  part: AttachmentPart | undefined | null,
  out: AttachmentMeta[] = [],
  depth = 0,
): AttachmentMeta[] {
  if (!part || depth > 16) return out;
  const aid = part.body?.attachmentId;
  if (aid) {
    out.push({
      filename: part.filename ?? "",
      mime_type: part.mimeType ?? "application/octet-stream",
      size_bytes: part.body?.size ?? 0,
      attachment_id: aid,
    });
  }
  for (const child of part.parts ?? []) {
    collectAttachments(child, out, depth + 1);
  }
  return out;
}

/**
 * Decode Gmail's base64url payload (RFC 4648 §5: `-`/`_` substituted
 * for `+`/`/`, padding optional) into a `Uint8Array` using the
 * Workers-available `atob`.
 */
export function base64UrlToBytes(b64url: string): Uint8Array {
  const std = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (std.length % 4)) % 4;
  const padded = std + "=".repeat(padLen);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Re-encode a Uint8Array to standard base64 (for the MCP image block). */
export function bytesToStandardBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function parseCap(env: Env): number {
  const raw = env.GMAIL_ATTACHMENT_BYTE_CAP;
  if (!raw) return DEFAULT_BYTE_CAP;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_BYTE_CAP;
  return Math.floor(n);
}

function isTextMime(mime: string): boolean {
  if (mime.startsWith("text/")) return true;
  if (TEXT_MIME_TYPES.has(mime)) return true;
  // Recognize source-code-ish vendor types: anything ending in +json, +xml,
  // +yaml is structurally text.
  if (/\+(json|xml|yaml)$/.test(mime)) return true;
  return false;
}

/**
 * Lightweight HTML → markdown conversion for mammoth's docx output.
 * Mammoth doesn't ship a markdown converter, so we do a small pass
 * covering headings, paragraphs, lists, bold, italic, and links —
 * enough that the model gets readable text rather than tag soup.
 * Anything fancier (tables, nested formatting) gets a best-effort
 * fallback: tags are stripped and content is preserved.
 */
export function htmlToMarkdown(html: string): string {
  let s = html;
  // Headings.
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  s = s.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  s = s.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");
  // Inline emphasis.
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  // Links.
  s = s.replace(
    /<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    "[$2]($1)",
  );
  // List items.
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, "\n");
  // Paragraphs and breaks.
  s = s.replace(/<p[^>]*>/gi, "");
  s = s.replace(/<\/p>/gi, "\n\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // Strip any remaining tags.
  s = s.replace(/<[^>]+>/g, "");
  // Decode common entities.
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Collapse runs of 3+ blank lines.
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

interface RouteResult {
  ok: true;
  response: ReturnType<typeof textContent> | {
    content: Array<
      | { type: "text"; text: string }
      | { type: "image"; data: string; mimeType: string }
    >;
  };
}

interface RouteError {
  ok: false;
  message: string;
}

/**
 * Dispatch decoded bytes to the correct MCP content block based on the
 * declared MIME type. Returns either an MCP-shaped response or a
 * structured-error message.
 */
export async function routeByMime(
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<RouteResult | RouteError> {
  try {
    if (IMAGE_MIME_TYPES.has(mime)) {
      const data = bytesToStandardBase64(bytes);
      return {
        ok: true,
        response: {
          content: [{ type: "image", data, mimeType: mime }],
        },
      };
    }
    if (isTextMime(mime)) {
      const text = new TextDecoder("utf-8").decode(bytes);
      return { ok: true, response: textContent(text) };
    }
    if (mime === PDF_MIME) {
      // `unpdf` ships a pure-JS bundled pdf.js for Workers/serverless.
      // We dynamic-import so the module load only happens on actual PDF
      // fetches (keeps cold-start cost off the other tool paths).
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      const merged = Array.isArray(text) ? text.join("\n") : text;
      return { ok: true, response: textContent(merged) };
    }
    if (mime === DOCX_MIME) {
      try {
        // mammoth's BrowserInput shape takes an ArrayBuffer — avoids any
        // Node `Buffer` dependency. mammoth doesn't ship a direct
        // markdown converter, so we go HTML → light markdown.
        const mammothModule = await import("mammoth");
        const mammoth = (mammothModule.default ?? mammothModule) as {
          convertToHtml: (input: {
            arrayBuffer: ArrayBuffer;
          }) => Promise<{ value: string }>;
        };
        // Copy into a fresh ArrayBuffer so we don't hand mammoth a
        // SharedArrayBuffer-backed view (and so the buffer is the exact
        // length of the payload).
        const ab = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        const result = await mammoth.convertToHtml({ arrayBuffer: ab });
        return { ok: true, response: textContent(htmlToMarkdown(result.value)) };
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          message:
            "docx parsing failed on Workers runtime — mammoth may require Node-only APIs not available here. " +
            `Underlying error: ${detail}. Filename: ${filename || "(none)"}.`,
        };
      }
    }
    if (mime === XLSX_MIME) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(bytes, { type: "array" });
      const sheetNames = wb.SheetNames;
      if (sheetNames.length === 0) {
        return { ok: true, response: textContent("") };
      }
      if (sheetNames.length === 1) {
        const sheet = wb.Sheets[sheetNames[0]!]!;
        const csv = XLSX.utils.sheet_to_csv(sheet);
        return { ok: true, response: textContent(csv) };
      }
      const byName: Record<string, string> = {};
      for (const name of sheetNames) {
        const sheet = wb.Sheets[name];
        if (sheet) byName[name] = XLSX.utils.sheet_to_csv(sheet);
      }
      return { ok: true, response: textContent(byName) };
    }
    return {
      ok: false,
      message:
        `Unsupported attachment MIME type "${mime}" for file "${filename || "(no filename)"}". ` +
        "Supported: image/{png,jpeg,webp,gif}, text/*, application/json, application/pdf, " +
        ".docx, .xlsx.",
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message:
        `Failed to parse attachment "${filename || "(no filename)"}" as ${mime}: ${detail}. ` +
        "This may be a Workers CPU/memory limit (large PDFs or spreadsheets).",
    };
  }
}

export function registerAttachmentTools(
  server: McpServer,
  gmail: gmail_v1.Gmail,
  env: Env,
): void {
  const cap = parseCap(env);
  const capMiB = (cap / (1024 * 1024)).toFixed(1);

  server.tool(
    "gmail_list_attachments",
    "List metadata (filename, MIME type, size in bytes, attachment_id) for every attachment " +
      "on a Gmail message. Walks the message's MIME tree and returns one entry per part with an " +
      "attachmentId — use the returned attachment_id with gmail_get_attachment to fetch bytes.",
    {
      message_id: z.string().describe("Gmail message ID"),
    },
    async ({ message_id }) => {
      try {
        const res = await gmail.users.messages.get({
          userId: "me",
          id: message_id,
          format: "full",
        });
        const payload = res.data.payload as AttachmentPart | undefined;
        const attachments = collectAttachments(payload ?? null);
        return textContent({ message_id, attachments });
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );

  server.tool(
    "gmail_get_attachment",
    `Fetch a Gmail attachment's bytes and return content routed by MIME type. ` +
      `Size cap: ${capMiB} MiB (configurable via GMAIL_ATTACHMENT_BYTE_CAP env var) — ` +
      `pass force=true to bypass for a single fetch. Supported MIME types: ` +
      `image/{png,jpeg,webp,gif} returned as an MCP image block; text/*, application/json, ` +
      `and common code/CSV MIME types decoded as UTF-8 text; application/pdf parsed to text ` +
      `(page rasterization is out of scope — text extraction only); ` +
      `.docx converted to markdown; .xlsx converted to CSV (or JSON of CSVs if multi-sheet). ` +
      `Unsupported MIME types return a structured error. Heavy parsing may hit Workers CPU/memory ` +
      `limits — failures return a clear error rather than silent timeout.`,
    {
      message_id: z.string().describe("Gmail message ID"),
      attachment_id: z
        .string()
        .describe("Attachment ID from gmail_list_attachments"),
      force: z
        .boolean()
        .optional()
        .describe(
          "If true, bypass the configured byte cap. Use sparingly — large attachments may exceed Workers CPU/memory limits.",
        ),
    },
    async ({ message_id, attachment_id, force }) => {
      try {
        // Re-fetch the message metadata so we can pick out this attachment's
        // MIME type, filename, and size. The Gmail attachments.get response
        // only carries `data` + `size`, not the MIME type / filename — those
        // live on the parent part.
        const msgRes = await gmail.users.messages.get({
          userId: "me",
          id: message_id,
          format: "full",
        });
        const payload = msgRes.data.payload as AttachmentPart | undefined;
        const attachments = collectAttachments(payload ?? null);
        const meta = attachments.find((a) => a.attachment_id === attachment_id);
        if (!meta) {
          return errorContent(
            `Attachment ${attachment_id} not found on message ${message_id}. ` +
              "Call gmail_list_attachments first to see available attachment_ids.",
          );
        }

        if (meta.size_bytes > cap && force !== true) {
          return errorContent(
            `Attachment "${meta.filename || "(no filename)"}" is ${meta.size_bytes} bytes, ` +
              `which exceeds the ${cap}-byte cap (${capMiB} MiB). ` +
              "Pass force=true to bypass — note that very large attachments may exceed Workers CPU/memory limits.",
          );
        }

        const attRes = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: message_id,
          id: attachment_id,
        });
        const dataB64 = attRes.data.data;
        if (!dataB64) {
          return errorContent(
            `Gmail returned no bytes for attachment ${attachment_id} on message ${message_id}.`,
          );
        }
        const bytes = base64UrlToBytes(dataB64);
        const routed = await routeByMime(bytes, meta.mime_type, meta.filename);
        if (!routed.ok) return errorContent(routed.message);
        return routed.response as Awaited<ReturnType<typeof textContent>>;
      } catch (e) {
        return errorContent(formatGmailError(e));
      }
    },
  );
}
