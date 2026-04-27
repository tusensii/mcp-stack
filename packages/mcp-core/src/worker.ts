/**
 * `createMcpWorker` — a Cloudflare Worker `fetch` handler that does the
 * URL path-secret check, then delegates to `agents/mcp`'s
 * `createMcpHandler`. Every app's `src/index.ts` becomes a four-line file:
 *
 * ```ts
 * import { createMcpWorker } from "@mcp-stack/mcp-core";
 * import { buildServer } from "./server.js";
 * export default {
 *   fetch: createMcpWorker({ buildServer, secretEnvKey: "MCP_PATH_SECRET" }),
 * };
 * ```
 *
 * URL pattern: `/s/<path-secret>/mcp` (or `/mcp/<sub>`). The secret is
 * compared in constant time against `env[secretEnvKey]`, which must be
 * at least 16 characters or the handler fails closed with 500.
 */

import { createMcpHandler } from "agents/mcp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { safeCompare } from "./safe-compare.js";

export interface CreateMcpWorkerOptions<E extends object> {
  /**
   * Per-request factory that returns a configured `McpServer`.
   * Apps register tools here.
   */
  buildServer: (env: E) => McpServer;
  /**
   * Env key holding the URL path secret. Must resolve to a string of
   * at least 16 characters at runtime.
   */
  secretEnvKey: keyof E & string;
  /**
   * Sub-route the SDK handler is mounted under (default `"/mcp"`).
   * The SDK matches against the rewritten URL after the `/s/<secret>/`
   * prefix is stripped.
   */
  route?: string;
  /** Optional CORS configuration forwarded to the SDK handler. */
  corsOptions?: { origin?: string };
}

type WorkerHandler<E> = (
  req: Request,
  env: E,
  ctx: ExecutionContext,
) => Promise<Response>;

export function createMcpWorker<E extends object>(
  options: CreateMcpWorkerOptions<E>,
): WorkerHandler<E> {
  const { buildServer, secretEnvKey, route = "/mcp", corsOptions } = options;

  return async (req, env, ctx) => {
    const secret = (env as Record<string, unknown>)[secretEnvKey];
    if (typeof secret !== "string" || secret.length < 16) {
      return new Response(null, { status: 500 });
    }

    const url = new URL(req.url);
    if (!url.pathname.startsWith("/s/")) return new Response(null, { status: 404 });
    const segments = url.pathname.split("/");
    if (segments.length < 4) return new Response(null, { status: 404 });
    const provided = segments[2];
    if (!provided || !safeCompare(provided, secret)) {
      return new Response(null, { status: 404 });
    }

    const sub = "/" + segments.slice(3).join("/");
    const rewrittenUrl = new URL(sub, url.origin).toString() + url.search;
    const rewritten = new Request(rewrittenUrl, req);

    const server = buildServer(env);
    const handler = createMcpHandler(server, {
      route,
      ...(corsOptions ? { corsOptions } : {}),
    }) as WorkerHandler<E>;
    return handler(rewritten, env, ctx);
  };
}
