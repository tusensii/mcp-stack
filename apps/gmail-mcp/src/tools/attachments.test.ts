/**
 * Unit tests for the gmail attachment tools. Gmail API is mocked —
 * no network, no real OAuth. Verifies:
 *   - `collectAttachments` walks nested multipart trees and pulls every
 *     part with a `body.attachmentId`.
 *   - `routeByMime` produces the right MCP content block per MIME type
 *     (image → image block, text → text, unsupported → error).
 *   - The `gmail_get_attachment` tool refuses oversize fetches when
 *     `force !== true`, and proceeds when `force === true`.
 *   - The size guard, base64url decoding, and "attachment not found"
 *     branch all wire up correctly.
 */

import { describe, expect, it, vi } from "vitest";
import {
  collectAttachments,
  base64UrlToBytes,
  bytesToStandardBase64,
  routeByMime,
  registerAttachmentTools,
  type AttachmentMeta,
} from "./attachments.js";
import type { Env } from "../types.js";

// A 1x1 transparent PNG, base64url encoded (no padding, `+`/`/` swapped
// for `-`/`_`). Used to verify image routing without bundling a binary
// fixture.
const ONE_PX_PNG_B64URL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII";

describe("collectAttachments", () => {
  it("returns [] for a payload with no attachments", () => {
    const out = collectAttachments({
      mimeType: "text/plain",
      body: { attachmentId: null, size: 0 },
    });
    expect(out).toEqual([]);
  });

  it("walks a nested multipart tree and surfaces every attachment part", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { size: 10 } },
            { mimeType: "text/html", body: { size: 20 } },
          ],
        },
        {
          mimeType: "application/pdf",
          filename: "report.pdf",
          body: { attachmentId: "att-1", size: 12345 },
        },
        {
          mimeType: "multipart/related",
          parts: [
            { mimeType: "text/html", body: { size: 30 } },
            {
              mimeType: "image/png",
              filename: "inline.png",
              body: { attachmentId: "att-2", size: 678 },
            },
          ],
        },
      ],
    };
    const out = collectAttachments(payload);
    expect(out).toEqual([
      {
        filename: "report.pdf",
        mime_type: "application/pdf",
        size_bytes: 12345,
        attachment_id: "att-1",
      },
      {
        filename: "inline.png",
        mime_type: "image/png",
        size_bytes: 678,
        attachment_id: "att-2",
      },
    ]);
  });
});

describe("base64UrlToBytes / bytesToStandardBase64", () => {
  it("round-trips an ASCII string through base64url decode + standard base64 encode", () => {
    // "hello" → "aGVsbG8=" (standard) → "aGVsbG8" (base64url, no padding)
    const bytes = base64UrlToBytes("aGVsbG8");
    expect(new TextDecoder().decode(bytes)).toBe("hello");
    expect(bytesToStandardBase64(bytes)).toBe("aGVsbG8=");
  });

  it("handles base64url-specific characters (- and _)", () => {
    // Bytes 0xfb 0xff → standard "+/8=" → base64url "-_8"
    const bytes = base64UrlToBytes("-_8");
    expect(Array.from(bytes)).toEqual([0xfb, 0xff]);
  });
});

describe("routeByMime", () => {
  it("returns an MCP image content block for image/png", async () => {
    const bytes = base64UrlToBytes(ONE_PX_PNG_B64URL);
    const result = await routeByMime(bytes, "image/png", "tiny.png");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.content).toHaveLength(1);
    const block = result.response.content[0]!;
    expect(block.type).toBe("image");
    if (block.type === "image") {
      expect(block.mimeType).toBe("image/png");
      // standard base64 → padded
      expect(block.data.endsWith("=") || block.data.length % 4 === 0).toBe(
        true,
      );
    }
  });

  it("decodes text/plain bytes as UTF-8 text", async () => {
    const bytes = new TextEncoder().encode("hello world");
    const result = await routeByMime(bytes, "text/plain", "note.txt");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const block = result.response.content[0]!;
    expect(block.type).toBe("text");
    if (block.type === "text") expect(block.text).toBe("hello world");
  });

  it("decodes application/json as text", async () => {
    const bytes = new TextEncoder().encode('{"a":1}');
    const result = await routeByMime(bytes, "application/json", "data.json");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const block = result.response.content[0]!;
    expect(block.type).toBe("text");
    if (block.type === "text") expect(block.text).toBe('{"a":1}');
  });

  it("returns a structured error for an unsupported MIME type", async () => {
    const result = await routeByMime(
      new Uint8Array([0, 1, 2]),
      "application/x-weird-binary",
      "weird.bin",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("Unsupported attachment MIME type");
    expect(result.message).toContain("application/x-weird-binary");
    expect(result.message).toContain("weird.bin");
  });
});

/**
 * Build a minimal McpServer-shaped stub that just captures `.tool()`
 * registrations so the test can invoke handlers directly.
 */
function buildServerStub() {
  const tools: Record<
    string,
    { description: string; handler: (args: unknown) => Promise<unknown> }
  > = {};
  const server = {
    tool(
      name: string,
      description: string,
      _schema: unknown,
      handler: (args: unknown) => Promise<unknown>,
    ) {
      tools[name] = { description, handler };
    },
  };
  return { server, tools };
}

