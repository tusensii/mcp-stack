import { describe, it, expect } from "vitest";
import type { GitHubClient } from "../github/client.js";
import { ensureLabelsExist, pickAutoLabelColor, preflightLabels } from "./labels.js";

interface PostCall {
  path: string;
  body: unknown;
}

function makeMockClient(existing: string[]): {
  client: GitHubClient;
  posts: PostCall[];
} {
  const posts: PostCall[] = [];
  const repoLabels = existing.map((name) => ({ name }));
  const mock = {
    async get<T>(_path: string, _params?: unknown): Promise<T> {
      // Single page, less than 100 → ensureLabelsExist's loop exits after one iteration.
      return repoLabels as unknown as T;
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      posts.push({ path, body });
      return (body as { name: string }) as unknown as T;
    },
  };
  return {
    client: mock as unknown as GitHubClient,
    posts,
  };
}

describe("pickAutoLabelColor", () => {
  it("app:* prefix → purple", () => {
    expect(pickAutoLabelColor("app:github-mcp")).toBe("5319e7");
    expect(pickAutoLabelColor("app:foo")).toBe("5319e7");
  });

  it("area:* prefix → green", () => {
    expect(pickAutoLabelColor("area:auth")).toBe("0e8a16");
  });

  it("other recognized prefix → yellow", () => {
    expect(pickAutoLabelColor("kind:cleanup")).toBe("fbca04");
    expect(pickAutoLabelColor("priority:high")).toBe("fbca04");
  });

  it("no prefix → neutral grey", () => {
    expect(pickAutoLabelColor("bug")).toBe("ededed");
    expect(pickAutoLabelColor("enhancement")).toBe("ededed");
    expect(pickAutoLabelColor("random")).toBe("ededed");
  });
});

describe("ensureLabelsExist", () => {
  it("returns empty missing when all labels exist", async () => {
    const { client, posts } = makeMockClient(["bug", "enhancement", "claude-task"]);
    const result = await ensureLabelsExist(
      client,
      "owner",
      "repo",
      ["bug", "claude-task"],
      { create: false },
    );
    expect(result.missing).toEqual([]);
    expect(result.created).toEqual([]);
    expect(posts).toHaveLength(0);
  });

  it("returns missing names when create=false and labels are absent", async () => {
    const { client, posts } = makeMockClient(["bug"]);
    const result = await ensureLabelsExist(
      client,
      "owner",
      "repo",
      ["bug", "app:new-app", "random-missing"],
      { create: false },
    );
    expect(result.missing).toEqual(["app:new-app", "random-missing"]);
    expect(result.created).toEqual([]);
    expect(posts).toHaveLength(0);
  });

  it("auto-creates missing labels with color heuristic when create=true", async () => {
    const { client, posts } = makeMockClient(["bug"]);
    const result = await ensureLabelsExist(
      client,
      "owner",
      "repo",
      ["bug", "app:foo", "area:bar", "random"],
      { create: true },
    );
    expect(result.missing).toEqual([]);
    expect(result.created).toEqual(["app:foo", "area:bar", "random"]);
    expect(posts).toHaveLength(3);
    expect(posts[0]).toEqual({
      path: "/repos/owner/repo/labels",
      body: {
        name: "app:foo",
        color: "5319e7",
        description: "Auto-created by github-mcp.",
      },
    });
    expect(posts[1]?.body).toMatchObject({ name: "area:bar", color: "0e8a16" });
    expect(posts[2]?.body).toMatchObject({ name: "random", color: "ededed" });
  });

  it("no-ops when label list is empty (does not even fetch)", async () => {
    const { client, posts } = makeMockClient(["bug"]);
    const result = await ensureLabelsExist(client, "owner", "repo", [], { create: true });
    expect(result.missing).toEqual([]);
    expect(result.created).toEqual([]);
    expect(posts).toHaveLength(0);
  });
});

describe("preflightLabels", () => {
  it("returns ok when all labels exist", async () => {
    const { client } = makeMockClient(["bug", "claude-task"]);
    const result = await preflightLabels(client, "o", "r", ["bug", "claude-task"], false);
    expect("ok" in result && result.ok).toBe(true);
  });

  it("returns structured error naming missing labels when create_missing_labels=false", async () => {
    const { client } = makeMockClient(["bug"]);
    const result = await preflightLabels(
      client,
      "o",
      "r",
      ["bug", "app:ghost", "lost"],
      false,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.isError).toBe(true);
      const text = result.error.content[0]?.text ?? "";
      expect(text).toContain("app:ghost");
      expect(text).toContain("lost");
      expect(text).toContain("create_missing_labels");
    }
  });

  it("returns ok and creates labels when create_missing_labels=true", async () => {
    const { client, posts } = makeMockClient([]);
    const result = await preflightLabels(client, "o", "r", ["app:foo"], true);
    expect("ok" in result && result.ok).toBe(true);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ name: "app:foo", color: "5319e7" });
  });

  it("returns ok with empty created list when labels array is empty", async () => {
    const { client, posts } = makeMockClient(["bug"]);
    const result = await preflightLabels(client, "o", "r", [], false);
    expect("ok" in result && result.ok).toBe(true);
    if ("ok" in result) expect(result.created).toEqual([]);
    expect(posts).toHaveLength(0);
  });
});
