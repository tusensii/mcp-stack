/**
 * esbuild wiring (#102).
 *
 * Two bundles come out of the same component tree:
 *
 *   jsx     — JSX preserved, data inlined, self-contained. This is the file
 *             you paste into an artifact, and it is an *output* of the build
 *             rather than a scratch file, because the artifact and the PDF
 *             have to be the same document.
 *   browser — automatic runtime, React bundled in, minified IIFE. This is
 *             what Chromium loads to produce the PDF.
 *
 * The model is injected through a virtual module rather than a temp file so
 * there is nothing to clean up and nothing stale to accidentally rebuild from.
 */

import { build, type Plugin } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const VIRTUAL_MODEL = "virtual:trip-brief-model";
const VIRTUAL_ENTRY = "virtual:trip-brief-entry";

export type ComponentName = "TripReport" | "OfflineBrief" | "OptionsCard";

const COMPONENT_MODULE: Record<ComponentName, string> = {
  TripReport: "../report/TripReport.tsx",
  OfflineBrief: "../report/OfflineBrief.tsx",
  OptionsCard: "../report/OptionsCard.tsx",
};

function virtualPlugin(entrySource: string, model: unknown): Plugin {
  return {
    name: "trip-brief-virtual",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^virtual:trip-brief-/ }, (args) => ({
        path: args.path,
        namespace: "trip-brief",
      }));
      pluginBuild.onLoad({ filter: /.*/, namespace: "trip-brief" }, (args) => {
        if (args.path === VIRTUAL_MODEL) {
          return {
            contents: `export const MODEL = ${JSON.stringify(model, null, 2)};`,
            loader: "js",
            resolveDir: HERE,
          };
        }
        return { contents: entrySource, loader: "tsx", resolveDir: HERE };
      });
    },
  };
}

function entrySourceForJsx(component: ComponentName): string {
  const modulePath = COMPONENT_MODULE[component];
  return `
import { ${component} } from ${JSON.stringify(modulePath)};
import { STYLESHEET } from "../report/theme.ts";
import { MODEL } from ${JSON.stringify(VIRTUAL_MODEL)};

export const model = MODEL;

export default function Report() {
  return (
    <>
      <style>{STYLESHEET}</style>
      <${component} model={MODEL} />
    </>
  );
}
`;
}

function entrySourceForBrowser(component: ComponentName): string {
  const modulePath = COMPONENT_MODULE[component];
  return `
import { createRoot } from "react-dom/client";
import { ${component} } from ${JSON.stringify(modulePath)};
import { MODEL } from ${JSON.stringify(VIRTUAL_MODEL)};

const container = document.getElementById("root");
createRoot(container).render(<${component} model={MODEL} />);
`;
}

export interface BundleResult {
  code: string;
  warnings: string[];
}

/**
 * Self-contained JSX with the data inlined. JSX syntax is preserved, so the
 * output drops straight into any React host without a build step.
 */
export async function bundleJsx(
  component: ComponentName,
  model: unknown,
): Promise<BundleResult> {
  const result = await build({
    entryPoints: [VIRTUAL_ENTRY],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    jsx: "preserve",
    // React is provided by the host (artifact runtime or a parent app).
    external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
    plugins: [virtualPlugin(entrySourceForJsx(component), model)],
    absWorkingDir: resolve(HERE, ".."),
    logLevel: "silent",
  });
  return {
    code: result.outputFiles?.[0]?.text ?? "",
    warnings: result.warnings.map((w) => w.text),
  };
}

/** Minified IIFE with React bundled in, for the headless Chromium render. */
export async function bundleBrowser(
  component: ComponentName,
  model: unknown,
): Promise<BundleResult> {
  const result = await build({
    entryPoints: [VIRTUAL_ENTRY],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: ["chrome120"],
    jsx: "automatic",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [virtualPlugin(entrySourceForBrowser(component), model)],
    absWorkingDir: resolve(HERE, ".."),
    logLevel: "silent",
  });
  return {
    code: result.outputFiles?.[0]?.text ?? "",
    warnings: result.warnings.map((w) => w.text),
  };
}

/** The HTML shell Chromium loads. Everything is inline; nothing is fetched. */
export function htmlShell(opts: {
  title: string;
  stylesheet: string;
  script: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<style>${opts.stylesheet}</style>
</head>
<body>
<div id="root"></div>
<script>${opts.script}</script>
</body>
</html>
`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
