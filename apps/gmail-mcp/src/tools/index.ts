import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { gmail_v1 } from "googleapis";
import { registerLabelTools } from "./labels.js";
import { registerEmailTools } from "./email.js";
import { registerComposeTools } from "./compose.js";
import { registerModifyTools } from "./modify.js";
import { registerDeleteTools } from "./delete.js";
import { registerFilterTools } from "./filters.js";
import { registerAttachmentTools } from "./attachments.js";
import type { Env } from "../types.js";

/**
 * Wire every Gmail tool onto an `McpServer`. Tool registration is split
 * into modules by Gmail API surface (labels, email, compose, modify,
 * delete, filters); each `register*Tools` call adds its tools onto the
 * server.
 *
 * The `gmail` client is built once per request in `server.ts` and passed
 * in here so handlers can be plain closures rather than re-instantiating
 * the OAuth client per call.
 */
export function registerAllTools(
  server: McpServer,
  gmail: gmail_v1.Gmail,
  env: Env,
): void {
  registerLabelTools(server, gmail);
  registerEmailTools(server, gmail);
  registerComposeTools(server, gmail);
  registerModifyTools(server, gmail);
  registerDeleteTools(server, gmail);
  registerFilterTools(server, gmail);
  registerAttachmentTools(server, gmail, env);
}
