import { createMcpWorker } from "@mcp-stack/mcp-core/worker";
import { buildServer } from "./server.js";
import type { Env } from "./types.js";

export default {
  fetch: createMcpWorker<Env>({
    buildServer,
    secretEnvKey: "URL_SECRET",
    corsOptions: { origin: "https://claude.ai" },
  }),
} satisfies ExportedHandler<Env>;
