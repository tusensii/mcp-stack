import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { gmail_v1 } from "googleapis";
import { registerAttachmentTools } from "./attachments.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}>;

/**
 * Minimal fake of the `McpServer` surface `registerAttachmentTools` uses
 * (via `titledTool`): capture each registered tool's handler by name so tests can invoke it
 * directly, bypassing the MCP transport entirely.
 */
function fakeServer() {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _config: unknown, cb: ToolHandler) => {
      handlers.set(name, cb);
    },
  } as unknown as McpServer;
  return { server, handlers };
}

function fakeGmail(overrides: Partial<gmail_v1.Gmail["users"]["messages"]> = {}) {
  return {
    users: {
      messages: {
        get: vi.fn(),
        attachments: { get: vi.fn() },
        ...overrides,
      },
    },
  } as unknown as gmail_v1.Gmail;
}

describe("list_attachments", () => {
  it("returns metadata for top-level attachment parts", async () => {
    const gmail = fakeGmail();
    const { server, handlers } = fakeServer();
    registerAttachmentTools(server, gmail);

    (gmail.users.messages.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        payload: {
          mimeType: "multipart/mixed",
          parts: [
            { mimeType: "text/plain", body: { data: "aGk" } },
            {
              mimeType: "application/pdf",
              filename: "report.pdf",
              body: { attachmentId: "att-1", size: 12345 },
            },
          ],
        },
      },
    });

    const result = await handlers.get("list_attachments")!({ messageId: "msg-1" });
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed.messageId).toBe("msg-1");
    expect(parsed.attachments).toEqual([
      {
        attachmentId: "att-1",
        filename: "report.pdf",
        mimeType: "application/pdf",
        size: 12345,
      },
    ]);
    expect(gmail.users.messages.get).toHaveBeenCalledWith({
      userId: "me",
      id: "msg-1",
      format: "full",
    });
  });

  it("recurses into nested multipart/alternative parts to find attachments", async () => {
    const gmail = fakeGmail();
    const { server, handlers } = fakeServer();
    registerAttachmentTools(server, gmail);

    (gmail.users.messages.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        payload: {
          mimeType: "multipart/mixed",
          parts: [
            {
              mimeType: "multipart/alternative",
              parts: [
                { mimeType: "text/plain", body: { data: "aGk" } },
                { mimeType: "text/html", body: { data: "aGk" } },
              ],
            },
            {
              mimeType: "image/png",
              filename: "screenshot.png",
              body: { attachmentId: "att-2", size: 999 },
            },
          ],
        },
      },
    });

    const result = await handlers.get("list_attachments")!({ messageId: "msg-2" });
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]).toMatchObject({
      attachmentId: "att-2",
      filename: "screenshot.png",
    });
  });

  it("returns an empty array when the message has no attachments", async () => {
    const gmail = fakeGmail();
    const { server, handlers } = fakeServer();
    registerAttachmentTools(server, gmail);

    (gmail.users.messages.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { payload: { mimeType: "text/plain", body: { data: "aGk" } } },
    });

    const result = await handlers.get("list_attachments")!({ messageId: "msg-3" });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.attachments).toEqual([]);
  });

  it("returns errorContent on Gmail API failure", async () => {
    const gmail = fakeGmail();
    const { server, handlers } = fakeServer();
    registerAttachmentTools(server, gmail);

    (gmail.users.messages.get as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("401 Invalid Credentials"),
    );

    const result = await handlers.get("list_attachments")!({ messageId: "msg-4" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Gmail auth expired");
  });
});

describe("get_attachment", () => {
  it("fetches attachment bytes and returns base64url data verbatim with size", async () => {
    const gmail = fakeGmail();
    const { server, handlers } = fakeServer();
    registerAttachmentTools(server, gmail);

    const base64url = "SGVsbG8t_1234"; // contains '-' and '_' — must not be re-encoded
    (
      gmail.users.messages.attachments.get as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: { size: 42, data: base64url },
    });

    const result = await handlers.get("get_attachment")!({
      messageId: "msg-1",
      attachmentId: "att-1",
    });
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed).toEqual({
      messageId: "msg-1",
      attachmentId: "att-1",
      size: 42,
      data: base64url,
    });
    expect(gmail.users.messages.attachments.get).toHaveBeenCalledWith({
      userId: "me",
      messageId: "msg-1",
      id: "att-1",
    });
  });

  it("returns errorContent on Gmail API failure", async () => {
    const gmail = fakeGmail();
    const { server, handlers } = fakeServer();
    registerAttachmentTools(server, gmail);

    (
      gmail.users.messages.attachments.get as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error("429 Rate Limit Exceeded"));

    const result = await handlers.get("get_attachment")!({
      messageId: "msg-1",
      attachmentId: "att-1",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Gmail rate limited");
  });
});
