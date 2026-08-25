#!/usr/bin/env -S node --experimental-strip-types
/**
 * trip-brief CLI (#102).
 *
 *   pnpm brief build configs/royal-basin-2026-08.json
 *
 * One command: pull, verify, render. Everything else is a flag on that.
 */

import { resolve } from "node:path";
import { buildOptionsCard, buildTrip, type BuildOutcome } from "./build.ts";
import { isTripConfig, loadConfig, ConfigError } from "./config/load.ts";
import { LinkVerificationError } from "./provenance/links.ts";
import { ProvenanceError } from "./provenance/tiers.ts";
import { RenderError } from "./render/pdf.ts";
import { TripMcpError } from "./mcp/client.ts";

const USAGE = `trip-brief — config-driven trip brief and options card generator

Usage:
  trip-brief build <config.json> [options]
  trip-brief check <config.json>

Commands:
  build   Pull data, verify links, and write the JSX + PDF outputs.
  check   Validate the config and exit. No network, no render.

Options:
  --out <dir>       Output directory (default: ./dist)
  --no-pdf          Skip the Chromium render; emit JSX and HTML only.
  --offline         Also emit the offline variant, overriding outputs.offline.
  --link-check <m>  Override provenance.link_check: fail | warn | skip
  --quiet           Only print the final summary.
  -h, --help        This text.

Environment:
  TRIP_MCP_URL            Full https://<worker>/s/<path-secret>/mcp endpoint.
  TRIP_MCP_ORIGIN         Worker origin, used with TRIP_MCP_PATH_SECRET.
  TRIP_MCP_PATH_SECRET    Path secret, used with TRIP_MCP_ORIGIN.
  TRIP_BRIEF_CHROMIUM     Chromium binary for the PDF step.
  PLAYWRIGHT_BROWSERS_PATH  Playwright browsers directory, searched as a fallback.
`;

interface Args {
  command: string;
  configPath: string;
  outDir: string;
  skipPdf: boolean;
  offline: boolean;
  linkCheck: "fail" | "warn" | "skip" | null;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args | null {
  if (!argv.length || argv.includes("-h") || argv.includes("--help")) return null;

  const command = argv[0]!;
  const rest = argv.slice(1);
  const positional: string[] = [];
  let outDir = resolve(process.cwd(), "dist");
  let skipPdf = false;
  let offline = false;
  let linkCheck: Args["linkCheck"] = null;
  let quiet = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    switch (arg) {
      case "--out":
        outDir = resolve(process.cwd(), rest[++i] ?? "dist");
        break;
      case "--no-pdf":
        skipPdf = true;
        break;
      case "--offline":
        offline = true;
        break;
      case "--link-check": {
        const mode = rest[++i];
        if (mode !== "fail" && mode !== "warn" && mode !== "skip") {
          throw new Error(`--link-check must be fail, warn or skip (got ${mode})`);
        }
        linkCheck = mode;
        break;
      }
      case "--quiet":
        quiet = true;
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
        positional.push(arg);
    }
  }

  const configPath = positional[0];
  if (!configPath) throw new Error("A config path is required.");

  return {
    command,
    configPath: resolve(process.cwd(), configPath),
    outDir,
    skipPdf,
    offline,
    linkCheck,
    quiet,
  };
}

function report(outcome: BuildOutcome): void {
  console.log(`\n${outcome.slug}`);
  for (const artifact of outcome.artifacts) {
    console.log(`  ${artifact.variant}`);
    console.log(`    jsx   ${artifact.jsx_path}`);
    console.log(`    html  ${artifact.html_path}`);
    if (artifact.pdf_path) console.log(`    pdf   ${artifact.pdf_path}`);
  }
  if (outcome.warnings.length) {
    console.log(`\n  ${outcome.warnings.length} build warning(s):`);
    for (const w of outcome.warnings) console.log(`    - ${w}`);
  }
  if (outcome.tone_violations.length) {
    console.log(`\n  ${outcome.tone_violations.length} tone-rule violation(s) — see STYLE.md:`);
    for (const v of outcome.tone_violations) console.log(`    - ${v}`);
  }
}

async function main(): Promise<number> {
  let args: Args | null;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${(err as Error).message}\n`);
    console.error(USAGE);
    return 2;
  }
  if (!args) {
    console.log(USAGE);
    return 0;
  }

  const log = args.quiet ? () => {} : (m: string) => console.error(`  ${m}`);

  const config = await loadConfig(args.configPath);

  if (args.linkCheck) config.provenance.link_check = args.linkCheck;
  if (args.offline && isTripConfig(config)) config.outputs.offline = true;

  if (args.command === "check") {
    console.log(`${args.configPath}: valid ${config.kind} config (${config.slug})`);
    return 0;
  }
  if (args.command !== "build") {
    console.error(`Unknown command: ${args.command}\n`);
    console.error(USAGE);
    return 2;
  }

  const buildOptions = {
    outDir: args.outDir,
    skipPdf: args.skipPdf,
    onLog: log,
  };

  const outcome = isTripConfig(config)
    ? await buildTrip(config, buildOptions)
    : await buildOptionsCard(config, buildOptions);

  report(outcome);
  // Tone violations come from config-supplied prose, not the templates, so
  // they are the operator's to fix — surfaced as a non-zero exit rather than
  // a silently shipped brief.
  return outcome.tone_violations.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    if (
      err instanceof ConfigError ||
      err instanceof LinkVerificationError ||
      err instanceof ProvenanceError ||
      err instanceof RenderError ||
      err instanceof TripMcpError
    ) {
      console.error(`\n${err.name}: ${err.message}`);
      process.exit(1);
    }
    console.error(err);
    process.exit(1);
  });
