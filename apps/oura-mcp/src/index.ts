import { createMcpWorker } from "@mcp-stack/mcp-core/worker";
import { buildServer, type Env } from "./server.js";

export default {
  fetch: createMcpWorker<Env>({
    buildServer,
    secretEnvKey: "MCP_PATH_SECRET",
    corsOptions: { origin: "https://claude.ai" },
  }),
} satisfies ExportedHandler<Env>;
