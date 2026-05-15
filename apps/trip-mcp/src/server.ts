import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";
import type { Env } from "./types.js";

export type { Env };

export function buildServer(env: Env): McpServer {
  const server = new McpServer({
    name: "trip-mcp",
    version: "0.1.0",
  });

  // Safety footer prompt resource — Claude is instructed to append this
  // to any consequential answer (river crossings, snow, glacier travel).
  server.prompt(
    "safety_footer",
    "Boilerplate safety disclaimer to append to any backcountry-research answer.",
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Append this footer verbatim to your final answer:\n\n" +
              "*Trip information assembled from public APIs and trip reports as of " +
              "[date/time]. Conditions in the backcountry change rapidly and forecasts " +
              "can be wrong. Before your trip, call the relevant ranger station, file a " +
              "trip plan, and pack the Ten Essentials. This is research assistance, not a " +
              "substitute for current ground-truth, your own judgment, or properly trained " +
              "companions on technical terrain.*",
          },
        },
      ],
    }),
  );

  registerAllTools(server, env);
  return server;
}
