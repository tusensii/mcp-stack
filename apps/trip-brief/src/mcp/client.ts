/**
 * Thin MCP client over the deployed trip-mcp Worker.
 *
 * The build talks to the same server Claude.ai talks to, so a brief can never
 * disagree with what the tools return in chat. Every trip-mcp tool answers
 * with a JSON-encoded `ToolPayload<T>` in a single text content block; this
 * module unwraps that and preserves `sources` / `confidence` / `caveats` so
 * the provenance layer (#105) has something to tier on.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type Confidence = "high" | "medium" | "low";

export interface Source {
  url: string;
  name: string;
  fetched_at: string;
  freshness_seconds_old?: number;
  license?: string;
  confidence?: Confidence;
}

export interface ToolPayload<T> {
  data: T | null;
  sources: Source[];
  confidence: Confidence;
  caveats: string[];
}

export class TripMcpError extends Error {
  constructor(
    message: string,
    readonly tool: string,
  ) {
    super(message);
    this.name = "TripMcpError";
  }
}

/**
 * Resolve the endpoint from the environment. `TRIP_MCP_URL` wins; otherwise
 * assemble it from origin + path secret, matching `createMcpWorker`'s
 * `/s/<secret>/mcp` route.
 */
export function resolveEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const direct = env.TRIP_MCP_URL?.trim();
  if (direct) return direct;

  const origin = env.TRIP_MCP_ORIGIN?.trim();
  const secret = env.TRIP_MCP_PATH_SECRET?.trim();
  if (origin && secret) {
    return `${origin.replace(/\/+$/, "")}/s/${secret}/mcp`;
  }
  throw new TripMcpError(
    "No trip-mcp endpoint configured. Set TRIP_MCP_URL to the full " +
      "https://<worker>/s/<path-secret>/mcp URL, or set TRIP_MCP_ORIGIN and " +
      "TRIP_MCP_PATH_SECRET.",
    "(connect)",
  );
}

export interface TripMcpClientOptions {
  endpoint?: string;
  /** Per-call timeout in ms. */
  timeoutMs?: number;
  /** Attempts per call, including the first. */
  attempts?: number;
  onLog?: (message: string) => void;
}

export class TripMcpClient {
  #client: Client | null = null;
  #transport: StreamableHTTPClientTransport | null = null;
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #attempts: number;
  readonly #onLog: (message: string) => void;

  constructor(opts: TripMcpClientOptions = {}) {
    this.#endpoint = opts.endpoint ?? resolveEndpoint();
    this.#timeoutMs = opts.timeoutMs ?? 120_000;
    this.#attempts = Math.max(1, opts.attempts ?? 3);
    this.#onLog = opts.onLog ?? (() => {});
  }

  async connect(): Promise<void> {
    if (this.#client) return;
    const transport = new StreamableHTTPClientTransport(new URL(this.#endpoint));
    const client = new Client(
      { name: "trip-brief", version: "0.1.0" },
      { capabilities: {} },
    );
    await client.connect(transport);
    this.#client = client;
    this.#transport = transport;
  }

  async close(): Promise<void> {
    await this.#client?.close();
    await this.#transport?.close();
    this.#client = null;
    this.#transport = null;
  }

  /**
   * Call a trip-mcp tool and return its `ToolPayload`.
   *
   * Transport-level failures are retried with backoff; a tool that answers
   * with `data: null` is a legitimate empty result, not an error, and comes
   * back for the caller to tier and caveat.
   */
  async call<T>(tool: string, args: Record<string, unknown>): Promise<ToolPayload<T>> {
    await this.connect();
    const client = this.#client!;

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.#attempts; attempt++) {
      try {
        const result = await client.callTool(
          { name: tool, arguments: args },
          undefined,
          { timeout: this.#timeoutMs },
        );

        const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
        const text = content.find((c) => c.type === "text")?.text;
        if (!text) {
          throw new TripMcpError(`${tool} returned no text content`, tool);
        }
        if (result.isError) {
          throw new TripMcpError(`${tool} reported an error: ${text.slice(0, 400)}`, tool);
        }

        let payload: ToolPayload<T>;
        try {
          payload = JSON.parse(text) as ToolPayload<T>;
        } catch {
          throw new TripMcpError(
            `${tool} returned non-JSON content: ${text.slice(0, 200)}`,
            tool,
          );
        }
        return normalizePayload(payload);
      } catch (err) {
        lastError = err;
        if (attempt === this.#attempts) break;
        const backoffMs = 500 * 2 ** (attempt - 1);
        this.#onLog(
          `${tool} failed (attempt ${attempt}/${this.#attempts}): ${
            (err as Error).message
          } — retrying in ${backoffMs}ms`,
        );
        await sleep(backoffMs);
      }
    }
    throw new TripMcpError(
      `${tool} failed after ${this.#attempts} attempts: ${(lastError as Error)?.message}`,
      tool,
    );
  }
}

/** Defend against a tool that omits an optional envelope field. */
export function normalizePayload<T>(payload: ToolPayload<T>): ToolPayload<T> {
  return {
    data: payload?.data ?? null,
    sources: Array.isArray(payload?.sources) ? payload.sources : [],
    confidence: payload?.confidence ?? "low",
    caveats: Array.isArray(payload?.caveats) ? payload.caveats : [],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
