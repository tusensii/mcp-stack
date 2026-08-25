import { describe, expect, it, vi } from "vitest";
import { cached } from "./cache.js";
import type { Env } from "./types.js";

/** Minimal in-memory stand-in for the KV binding. */
function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => {
      const hit = store.get(key);
      return hit === undefined ? null : JSON.parse(hit);
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

function envWith(kv: ReturnType<typeof fakeKv>): Env {
  return { CACHE: kv } as unknown as Env;
}

describe("cached", () => {
  it("stores and returns a fresh value", async () => {
    const kv = fakeKv();
    const value = await cached(envWith(kv), "k", 60, async () => ({ n: 1 }));
    expect(value).toEqual({ n: 1 });
    expect(kv.put).toHaveBeenCalledOnce();
  });

  it("serves a hit without calling the producer again", async () => {
    const kv = fakeKv();
    const producer = vi.fn(async () => ({ n: 1 }));
    await cached(envWith(kv), "k", 60, producer);
    await cached(envWith(kv), "k", 60, producer);
    expect(producer).toHaveBeenCalledOnce();
  });

  it("calls the producer every time when there is no KV binding", async () => {
    const producer = vi.fn(async () => ({ n: 1 }));
    const env = {} as Env;
    await cached(env, "k", 60, producer);
    await cached(env, "k", 60, producer);
    expect(producer).toHaveBeenCalledTimes(2);
  });

  // #93 — caching an upstream failure pins it for the full TTL, which is how
  // one Overpass timeout became a week of authoritative-looking zeros.
  it("does not persist a value the caller marks uncacheable", async () => {
    const kv = fakeKv();
    const value = await cached(
      envWith(kv),
      "k",
      604_800,
      async () => ({ ok: false }),
      { skipCache: (v) => !v.ok },
    );
    expect(value).toEqual({ ok: false });
    expect(kv.put).not.toHaveBeenCalled();
    expect(kv.store.size).toBe(0);
  });

  it("still persists a value that passes the skip predicate", async () => {
    const kv = fakeKv();
    await cached(envWith(kv), "k", 60, async () => ({ ok: true }), {
      skipCache: (v) => !v.ok,
    });
    expect(kv.put).toHaveBeenCalledOnce();
  });

  it("retries the producer after a skipped write rather than serving nothing", async () => {
    const kv = fakeKv();
    const producer = vi
      .fn<() => Promise<{ ok: boolean }>>()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    const skipCache = (v: { ok: boolean }) => !v.ok;

    const first = await cached(envWith(kv), "k", 60, producer, { skipCache });
    const second = await cached(envWith(kv), "k", 60, producer, { skipCache });

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    expect(producer).toHaveBeenCalledTimes(2);
  });
});
