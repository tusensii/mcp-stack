/**
 * Build-time link verification (#105).
 *
 * The rule that emerged in chat — every URL verified against a live result
 * before it enters the report — becomes a build step. Nothing gets rendered
 * as a tappable link on the strength of the generator remembering it.
 */

import type { ProvenancePolicy } from "../config/schema.ts";

export interface LinkVerdict {
  url: string;
  /** Whether the URL may render as a live link. */
  ok: boolean;
  /** False when verification was skipped rather than passed. */
  verified: boolean;
  status?: number;
  /** Set when the server redirected; the report cites where it landed. */
  final_url?: string;
  reason?: string;
}

export class LinkVerificationError extends Error {
  constructor(
    message: string,
    readonly failures: LinkVerdict[],
  ) {
    super(message);
    this.name = "LinkVerificationError";
  }
}

export interface VerifyOptions {
  mode: ProvenancePolicy["link_check"];
  timeoutMs?: number;
  concurrency?: number;
  onLog?: (message: string) => void;
  /** Injection seam for tests. */
  fetchImpl?: typeof fetch;
}

const USER_AGENT = "trip-brief/0.1 (+https://github.com/tusensii/mcp-stack)";

async function probe(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<LinkVerdict> {
  // HEAD first: cheap, and most agency sites answer it. A fair number of
  // rec.gov / USFS endpoints reject HEAD with 403/405 while serving GET fine,
  // so a rejection on method is retried as a ranged GET rather than believed.
  for (const method of ["HEAD", "GET"] as const) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method,
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT,
          ...(method === "GET" ? { range: "bytes=0-2047" } : {}),
        },
      });
      const verdict: LinkVerdict = {
        url,
        ok: res.ok || res.status === 206,
        verified: true,
        status: res.status,
        ...(res.url && res.url !== url ? { final_url: res.url } : {}),
      };
      if (verdict.ok) return verdict;
      const methodRejected = res.status === 403 || res.status === 405 || res.status === 501;
      if (method === "HEAD" && methodRejected) continue;
      return { ...verdict, reason: `HTTP ${res.status}` };
    } catch (err) {
      clearTimeout(timer);
      if (method === "GET") {
        const reason = (err as Error).name === "AbortError"
          ? `timed out after ${timeoutMs}ms`
          : (err as Error).message;
        return { url, ok: false, verified: true, reason };
      }
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  return { url, ok: false, verified: true, reason: "unreachable" };
}

/**
 * Verify a set of URLs, returning a verdict per URL.
 *
 * In `fail` mode any bad URL aborts the build. In `warn` mode bad URLs come
 * back with `ok: false` so the renderer degrades them to plain text. In `skip`
 * mode nothing is fetched and every verdict is marked unverified — the
 * renderer treats unverified-by-policy as renderable, since the operator has
 * said so, but the report still records that no check ran.
 */
export async function verifyLinks(
  urls: Iterable<string>,
  opts: VerifyOptions,
): Promise<Map<string, LinkVerdict>> {
  const unique = [...new Set(urls)].filter(Boolean).sort();
  const results = new Map<string, LinkVerdict>();

  if (opts.mode === "skip") {
    for (const url of unique) results.set(url, { url, ok: true, verified: false });
    return results;
  }

  const timeoutMs = opts.timeoutMs ?? 15_000;
  const concurrency = Math.max(1, opts.concurrency ?? 6);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const log = opts.onLog ?? (() => {});

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < unique.length) {
      const url = unique[cursor++]!;
      const verdict = await probe(url, timeoutMs, fetchImpl);
      results.set(url, verdict);
      if (!verdict.ok) log(`link failed: ${url} — ${verdict.reason ?? "unknown"}`);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, unique.length) }, () => worker()),
  );

  const failures = unique
    .map((u) => results.get(u)!)
    .filter((v) => !v.ok);

  if (failures.length && opts.mode === "fail") {
    const detail = failures
      .map((f) => `  ${f.url} — ${f.reason ?? "unknown"}`)
      .join("\n");
    throw new LinkVerificationError(
      `${failures.length} link(s) failed verification and \`provenance.link_check\` ` +
        `is "fail":\n${detail}\n` +
        `Fix or remove the URLs, or set \`provenance.link_check\` to "warn" to render ` +
        `them as plain text instead.`,
      failures,
    );
  }
  return results;
}

/**
 * Renderable form of a link after verification.
 *   anchor — verified reachable, render as <a>
 *   text   — failed verification under `warn`, render as plain text with a marker
 */
export function linkDisposition(
  url: string,
  verdicts: Map<string, LinkVerdict>,
): { render: "anchor" | "text"; verdict: LinkVerdict } {
  const verdict = verdicts.get(url) ?? {
    url,
    ok: false,
    verified: false,
    reason: "not submitted for verification",
  };
  return { render: verdict.ok ? "anchor" : "text", verdict };
}
