/**
 * Thin shared layer over `@modelcontextprotocol/sdk` and Cloudflare's
 * `agents` package. Apps register tools with `McpServer` from the SDK
 * directly (using their own Zod schemas); `mcp-core` only owns the
 * cross-cutting concerns: URL path-secret check, tool-response shape,
 * display-title registration (`titledTool`), and a small set of error
 * classes for the auth packages to throw.
 *
 * The Workers-only `createMcpWorker` lives at the `/worker` subpath
 * so that loading `@mcp-stack/mcp-core` in Node (for tests, build
 * tools, etc.) doesn't trigger `cloudflare:`-scheme imports from the
 * `agents` package.
 */

export { safeCompare } from "./safe-compare.js";
export {
  textContent,
  errorContent,
  formatToolError,
  multiContent,
  type McpToolResponse,
  type ToolContentItem,
} from "./responses.js";
export { AuthExpired, RateLimited } from "./errors.js";
export { titledTool } from "./titled-tool.js";
