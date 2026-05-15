import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { ok, empty, makeSource, nowIso } from "../types.js";
import { payloadResponse } from "./utils.js";
import { searchWeb, PNW_DEFAULT_SITES } from "../sources/web.js";

export function registerWebResearchTools(server: McpServer, env: Env): void {
  server.tool(
    "web_research",
    "Free-form web search across PNW outdoor community sources (NWHikers, SummitPost, Cascadeclimbers, Peakbagger, Reddit r/WashingtonHikers / r/PNWhiking / r/WildernessBackpacking, Mountaineers, CalTopo public maps, Steph Abegg). Use this for OBSCURE OR OFF-TRAIL routes not covered by WTA — peakbagging, cross-country zones, alpine climbs, old trip blogs, anything where the curated area registry returned empty. Powered by Brave Search; degrades gracefully when no API key is set. Returns titles + URLs + snippets — decide which results to read in full using your built-in web-fetch capability (this MCP does not expose its own fetch tool). Default `use_default_sites: false` searches the open web; set `use_default_sites: true` to restrict to the PNW outdoor community allowlist when you specifically want community trip reports rather than commercial guidebooks. Results are LOW CONFIDENCE by default — community content is uncited, may be old, and may describe conditions in a different season/year than the user's trip. Cross-reference any specific factual claim (snow level, road status, river crossing difficulty) with WTA, NWS, or an official source before passing it to the user as fact.",
    {
      query: z.string().describe("Search query, e.g. 'Glacier Peak Image Lake snow level July'"),
      site_allowlist: z
        .array(z.string())
        .optional()
        .describe(
          "Optional list of domains to restrict to (e.g. ['nwhikers.net','peakbagger.com']). " +
            "Default: PNW outdoor community allowlist.",
        ),
      use_default_sites: z
        .boolean()
        .optional()
        .describe(
          "If true and site_allowlist not provided, restrict to the curated PNW outdoor " +
            "community allowlist. Default false (open web).",
        ),
      limit: z.number().int().min(1).max(20).optional(),
    },
    async (args) => {
      const sites = args.site_allowlist ?? (args.use_default_sites ? PNW_DEFAULT_SITES : undefined);
      const result = await searchWeb(env, args.query, { site_allowlist: sites, limit: args.limit });

      const sources = [
        makeSource(
          `https://search.brave.com/search?q=${encodeURIComponent(result.query_used)}`,
          "Brave Search",
          { fetched_at: nowIso(), confidence: "low" },
        ),
      ];

      if (!result.used_brave) {
        return payloadResponse(
          empty(
            [
              "No BRAVE_API_KEY configured — web_research can only return a manual search URL. " +
                "Set BRAVE_API_KEY (free tier: 2,000 queries/month at brave.com/search/api/) " +
                "or run the search manually via the URL in `sources`.",
            ],
            sources,
          ),
        );
      }

      const caveats: string[] = [];
      if (result.results.length === 0) {
        caveats.push("No results — try a broader query or remove the site allowlist.");
      } else {
        caveats.push(
          "Web search results are uncited community content. Treat as 'low' confidence " +
            "until cross-referenced with WTA, NWS, or official sources.",
        );
      }

      return payloadResponse(
        ok({ results: result.results, query_used: result.query_used }, sources, "low", caveats),
      );
    },
  );
}
