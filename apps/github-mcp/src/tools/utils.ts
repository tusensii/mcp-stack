import { GitHubApiError } from "../github/client.js";
import { errorContent, type McpToolResponse } from "@mcp-stack/mcp-core";

export { textContent, errorContent } from "@mcp-stack/mcp-core";

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * Resolve `owner/repo` from a tool arg, falling back to the worker's default.
 * Throws a tool-shaped `errorContent` (via the caller) if neither is set.
 */
export function resolveRepo(
  arg: string | undefined,
  defaultRepo: string | undefined,
): { owner: string; repo: string } | { error: McpToolResponse } {
  const value = arg ?? defaultRepo;
  if (!value) {
    return {
      error: errorContent(
        "No repo specified and no GITHUB_DEFAULT_REPO configured. Pass repo as 'owner/name'.",
      ),
    };
  }
  if (!REPO_RE.test(value)) {
    return { error: errorContent(`Invalid repo '${value}'. Expected 'owner/name'.`) };
  }
  const [owner, repo] = value.split("/") as [string, string];
  return { owner, repo };
}

/**
 * Translate a thrown error into an MCP tool error response.
 * GitHub-specific errors get their `message`; everything else rethrows.
 */
export function handleError(e: unknown): McpToolResponse {
  if (e instanceof GitHubApiError) return errorContent(e.message);
  throw e;
}
