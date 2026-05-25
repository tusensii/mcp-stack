import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GitHubClient } from "../github/client.js";
import { resolveRepo, handleError, textContent, errorContent } from "./utils.js";
import type { McpToolResponse } from "@mcp-stack/mcp-core";

const repoArg = z
  .string()
  .optional()
  .describe("Target repo as 'owner/name'. Falls back to GITHUB_DEFAULT_REPO when omitted.");

const colorArg = z
  .string()
  .regex(/^#?[0-9a-fA-F]{6}$/, "color must be a 6-digit hex string (leading # optional)")
  .describe("6-digit hex color, e.g. 'ededed' (leading # accepted but stripped).");

function normalizeColor(c: string): string {
  return c.startsWith("#") ? c.slice(1) : c;
}

/**
 * Color heuristic for auto-created labels. The `app:*` prefix is the
 * established convention for app-scoping labels in this repo and gets
 * the canonical purple. Other recognized prefixes get a sensible default;
 * unprefixed labels get neutral grey.
 */
export function pickAutoLabelColor(name: string): string {
  if (name.startsWith("app:")) return "5319e7"; // purple
  if (name.startsWith("area:")) return "0e8a16"; // green
  // any other prefix (e.g. `kind:`, `priority:`, …)
  if (/^[a-z0-9_-]+:/i.test(name)) return "fbca04"; // yellow
  return "ededed"; // neutral grey
}

const AUTO_LABEL_DESCRIPTION = "Auto-created by github-mcp.";

interface RepoLabel {
  name: string;
}

/**
 * Ensure every name in `labels` exists on the target repo. Returns the
 * subset that was missing at the time of the check. When `create` is true,
 * missing labels are POSTed before returning (with the color heuristic
 * and a generic auto-created description).
 */
export async function ensureLabelsExist(
  client: GitHubClient,
  owner: string,
  repo: string,
  labels: readonly string[],
  opts: { create: boolean },
): Promise<{ missing: string[]; created: string[] }> {
  if (labels.length === 0) return { missing: [], created: [] };

  // Page through repo labels. 100/page is the API max.
  const existing = new Set<string>();
  for (let page = 1; ; page++) {
    const batch = await client.get<RepoLabel[]>(`/repos/${owner}/${repo}/labels`, {
      per_page: 100,
      page,
    });
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const l of batch) existing.add(l.name);
    if (batch.length < 100) break;
  }

  const missing = labels.filter((n) => !existing.has(n));
  if (missing.length === 0 || !opts.create) {
    return { missing, created: [] };
  }

  const created: string[] = [];
  for (const name of missing) {
    await client.post<unknown>(`/repos/${owner}/${repo}/labels`, {
      name,
      color: pickAutoLabelColor(name),
      description: AUTO_LABEL_DESCRIPTION,
    });
    created.push(name);
  }
  return { missing: [], created };
}

/**
 * Shared pre-flight for tools that send a `labels` array to GitHub.
 * Returns `{ ok: true }` if all labels exist (or were just created);
 * otherwise returns a tool-shaped error response naming the missing labels.
 */
export async function preflightLabels(
  client: GitHubClient,
  owner: string,
  repo: string,
  labels: readonly string[],
  createMissing: boolean,
): Promise<{ ok: true; created: string[] } | { error: McpToolResponse }> {
  if (labels.length === 0) return { ok: true, created: [] };
  const { missing, created } = await ensureLabelsExist(client, owner, repo, labels, {
    create: createMissing,
  });
  if (missing.length > 0) {
    return {
      error: errorContent(
        `Label(s) do not exist on ${owner}/${repo}: ${missing.join(", ")}. ` +
          `Pass create_missing_labels: true to auto-create them, or create them ` +
          `first with github_create_label.`,
      ),
    };
  }
  return { ok: true, created };
}

