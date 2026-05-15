/**
 * Smoke tests for the RIDB client. Network calls are stubbed via `it.todo`
 * — this file just verifies the module parses and exports the expected
 * surface so we catch type regressions in CI without hitting recreation.gov.
 */

import { describe, expect, it } from "vitest";
import * as ridb from "./ridb.js";

describe("sources/ridb", () => {
  it("exports the expected functions", () => {
    expect(typeof ridb.searchPermits).toBe("function");
    expect(typeof ridb.getPermit).toBe("function");
    expect(typeof ridb.getPermitAvailability).toBe("function");
    expect(typeof ridb.getCampgroundAvailability).toBe("function");
  });

  it.todo("searchPermits returns merged permits + facilities for a known query");
  it.todo("getPermit returns a single record when RIDB wraps in RECDATA[]");
  it.todo("getPermit returns ok=false with status=404 for unknown ids");
  it.todo("getPermitAvailability falls back to recreation.gov month endpoint when RIDB 404s");
  it.todo("getCampgroundAvailability falls back to recreation.gov month endpoint");
  it.todo("safeJson maps 401/403 to ridb_auth_failed and 429 to ridb_rate_limited");
});