function fakeGmail(overrides: {
  messageGet?: () => Promise<unknown>;
  attachmentGet?: () => Promise<unknown>;
}) {
  return {
    users: {
      messages: {
        get: vi.fn(overrides.messageGet ?? (async () => ({ data: {} }))),
        attachments: {
          get: vi.fn(
            overrides.attachmentGet ?? (async () => ({ data: { data: "" } })),
          ),
        },
      },
    },
  };
}

describe("registerAttachmentTools size guard", () => {
  const env: Env = {
    URL_SECRET: "x",
    GMAIL_CREDENTIALS: "x",
    GMAIL_OAUTH_KEYS: "x",
    GMAIL_ATTACHMENT_BYTE_CAP: "1024", // 1 KiB cap for the test
  };

  const oversizeAttachment: AttachmentMeta = {
    filename: "big.txt",
    mime_type: "text/plain",
    size_bytes: 5_000,
    attachment_id: "att-big",
  };

  function messageWithAttachment() {
    return {
      data: {
        payload: {
          mimeType: "multipart/mixed",
          parts: [
            {
              mimeType: oversizeAttachment.mime_type,
              filename: oversizeAttachment.filename,
              body: {
                attachmentId: oversizeAttachment.attachment_id,
                size: oversizeAttachment.size_bytes,
              },
            },
          ],
        },
      },
    };
  }

  it("refuses an oversize attachment when force is not true", async () => {
    const { server, tools } = buildServerStub();
    const gmail = fakeGmail({
      messageGet: async () => messageWithAttachment(),
      attachmentGet: async () => ({ data: { data: "aGVsbG8" } }),
    });
    registerAttachmentTools(
      server as unknown as Parameters<typeof registerAttachmentTools>[0],
      gmail as unknown as Parameters<typeof registerAttachmentTools>[1],
      env,
    );
    const out = (await tools.gmail_get_attachment!.handler({
      message_id: "m1",
      attachment_id: oversizeAttachment.attachment_id,
    })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain("exceeds the 1024-byte cap");
    // Attachment bytes should NOT have been fetched.
    expect(gmail.users.messages.attachments.get).not.toHaveBeenCalled();
  });

  it("proceeds with an oversize attachment when force=true", async () => {
    const { server, tools } = buildServerStub();
    const gmail = fakeGmail({
      messageGet: async () => messageWithAttachment(),
      // "aGVsbG8" decodes to "hello"
      attachmentGet: async () => ({ data: { data: "aGVsbG8" } }),
    });
    registerAttachmentTools(
      server as unknown as Parameters<typeof registerAttachmentTools>[0],
      gmail as unknown as Parameters<typeof registerAttachmentTools>[1],
      env,
    );
    const out = (await tools.gmail_get_attachment!.handler({
      message_id: "m1",
      attachment_id: oversizeAttachment.attachment_id,
      force: true,
    })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(out.isError).toBeUndefined();
    expect(out.content[0]!.type).toBe("text");
    expect(out.content[0]!.text).toBe("hello");
    expect(gmail.users.messages.attachments.get).toHaveBeenCalledTimes(1);
  });

  it("returns an error when the attachment_id is not found on the message", async () => {
    const { server, tools } = buildServerStub();
    const gmail = fakeGmail({
      messageGet: async () => messageWithAttachment(),
    });
    registerAttachmentTools(
      server as unknown as Parameters<typeof registerAttachmentTools>[0],
      gmail as unknown as Parameters<typeof registerAttachmentTools>[1],
      env,
    );
    const out = (await tools.gmail_get_attachment!.handler({
      message_id: "m1",
      attachment_id: "does-not-exist",
    })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain("not found on message");
  });
});

describe("gmail_list_attachments tool", () => {
  it("returns metadata for every attachment on the message", async () => {
    const { server, tools } = buildServerStub();
    const gmail = fakeGmail({
      messageGet: async () => ({
        data: {
          payload: {
            mimeType: "multipart/mixed",
            parts: [
              { mimeType: "text/plain", body: { size: 10 } },
              {
                mimeType: "application/pdf",
                filename: "doc.pdf",
                body: { attachmentId: "a1", size: 100 },
              },
            ],
          },
        },
      }),
    });
    const env: Env = {
      URL_SECRET: "x",
      GMAIL_CREDENTIALS: "x",
      GMAIL_OAUTH_KEYS: "x",
    };
    registerAttachmentTools(
      server as unknown as Parameters<typeof registerAttachmentTools>[0],
      gmail as unknown as Parameters<typeof registerAttachmentTools>[1],
      env,
    );
    const out = (await tools.gmail_list_attachments!.handler({
      message_id: "m1",
    })) as { content: Array<{ type: string; text: string }> };
    const payload = JSON.parse(out.content[0]!.text) as {
      message_id: string;
      attachments: AttachmentMeta[];
    };
    expect(payload.message_id).toBe("m1");
    expect(payload.attachments).toEqual([
      {
        filename: "doc.pdf",
        mime_type: "application/pdf",
        size_bytes: 100,
        attachment_id: "a1",
      },
    ]);
  });
});
