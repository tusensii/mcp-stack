/**
 * Shared types for the PNW trip-research MCP. Every tool returns a
 * `ToolPayload<T>` so Claude has a uniform shape for citing sources
 * and surfacing source-quality.
 */

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

export interface BoundingBox {
  /** [minLon, minLat, maxLon, maxLat] */
  bbox: [number, number, number, number];
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface DateRange {
  start: string;
  end: string;
}

export interface Env {
  MCP_PATH_SECRET: string;
  RIDB_API_KEY: string;
  NPS_API_KEY: string;
  WSDOT_API_KEY: string;
  /** UA contact email or URL — required by NWS, polite for everywhere else. */
  CONTACT: string;
  /** Optional KV cache binding. */
  CACHE?: KVNamespace;
  /** Optional Brave Search API key for web_research; tool degrades gracefully if missing. */
  BRAVE_API_KEY?: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeSource(
  url: string,
  name: string,
  opts: { license?: string; confidence?: Confidence; fetched_at?: string } = {},
): Source {
  return {
    url,
    name,
    fetched_at: opts.fetched_at ?? nowIso(),
    license: opts.license,
    confidence: opts.confidence,
  };
}

export function ok<T>(
  data: T,
  sources: Source[],
  confidence: Confidence = "high",
  caveats: string[] = [],
): ToolPayload<T> {
  return { data, sources, confidence, caveats };
}

export function empty<T>(caveats: string[], sources: Source[] = []): ToolPayload<T> {
  return { data: null, sources, confidence: "low", caveats };
}
