import { describe, it, expect, vi } from "vitest";
import { ensureLabelsExist, labelColorFor, type LabelLookupClient } from "./label-sync.js";
import { GitHubApiError } from "../github/client.js";

function stubClient(existingLabels: string[]): LabelLookupClient & {
  post: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn().mockResolvedValue(existingLabels.map((name) => ({ name }))),
    post: vi.fn().mockResolvedValue({}),
  };
}

describe("labelColorFor", () => {
  it("uses purple for app:* labels", () => {
    expect(labelColorFor("app:github-mcp")).toBe("5319e7");
  });

  it("is case-insensitive on the prefix", () => {
    expect(labelColorFor("APP:github-mcp")).toBe("5319e7");
  });

  it("uses blue for area:* labels", () => {
    expect(labelColorFor("area:docs")).toBe("1d76db");
  });

  it("uses blue for any other prefix:* label", () => {
    expect(labelColorFor("priority:high")).toBe("1d76db");
    expect(labelColorFor("type:bug")).toBe("1d76db");
  });

  it("uses grey for unprefixed labels", () => {
    expect(labelColorFor("bug")).toBe("ededed");
    expect(labelColorFor("enhancement")).toBe("ededed");
    expect(labelColorFor("claude-task")).toBe("ededed");
  });
});

describe("ensureLabelsExist", () => {
  it("returns empty and makes no calls when names is empty", async () => {
    const client = stubClient(["bug"]);
    const created = await ensureLabelsExist(client, "acme", "widgets", []);
    expect(created).toEqual([]);
    expect(client.get).not.toHaveBeenCalled();
    expect(client.post).not.toHaveBeenCalled();
  });

  it("creates nothing when all labels already exist", async () => {
    const client = stubClient(["bug", "app:github-mcp"]);
    const created = await ensureLabelsExist(client, "acme", "widgets", ["bug", "app:github-mcp"]);
    expect(created).toEqual([]);
    expect(client.post).not.toHaveBeenCalled();
  });

  it("matches existing labels case-insensitively", async () => {
    const client = stubClient(["Bug"]);
    const created = await ensureLabelsExist(client, "acme", "widgets", ["bug"]);
    expect(created).toEqual([]);
    expect(client.post).not.toHaveBeenCalled();
  });

  it("creates missing labels with the heuristic color and a standard description", async () => {
    const client = stubClient(["bug"]);
    const created = await ensureLabelsExist(client, "acme", "widgets", [
      "bug",
      "app:gmail-mcp-worker",
    ]);
    expect(created).toEqual(["app:gmail-mcp-worker"]);
    expect(client.post).toHaveBeenCalledTimes(1);
    expect(client.post).toHaveBeenCalledWith("/repos/acme/widgets/labels", {
      name: "app:gmail-mcp-worker",
      color: "5319e7",
      description: "Auto-created by github-mcp.",
    });
  });

  it("creates multiple missing labels and reports all of them", async () => {
    const client = stubClient([]);
    const created = await ensureLabelsExist(client, "acme", "widgets", [
      "app:oura-mcp",
      "area:docs",
      "claude-task",
    ]);
    expect(created.sort()).toEqual(["app:oura-mcp", "area:docs", "claude-task"].sort());
    expect(client.post).toHaveBeenCalledTimes(3);
  });

  it("treats a 422 'already exists' race on create as success, not an error", async () => {
    const client = stubClient([]);
    client.post.mockRejectedValueOnce(new GitHubApiError(422, "already_exists"));
    const created = await ensureLabelsExist(client, "acme", "widgets", ["bug"]);
    expect(created).toEqual([]);
  });

  it("rethrows non-422 errors from label creation", async () => {
    const client = stubClient([]);
    client.post.mockRejectedValueOnce(new GitHubApiError(403, "Forbidden"));
    await expect(ensureLabelsExist(client, "acme", "widgets", ["bug"])).rejects.toThrow(
      "Forbidden",
    );
  });
});
