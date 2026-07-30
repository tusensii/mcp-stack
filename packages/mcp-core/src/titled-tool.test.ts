import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { titledTool } from "./titled-tool.js";
import { textContent } from "./responses.js";

/**
 * Wire-level check: register tools through `titledTool`, list them over a
 * real client/server pair, and assert the display title arrives in both
 * `title` and `annotations.title` while `name` stays programmatic.
 */
async function listToolsFor(server: McpServer) {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  return { client, tools };
}

describe("titledTool", () => {
  it("exposes title and annotations.title over tools/list, keeping name", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    titledTool(
      server,
      "oura_daily_sleep",
      "Reviewing sleep scores…",
      "Returns daily sleep scores.",
      { start_date: z.string().optional() },
      async () => textContent("ok"),
    );

    const { tools } = await listToolsFor(server);
    expect(tools).toHaveLength(1);
    const tool = tools[0]!;
    expect(tool.name).toBe("oura_daily_sleep");
    expect(tool.title).toBe("Reviewing sleep scores…");
    expect(tool.annotations?.title).toBe("Reviewing sleep scores…");
    expect(tool.description).toBe("Returns daily sleep scores.");
    expect(tool.inputSchema.properties).toHaveProperty("start_date");
  });

  it("supports zero-argument tools registered without a schema", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    titledTool(
      server,
      "ping",
      "Pinging…",
      "Returns pong.",
      async () => textContent("pong"),
    );

    const { client, tools } = await listToolsFor(server);
    expect(tools[0]?.title).toBe("Pinging…");
    expect(tools[0]?.annotations?.title).toBe("Pinging…");

    const result = await client.callTool({ name: "ping", arguments: {} });
    expect(result.content).toEqual([{ type: "text", text: "pong" }]);
  });

  it("passes validated arguments through to the handler", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    titledTool(
      server,
      "echo",
      "Echoing…",
      "Echoes the message back.",
      { message: z.string() },
      async ({ message }) => textContent(message),
    );

    const { client } = await listToolsFor(server);
    const result = await client.callTool({ name: "echo", arguments: { message: "hi" } });
    expect(result.content).toEqual([{ type: "text", text: "hi" }]);
  });
});
