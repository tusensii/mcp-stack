import type { ToolPayload } from "../types.js";
export { textContent, errorContent, formatToolError } from "@mcp-stack/mcp-core";

/** Wrap a ToolPayload as the JSON body of a text MCP response. */
export function payloadResponse<T>(payload: ToolPayload<T>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

export function userAgent(contact: string): string {
  return `pnw-trip-mcp/0.1 (${contact})`;
}

/** Round a coordinate for cache-key stability. 4 decimals = ~11m. */
export function roundCoord(n: number, decimals = 4): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysFromNowIso(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}
