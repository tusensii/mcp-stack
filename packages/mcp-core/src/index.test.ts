import { describe, it, expect } from "vitest";
import {
  safeCompare,
  textContent,
  errorContent,
  formatToolError,
  AuthExpired,
  RateLimited,
} from "./index.js";

describe("safeCompare", () => {
  it("returns true for equal strings", () => {
    expect(safeCompare("abc123def456ghi789", "abc123def456ghi789")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(safeCompare("abc123def456ghi789", "xyz123def456ghi789")).toBe(false);
  });

  it("returns false for strings of different lengths without leaking", () => {
    expect(safeCompare("short", "muchlongerstringhere")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(safeCompare("", "")).toBe(true);
  });
});

describe("textContent", () => {
  it("passes strings through verbatim", () => {
    expect(textContent("hello")).toEqual({ content: [{ type: "text", text: "hello" }] });
  });

  it("pretty-prints objects as JSON", () => {
    const out = textContent({ ok: true });
    expect(out.content[0]?.text).toBe('{\n  "ok": true\n}');
  });
});

describe("errorContent", () => {
  it("flags responses with isError: true", () => {
    expect(errorContent("nope")).toEqual({
      content: [{ type: "text", text: "nope" }],
      isError: true,
    });
  });
});

describe("formatToolError", () => {
  it("recognizes AuthExpired with a default message", () => {
    expect(formatToolError(new AuthExpired())).toMatch(/expired/i);
  });

  it("recognizes RateLimited with a Retry-After hint when present", () => {
    expect(formatToolError(new RateLimited(30))).toMatch(/30s/);
    expect(formatToolError(new RateLimited())).toMatch(/rate limited/i);
  });

  it("falls back to error.message for unknown errors", () => {
    expect(formatToolError(new Error("kaboom"))).toBe("kaboom");
  });

  it("stringifies non-Error throws", () => {
    expect(formatToolError("oops")).toBe("oops");
  });
});
