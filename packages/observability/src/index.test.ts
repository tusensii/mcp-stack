import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger, redact } from "./index.js";

describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("is a no-op when neither env flag is set", () => {
    const log = logger({});
    log.info("should not appear");
    log.error("nope");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("emits structured JSON when DEBUG is 'true'", () => {
    const log = logger({ DEBUG: "true" });
    log.info("hello", { user: "alice" });
    expect(logSpy).toHaveBeenCalledOnce();
    const arg = logSpy.mock.calls[0]?.[0] as string;
    const entry = JSON.parse(arg) as { level: string; msg: string; fields: { user: string } };
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("hello");
    expect(entry.fields.user).toBe("alice");
  });

  it("ignores non-truthy values for the env flags", () => {
    const log = logger({ DEBUG: "1", OBSERVABILITY: "yes" });
    log.info("nope");
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("redact", () => {
  it("replaces sensitive field values regardless of case", () => {
    const out = redact({ Authorization: "Bearer xxx", Password: "hunter2", ok: "fine" });
    expect(out["Authorization"]).toBe("[REDACTED]");
    expect(out["Password"]).toBe("[REDACTED]");
    expect(out["ok"]).toBe("fine");
  });

  it("redacts email-shaped substrings inside string values", () => {
    const out = redact({ note: "ping user@example.com about the rollout" });
    expect(out["note"]).toBe("ping [email] about the rollout");
  });

  it("leaves non-string values alone", () => {
    const out = redact({ count: 42, ratio: 0.5, ok: true });
    expect(out["count"]).toBe(42);
    expect(out["ratio"]).toBe(0.5);
    expect(out["ok"]).toBe(true);
  });
});
