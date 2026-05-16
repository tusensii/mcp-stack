import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GitHubClient } from "../github/client.js";
import { resolveRepo, handleError, textContent } from "./utils.js";

const repoArg = z
  .string()
  .optional()
  .describe("Target repo as 'owner/name'. Falls back to GITHUB_DEFAULT_REPO when omitted.");

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
