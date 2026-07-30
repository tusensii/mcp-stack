/**
 * Display-title tool registration. Wraps `McpServer.registerTool` so every
 * tool carries a human-readable, action-phrased display title (e.g.
 * "Reviewing sleep scores…") alongside its stable programmatic `name`.
 *
 * The MCP spec's display-name precedence is `title` > `annotations.title`
 * > `name`. Which field a given client actually renders varies, so we set
 * both to the same string; the programmatic name is never touched.
 */

import type {
  McpServer,
  RegisteredTool,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";

/** Register a tool with a display title and an input schema. */
export function titledTool<Args extends ZodRawShape>(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  inputSchema: Args,
  cb: ToolCallback<Args>,
): RegisteredTool;
/** Register a zero-argument tool with a display title. */
export function titledTool(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  cb: ToolCallback<undefined>,
): RegisteredTool;
export function titledTool(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  schemaOrCb: unknown,
  maybeCb?: unknown,
): RegisteredTool {
  if (typeof schemaOrCb === "function") {
    return server.registerTool(
      name,
      { title, description, annotations: { title } },
      schemaOrCb as ToolCallback<undefined>,
    );
  }
  return server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: schemaOrCb as ZodRawShape,
      annotations: { title },
    },
    // maybeCb is required by the overloads whenever a schema is passed.
    maybeCb as ToolCallback<ZodRawShape>,
  );
}
