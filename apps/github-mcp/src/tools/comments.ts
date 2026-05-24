import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GitHubClient } from "../github/client.js";
import { resolveRepo, handleError, textContent } from "./utils.js";

const repoArg = z
  .string()
  .optional()
  .describe("Target repo as 'owner/name'. Falls back to GITHUB_DEFAULT_REPO when omitted.");

export function registerCommentTools(
  server: McpServer,
  client: GitHubClient,
  defaultRepo: string | undefined,
  allowedRepos: Set<string> | undefined,
): void {
  server.tool(
    "github_add_issue_comment",
    "Post a comment on an issue.",
    {
      repo: repoArg,
      issue_number: z.number().int().min(1),
      body: z.string().min(1).describe("Markdown body."),
    },
    async ({ repo, issue_number, body }) => {
      const r = resolveRepo(repo, defaultRepo, allowedRepos);
      if ("error" in r) return r.error;
      try {
        const comment = await client.post<unknown>(
          `/repos/${r.owner}/${r.repo}/issues/${issue_number}/comments`,
          { body },
        );
        return textContent(comment);
      } catch (e) {
        return handleError(e);
      }
    },
  );

  server.tool(
    "github_list_issue_comments",
    "List comments on an issue.",
    {
      repo: repoArg,
      issue_number: z.number().int().min(1),
      since: z.string().optional().describe("ISO 8601 timestamp; only comments updated at/after."),
      per_page: z.number().int().min(1).max(100).optional(),
      page: z.number().int().min(1).optional(),
    },
    async ({ repo, issue_number, ...params }) => {
      const r = resolveRepo(repo, defaultRepo, allowedRepos);
      if ("error" in r) return r.error;
      try {
        const comments = await client.get<unknown>(
          `/repos/${r.owner}/${r.repo}/issues/${issue_number}/comments`,
          params,
        );
        return textContent(comments);
      } catch (e) {
        return handleError(e);
      }
    },
  );

  server.tool(
    "github_update_issue_comment",
    "Edit an issue comment by its comment ID (not issue number).",
    {
      repo: repoArg,
      comment_id: z.number().int().min(1),
      body: z.string().min(1),
    },
    async ({ repo, comment_id, body }) => {
      const r = resolveRepo(repo, defaultRepo, allowedRepos);
      if ("error" in r) return r.error;
      try {
        const comment = await client.patch<unknown>(
          `/repos/${r.owner}/${r.repo}/issues/comments/${comment_id}`,
          { body },
        );
        return textContent(comment);
      } catch (e) {
        return handleError(e);
      }
    },
  );

  server.tool(
    "github_delete_issue_comment",
    "Delete an issue comment by its comment ID.",
    {
      repo: repoArg,
      comment_id: z.number().int().min(1),
    },
    async ({ repo, comment_id }) => {
      const r = resolveRepo(repo, defaultRepo, allowedRepos);
      if ("error" in r) return r.error;
      try {
        await client.delete<void>(`/repos/${r.owner}/${r.repo}/issues/comments/${comment_id}`);
        return textContent({ ok: true, deleted: comment_id });
      } catch (e) {
        return handleError(e);
      }
    },
  );
}
