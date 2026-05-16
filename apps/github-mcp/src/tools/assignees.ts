import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GitHubClient } from "../github/client.js";
import { resolveRepo, handleError, textContent } from "./utils.js";

const repoArg = z
  .string()
  .optional()
  .describe("Target repo as 'owner/name'. Falls back to GITHUB_DEFAULT_REPO when omitted.");

export function registerAssigneeTools(
  server: McpServer,
  client: GitHubClient,
  defaultRepo: string | undefined,
): void {
  server.tool(
    "github_add_assignees",
    "Add assignees to an issue (additive). Usernames must have access to the repo.",
    {
      repo: repoArg,
      issue_number: z.number().int().min(1),
      assignees: z.array(z.string().min(1)).min(1),
    },
    async ({ repo, issue_number, assignees }) => {
      const r = resolveRepo(repo, defaultRepo);
      if ("error" in r) return r.error;
      try {
        const issue = await client.post<unknown>(
          `/repos/${r.owner}/${r.repo}/issues/${issue_number}/assignees`,
          { assignees },
        );
        return textContent(issue);
      } catch (e) {
        return handleError(e);
      }
    },
  );

  server.tool(
    "github_remove_assignees",
    "Remove specific assignees from an issue.",
    {
      repo: repoArg,
      issue_number: z.number().int().min(1),
      assignees: z.array(z.string().min(1)).min(1),
    },
    async ({ repo, issue_number, assignees }) => {
      const r = resolveRepo(repo, defaultRepo);
      if ("error" in r) return r.error;
      try {
        const issue = await client.delete<unknown>(
          `/repos/${r.owner}/${r.repo}/issues/${issue_number}/assignees`,
          { assignees },
        );
        return textContent(issue);
      } catch (e) {
        return handleError(e);
      }
    },
  );
}