export function registerLabelTools(
  server: McpServer,
  client: GitHubClient,
  defaultRepo: string | undefined,
  allowedRepos: Set<string> | undefined,
): void {
  server.tool(
    "github_add_labels",
    "Add labels to an issue (additive; existing labels kept). " +
      "By default, fails with a structured error if any label does not exist " +
      "on the repo (GitHub itself silently drops unknown labels, which we treat as a bug). " +
      "Pass create_missing_labels: true to auto-create unknown labels with a color heuristic " +
      "(app:* → purple, area:* → green, other prefix → yellow, no prefix → grey).",
    {
      repo: repoArg,
      issue_number: z.number().int().min(1),
      labels: z.array(z.string().min(1)).min(1),
      create_missing_labels: z
        .boolean()
        .optional()
        .describe("If true, auto-create any labels that don't exist on the repo. Default false."),
    },
    async ({ repo, issue_number, labels, create_missing_labels }) => {
      const r = resolveRepo(repo, defaultRepo, allowedRepos);
      if ("error" in r) return r.error;
      try {
        const pf = await preflightLabels(
          client,
          r.owner,
          r.repo,
          labels,
          create_missing_labels ?? false,
        );
        if ("error" in pf) return pf.error;
        const result = await client.post<unknown>(
          `/repos/${r.owner}/${r.repo}/issues/${issue_number}/labels`,
          { labels },
        );
        return textContent(result);
      } catch (e) {
        return handleError(e);
      }
    },
  );

  server.tool(
    "github_set_labels",
    "Replace all labels on an issue with the provided set. Pass empty array to clear. " +
      "By default, fails with a structured error if any label does not exist on the repo " +
      "(GitHub itself silently drops unknown labels, which we treat as a bug). " +
      "Pass create_missing_labels: true to auto-create unknown labels with a color heuristic " +
      "(app:* → purple, area:* → green, other prefix → yellow, no prefix → grey).",
    {
      repo: repoArg,
      issue_number: z.number().int().min(1),
      labels: z.array(z.string()).describe("Full replacement set."),
      create_missing_labels: z
        .boolean()
        .optional()
        .describe("If true, auto-create any labels that don't exist on the repo. Default false."),
    },
    async ({ repo, issue_number, labels, create_missing_labels }) => {
      const r = resolveRepo(repo, defaultRepo, allowedRepos);
      if ("error" in r) return r.error;
      try {
        const pf = await preflightLabels(
          client,
          r.owner,
          r.repo,
          labels,
          create_missing_labels ?? false,
        );
        if ("error" in pf) return pf.error;
        const result = await client.put<unknown>(
          `/repos/${r.owner}/${r.repo}/issues/${issue_number}/labels`,
          { labels },
        );
        return textContent(result);
      } catch (e) {
        return handleError(e);
      }
    },
  );

  server.tool(
    "github_remove_label",
    "Remove a single label from an issue.",
    {
      repo: repoArg,
      issue_number: z.number().int().min(1),
      label: z.string().min(1),
    },
    async ({ repo, issue_number, label }) => {
      const r = resolveRepo(repo, defaultRepo, allowedRepos);
      if ("error" in r) return r.error;
      try {
        const result = await client.delete<unknown>(
          `/repos/${r.owner}/${r.repo}/issues/${issue_number}/labels/${encodeURIComponent(label)}`,
        );
        return textContent(result ?? { ok: true, removed: label });
      } catch (e) {
        return handleError(e);
      }
    },
  );

  server.tool(
    "github_create_label",
    "Create a new label on a repo. 'color' is required by the GitHub API (6-digit hex, no leading #). Fails with a 422 error if a label with the same name already exists — use github_update_label to change an existing one.",
    {
      repo: repoArg,
      name: z.string().min(1).describe("Label name, e.g. 'bug' or 'app:github-mcp'."),
      color: colorArg,
      description: z.string().max(100).optional(),
    },
    async ({ repo, name, color, description }) => {
      const r = resolveRepo(repo, defaultRepo, allowedRepos);
      if ("error" in r) return r.error;
      try {
        const body: Record<string, unknown> = { name, color: normalizeColor(color) };
        if (description !== undefined) body.description = description;
        const result = await client.post<unknown>(`/repos/${r.owner}/${r.repo}/labels`, body);
        return textContent(result);
      } catch (e) {
        return handleError(e);
      }
    },
  );

  server.tool(
    "github_update_label",
    "Update an existing repo label by its current name. Can rename (new_name), recolor (color), or change description. Only provided fields are sent.",
    {
      repo: repoArg,
      name: z.string().min(1).describe("Current label name (used to locate the label)."),
      new_name: z.string().min(1).optional().describe("New label name. Omit to keep current name."),
      color: colorArg.optional(),
      description: z.string().max(100).optional(),
    },
    async ({ repo, name, new_name, color, description }) => {
      const r = resolveRepo(repo, defaultRepo, allowedRepos);
      if ("error" in r) return r.error;
      try {
        const body: Record<string, unknown> = {};
        if (new_name !== undefined) body.new_name = new_name;
        if (color !== undefined) body.color = normalizeColor(color);
        if (description !== undefined) body.description = description;
        const result = await client.patch<unknown>(
          `/repos/${r.owner}/${r.repo}/labels/${encodeURIComponent(name)}`,
          body,
        );
        return textContent(result);
      } catch (e) {
        return handleError(e);
      }
    },
  );

  server.tool(
    "github_delete_label",
    "Delete a label from a repo by name. CASCADE WARNING: this also removes the label from every issue and pull request currently using it. Use with care — to merely take a label off one issue, use github_remove_label instead.",
    {
      repo: repoArg,
      name: z.string().min(1).describe("Label name to delete."),
    },
    async ({ repo, name }) => {
      const r = resolveRepo(repo, defaultRepo, allowedRepos);
      if ("error" in r) return r.error;
      try {
        const result = await client.delete<unknown>(
          `/repos/${r.owner}/${r.repo}/labels/${encodeURIComponent(name)}`,
        );
        return textContent(result ?? { ok: true, deleted: name });
      } catch (e) {
        return handleError(e);
      }
    },
  );

  server.tool(
    "github_list_repo_labels",
    "List labels defined on a repo.",
    {
      repo: repoArg,
      per_page: z.number().int().min(1).max(100).optional(),
      page: z.number().int().min(1).optional(),
    },
    async ({ repo, ...params }) => {
      const r = resolveRepo(repo, defaultRepo, allowedRepos);
      if ("error" in r) return r.error;
      try {
        const labels = await client.get<unknown>(`/repos/${r.owner}/${r.repo}/labels`, params);
        return textContent(labels);
      } catch (e) {
        return handleError(e);
      }
    },
  );
}
