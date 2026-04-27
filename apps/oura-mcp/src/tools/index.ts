import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OuraClient } from "../oura/client.js";
import { registerPersonalTools } from "./personal.js";
import { registerRingTools } from "./ring.js";
import { registerSleepTools } from "./sleep.js";
import { registerReadinessTools } from "./readiness.js";
import { registerActivityTools } from "./activity.js";
import { registerHeartrateTools } from "./heartrate.js";
import { registerStressTools } from "./stress.js";
import { registerResilienceTools } from "./resilience.js";
import { registerSpo2Tools } from "./spo2.js";
import { registerVo2MaxTools } from "./vo2max.js";
import { registerWorkoutTools } from "./workout.js";
import { registerSessionTools } from "./session.js";
import { registerTagTools } from "./tag.js";
import { registerSummaryTools } from "./summary.js";

export function registerAllTools(server: McpServer, client: OuraClient): void {
  registerPersonalTools(server, client);
  registerRingTools(server, client);
  registerSleepTools(server, client);
  registerReadinessTools(server, client);
  registerActivityTools(server, client);
  registerHeartrateTools(server, client);
  registerStressTools(server, client);
  registerResilienceTools(server, client);
  registerSpo2Tools(server, client);
  registerVo2MaxTools(server, client);
  registerWorkoutTools(server, client);
  registerSessionTools(server, client);
  registerTagTools(server, client);
  registerSummaryTools(server, client);
}
