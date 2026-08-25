/**
 * Config loading. JSON with `//` and `/* *\/` comments allowed, because these
 * files are hand-edited between trips and the reasoning behind a criteria
 * threshold is worth keeping next to the number.
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  OptionsConfigSchema,
  TripConfigSchema,
  type BriefConfig,
  type OptionsConfig,
  type TripConfig,
} from "./schema.ts";

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Strip `//` and block comments from JSON without mangling them inside string
 * literals. A hand-rolled scanner is a few lines and avoids a dependency for
 * something this small.
 */
export function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    const next = input[i + 1];

    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      } else if (ch === "\n") {
        out += ch; // keep line numbers stable for error messages
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

function formatZodError(err: z.ZodError, path: string): ConfigError {
  const lines = err.issues.map((issue) => {
    const where = issue.path.length ? issue.path.join(".") : "(root)";
    return `  ${where}: ${issue.message}`;
  });
  return new ConfigError(`Invalid trip-brief config:\n${lines.join("\n")}`, path);
}

export async function loadConfig(path: string): Promise<BriefConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    throw new ConfigError(`Cannot read config: ${(cause as Error).message}`, path);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch (cause) {
    throw new ConfigError(`Config is not valid JSON: ${(cause as Error).message}`, path);
  }

  const kind = (parsed as { kind?: unknown })?.kind;
  if (kind === "trip") {
    const result = TripConfigSchema.safeParse(parsed);
    if (!result.success) throw formatZodError(result.error, path);
    return result.data satisfies TripConfig;
  }
  if (kind === "options") {
    const result = OptionsConfigSchema.safeParse(parsed);
    if (!result.success) throw formatZodError(result.error, path);
    return result.data satisfies OptionsConfig;
  }
  throw new ConfigError(
    `Config \`kind\` must be "trip" or "options" (got ${JSON.stringify(kind)})`,
    path,
  );
}

export function isTripConfig(cfg: BriefConfig): cfg is TripConfig {
  return cfg.kind === "trip";
}

export function isOptionsConfig(cfg: BriefConfig): cfg is OptionsConfig {
  return cfg.kind === "options";
}
