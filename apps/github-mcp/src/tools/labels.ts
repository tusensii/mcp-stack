import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GitHubClient } from "../github/client.js";
import { resolveRepo, handleError, textContent } from "./utils.js";

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

export function registerLabelTools(
  server: McpServer,
  client: GitHubClient,
  defaultRepo: string | undefined,
): void {
  server.tool(
    "github_add_labels",
    "Add labels to an issue (additive; existing labels kept).",
    {
      repo: repoArg,
      issue_number: z.number().int().min(1),
      labels: z.array(z.string().min(1)).min(1),
    },
    async ({ repo, issue_number, labels }) => {
      const r = resolveRepo(repo, defaultRepo);
      if ("error" in r) return r.error;
      try {
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
    "Replace all labels on an issue with the provided set. Pass empty array to clear.",
    {
      repo: repoArg,
      issue_number: z.number().int().min(1),
      labels: z.array(z.string()).describe("Full replacement set."),
    },
    async ({ repo, issue_number, labels }) => {
      const r = resolveRepo(repo, defaultRepo);
      if ("error" in r) return r.error;
      try {
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
      const r = resolveRepo(repo, defaultRepo);
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
      const r = resolveRepo(repo, defaultRepo);
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
      const r = resolveRepo(repo, defaultRepo);
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
      const r = resolveRepo(repo, defaultRepo);
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
      const r = resolveRepo(repo, defaultRepo);
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
