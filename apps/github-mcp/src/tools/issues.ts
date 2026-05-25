import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GitHubClient } from "../github/client.js";
import { resolveRepo, handleError, textContent, errorContent } from "./utils.js";
import { preflightLabels } from "./labels.js";

const repoArg = z
  .string()
  .optional()
  .describe("Target repo as 'owner/name'. Falls back to GITHUB_DEFAULT_REPO when omitted.");

export function registerIssueTools(
  server: McpServer,
  client: GitHubClient,
  defaultRepo: string | undefined,
  defaultLabels: string[],
  allowedRepos: Set<string> | undefined,
): void {
  const createIssueLabelsDesc =
    defaultLabels.length > 0
      ? `Label names to apply. Merged with deployment defaults [${defaultLabels.join(", ")}] (deduped).`
      : "Label names to apply.";

  server.tool(
    "github_create_issue",
    "Open a new GitHub issue. Title required; body, labels, assignees, milestone optional. " +
      "By default, fails with a structured error if any requested label does not exist " +
      "on the repo (GitHub itself silently drops unknown labels, which we treat as a bug). " +
      "Pass create_missing_labels: true to auto-create unknown labels first, with a color " +
      "heuristic (app:* → purple, area:* → green, other prefix → yellow, no prefix → grey).",
    {
      repo: repoArg,
      title: z.string().min(1).describe("Issue title."),
      body: z.string().optional().describe("Markdown body."),
      labels: z.array(z.string()).optional().describe(createIssueLabelsDesc),
      assignees: z.array(z.string()).optional().describe("GitHub usernames to assign."),
      milestone: z.number().int().optional().describe("Milestone number (not title)."),
      create_missing_labels: z
        .boolean()
        .optional()
        .describe("If true, auto-create any labels that don't exist on the repo. Default false."),
    },
    async ({ repo, title, body, labels, assignees, milestone, create_missing_labels }) => {
      const r = resolveRepo(repo, defaultRepo, allowedRepos);
      if ("error" in r) return r.error;
      const mergedLabels = Array.from(new Set([...defaultLabels, ...(labels ?? [])]));
      try {
        if (mergedLabels.length > 0) {
          const pf = await preflightLabels(
            client,
            r.owner,
            r.repo,
            mergedLabels,
            create_missing_labels ?? false,
          );
          if ("error" in pf) return pf.error;
        }
        const issue = await client.post<unknown>(`/repos/${r.owner}/${r.repo}/issues`, {
          title,
          ...(body !== undefined ? { body } : {}),
          ...(mergedLabels.length > 0 ? { labels: mergedLabels } : {}),
          ...(assignees ? { assignees } : {}),
          ...(milestone !== undefined ? { milestone } : {}),
        });
        return textContent(issue);
      } catch (e) {
        return handleError(e);
      }
    },
  );

  server.tool(
    "github_get_issue",
    "Fetch a single issue by number.",
    {
      repo: repoArg,
      issue_number: z.number().int().min(1),
    },
    async ({ repo, issue_number }) => {
      const r = resolveRepo(repo, defaultRepo, allowedRepos);
      if ("error" in r) return r.error;
      try {
        const issue = await client.get<unknown>(`/repos/${r.owner}/${r.repo}/issues/${issue_number}`);
        return textContent(issue);
      } catch (e) {
        return handleError(e);
      }
    },
  );

  server.tool(
    "github_list_issues",
    "List issues in a repo. Note: GitHub's API treats pull requests as issues; " +
      "results may include PRs (filter on 'pull_request' field absence to exclude). " +
      "For cross-repo search with richer filters, use github_search_issues.",
    {
      repo: repoArg,
      state: z.enum(["open", "closed", "all"]).optional().describe("Default 'open'."),
      labels: z.string().optional().describe("Comma-separated label names."),
      assignee: z.string().optional().describe("Username, '*' for any, or 'none' for unassigned."),
      creator: z.string().optional().describe("Filter by issue author username."),
      mentioned: z.string().optional().describe("Filter by mentioned username."),
      sort: z.enum(["created", "updated", "comments"]).optional(),
      direction: z.enum(["asc", "desc"]).optional(),
      since: z.string().optional().describe("ISO 8601 timestamp; only issues updated at/after."),
      per_page: z.number().int().min(1).max(100).optional().describe("Default 30, max 100."),
      page: z.number().int().min(1).optional(),
    },
    async ({ repo, ...params }) => {
      const r = resolveRepo(repo, defaultRepo, allowedRepos);
      if ("error" in r) return r.error;
      try {
        const issues = await client.get<unknown>(`/repos/${r.owner}/${r.repo}/issues`, params);
        return textContent(issues);
      } catch (e) {
        return handleError(e);
      }
    },
  );

  server.tool(
    "github_update_issue",
    "Edit an issue: title, body, state, labels (replaces all), assignees (replaces all), milestone. " +
      "To close as 'not planned' rather than 'completed', set state_reason='not_planned'.",
    {
      repo: repoArg,
      issue_number: z.number().int().min(1),
      title: z.string().optional(),
      body: z.string().optional(),
      state: z.enum(["open", "closed"]).optional(),
      state_reason: z.enum(["completed", "not_planned", "reopened"]).optional(),
      labels: z.array(z.string()).optional().describe("Replaces the full label set."),
      assignees: z.array(z.string()).optional().describe("Replaces the full assignee set."),
      milestone: z.number().int().nullable().optional().describe("Pass null to clear."),
    },
    async ({ repo, issue_number, ...patch }) => {
      const r = resolveRepo(repo, defaultRepo, allowedRepos);
      if ("error" in r) return r.error;
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) body[k] = v;
      }
      if (Object.keys(body).length === 0) {
        return errorContent("No fields to update. Pass at least one of title/body/state/labels/assignees/milestone.");
      }
      try {
        const issue = await client.patch<unknown>(
          `/repos/${r.owner}/${r.repo}/issues/${issue_number}`,
          body,
        );
        return textContent(issue);
      } catch (e) {
        return handleError(e);
      }
    },
  );

  server.tool(
    "github_lock_issue",
    "Lock an issue to limit further conversation. Optional reason: off-topic, too heated, resolved, spam.",
    {
      repo: repoArg,
      issue_number: z.number().int().min(1),
      lock_reason: z.enum(["off-topic", "too heated", "resolved", "spam"]).optional(),
    },
    async ({ repo, issue_number, lock_reason }) => {
      const r = resolveRepo(repo, defaultRepo, allowedRepos);
      if ("error" in r) return r.error;
      try {
        await client.put<void>(
          `/repos/${r.owner}/${r.repo}/issues/${issue_number}/lock`,
          lock_reason ? { lock_reason } : {},
        );
        return textContent({ ok: true, locked: issue_number });
      } catch (e) {
        return handleError(e);
      }
    },
  );

  server.tool(
    "github_unlock_issue",
    "Unlock a previously locked issue.",
    {
      repo: repoArg,
      issue_number: z.number().int().min(1),
    },
    async ({ repo, issue_number }) => {
      const r = resolveRepo(repo, defaultRepo, allowedRepos);
      if ("error" in r) return r.error;
      try {
        await client.delete<void>(`/repos/${r.owner}/${r.repo}/issues/${issue_number}/lock`);
        return textContent({ ok: true, unlocked: issue_number });
      } catch (e) {
        return handleError(e);
      }
    },
  );
}
