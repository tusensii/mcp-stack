import { describe, expect, it, vi } from "vitest";
import { LinkVerificationError, linkDisposition, verifyLinks } from "./links.ts";

function fakeFetch(routes: Record<string, { status: number; url?: string }>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes[url];
    if (!route) throw new Error(`getaddrinfo ENOTFOUND ${url}`);
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      url: route.url ?? url,
    } as Response;
  }) as unknown as typeof fetch;
}

const GOOD = "https://www.recreation.gov/permits/4098362";
const DEAD = "https://www.example.org/gone";

describe("verifyLinks", () => {
  it("passes reachable URLs", async () => {
    const verdicts = await verifyLinks([GOOD], {
      mode: "fail",
      fetchImpl: fakeFetch({ [GOOD]: { status: 200 } }),
    });
    expect(verdicts.get(GOOD)).toMatchObject({ ok: true, verified: true, status: 200 });
  });

  it("aborts the build in fail mode, naming the URL", async () => {
    await expect(
      verifyLinks([GOOD, DEAD], {
        mode: "fail",
        fetchImpl: fakeFetch({ [GOOD]: { status: 200 }, [DEAD]: { status: 404 } }),
      }),
    ).rejects.toThrow(LinkVerificationError);

    try {
      await verifyLinks([DEAD], {
        mode: "fail",
        fetchImpl: fakeFetch({ [DEAD]: { status: 404 } }),
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as LinkVerificationError).failures).toHaveLength(1);
      expect((err as Error).message).toContain(DEAD);
      expect((err as Error).message).toContain("HTTP 404");
    }
  });

  it("degrades to plain text in warn mode instead of aborting", async () => {
    const verdicts = await verifyLinks([DEAD], {
      mode: "warn",
      fetchImpl: fakeFetch({ [DEAD]: { status: 404 } }),
    });
    expect(verdicts.get(DEAD)?.ok).toBe(false);
    expect(linkDisposition(DEAD, verdicts).render).toBe("text");
  });

  it("marks everything unverified in skip mode without fetching", async () => {
    const fetchImpl = fakeFetch({});
    const verdicts = await verifyLinks([GOOD, DEAD], { mode: "skip", fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(verdicts.get(GOOD)).toEqual({ url: GOOD, ok: true, verified: false });
  });

  // A fair number of agency endpoints reject HEAD but serve GET.
  it("retries a method-rejected HEAD as a ranged GET", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      const status = init?.method === "HEAD" ? 405 : 206;
      return { ok: status >= 200 && status < 300, status, url: GOOD } as Response;
    }) as unknown as typeof fetch;

    const verdicts = await verifyLinks([GOOD], { mode: "fail", fetchImpl });
    expect(calls).toBe(2);
    expect(verdicts.get(GOOD)?.ok).toBe(true);
  });

  it("records the redirect target so the report cites where it landed", async () => {
    const verdicts = await verifyLinks([GOOD], {
      mode: "fail",
      fetchImpl: fakeFetch({ [GOOD]: { status: 200, url: `${GOOD}/overview` } }),
    });
    expect(verdicts.get(GOOD)?.final_url).toBe(`${GOOD}/overview`);
  });

  it("treats a network error as a failure, not a pass", async () => {
    const verdicts = await verifyLinks([DEAD], { mode: "warn", fetchImpl: fakeFetch({}) });
    expect(verdicts.get(DEAD)?.ok).toBe(false);
    expect(verdicts.get(DEAD)?.reason).toContain("ENOTFOUND");
  });
});

describe("linkDisposition", () => {
  it("never renders an anchor for a URL that was not submitted", () => {
    const { render, verdict } = linkDisposition("https://unknown.example/", new Map());
    expect(render).toBe("text");
    expect(verdict.reason).toContain("not submitted");
  });
});
