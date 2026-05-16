import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GitHubClient } from "../github/client.js";
import { handleError, textContent } from "./utils.js";

export function registerSearchTools(server: McpServer, client: GitHubClient): void {
  server.tool(
    "github_search_issues",
    "Search issues and pull requests across all repos accessible to the token. " +
      "Uses GitHub's search syntax — examples: " +
      "'repo:tusensii/mcp-stack is:issue is:open label:bug', " +
      "'is:issue author:tusensii state:open', " +
      "'org:my-org is:pr is:open review-requested:@me'.",
    {
      q: z.string().min(1).describe("GitHub search query string."),
      sort: z
        .enum(["comments", "reactions", "created", "updated"])
        .optional()
        .describe("Default: best match (no sort field)."),
      order: z.enum(["asc", "desc"]).optional(),
      per_page: z.number().int().min(1).max(100).optional(),
      page: z.number().int().min(1).optional(),
    },
    async (params) => {
      try {
        const results = await client.get<unknown>("/search/issues", params);
        return textContent(results);
      } catch (e) {
        return handleError(e);
      }
    },
  );
}
