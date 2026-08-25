/**
 * The one command (#102).
 *
 * config in → data pulled → links verified → model built → JSX and PDF out.
 * Re-running refreshes everything and rewrites both outputs; the refresh
 * timestamp is set once here and threaded through every artifact so the JSX,
 * the HTML and the PDF all claim the same instant.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OptionsConfig, TripConfig } from "./config/schema.ts";
import { TripMcpClient } from "./mcp/client.ts";
import { pullOptions, pullTrip, type OptionsPull, type TripPull } from "./mcp/pull.ts";
import { verifyLinks, type LinkVerdict } from "./provenance/links.ts";
import { buildTripModel, modelStrings, type TripModel } from "./model/trip.ts";
import { buildOptionsModel, optionsUrls, type OptionsModel } from "./model/options.ts";
import { lintTone } from "./prose/templates.ts";
import { bundleBrowser, bundleJsx, htmlShell, type ComponentName } from "./render/bundle.ts";
import { renderPdf } from "./render/pdf.ts";
import { STYLESHEET } from "./report/theme.ts";

export interface BuildOptions {
  outDir: string;
  /** Skip the Chromium step. Useful in CI and when iterating on prose. */
  skipPdf?: boolean;
  /** Fixed build instant, so a rebuild of unchanged data is byte-identical. */
  now?: Date;
  onLog?: (message: string) => void;
  /** Pre-built client, for tests. */
  client?: TripMcpClient;
}

export interface BuiltArtifact {
  variant: string;
  jsx_path: string;
  html_path: string;
  pdf_path: string | null;
  model_path: string;
}

export interface BuildOutcome {
  slug: string;
  artifacts: BuiltArtifact[];
  warnings: string[];
  /** Tone-rule violations found in the rendered strings (#103). */
  tone_violations: string[];
}

// ---------------------------------------------------------------------------

/** Every URL a trip build could render as an anchor. */
export function collectTripUrls(cfg: TripConfig, pull: TripPull): string[] {
  const urls: string[] = cfg.links.map((l) => l.url);
  const results = [
    pull.weather,
    pull.trailWeather,
    pull.elevation,
    pull.rivers,
    pull.conditions,
    pull.tripReports,
    pull.safety,
    pull.access,
    pull.permits,
    pull.campWater,
  ];
  for (const r of results) {
    if (!r) continue;
    for (const s of r.payload.sources) urls.push(s.url);
  }
  for (const report of pull.tripReports.payload.data?.reports ?? []) {
    if (report.url) urls.push(report.url);
  }
  for (const permit of pull.permits?.payload.data?.permits ?? []) {
    if (permit.rec_gov_url) urls.push(permit.rec_gov_url);
  }
  return [...new Set(urls)];
}

export function collectOptionsUrls(cfg: OptionsConfig, pull: OptionsPull): string[] {
  const urls = optionsUrls(cfg);
  for (const c of pull.candidates) {
    for (const s of c.weather.payload.sources) urls.push(s.url);
    for (const s of c.conditions.payload.sources) urls.push(s.url);
  }
  return [...new Set(urls)];
}

// ---------------------------------------------------------------------------

async function emit(
  component: ComponentName,
  model: TripModel | OptionsModel,
  variant: string,
  slug: string,
  opts: BuildOptions,
): Promise<BuiltArtifact> {
  const log = opts.onLog ?? (() => {});
  const stem = variant === "standard" ? slug : `${slug}.${variant}`;

  const modelPath = join(opts.outDir, `${stem}.model.json`);
  await writeFile(modelPath, `${JSON.stringify(model, null, 2)}\n`, "utf8");

  log(`bundle ${stem}.jsx`);
  const jsx = await bundleJsx(component, model);
  for (const w of jsx.warnings) log(`esbuild: ${w}`);
  const jsxPath = join(opts.outDir, `${stem}.jsx`);
  await writeFile(jsxPath, jsx.code, "utf8");

  log(`bundle ${stem}.html`);
  const browser = await bundleBrowser(component, model);
  for (const w of browser.warnings) log(`esbuild: ${w}`);
  const html = htmlShell({
    title: model.title,
    stylesheet: STYLESHEET,
    script: browser.code,
  });
  const htmlPath = join(opts.outDir, `${stem}.html`);
  await writeFile(htmlPath, html, "utf8");

  let pdfPath: string | null = null;
  if (!opts.skipPdf) {
    log(`render ${stem}.pdf`);
    const pdf = await renderPdf({ html, title: model.title, onLog: log });
    pdfPath = join(opts.outDir, `${stem}.pdf`);
    await writeFile(pdfPath, pdf.bytes);
    log(
      `wrote ${stem}.pdf — ${pdf.content_height_px}px of content, ` +
        `${pdf.pages_rendered} page(s) rendered, 1 kept`,
    );
  }

  return {
    variant,
    jsx_path: jsxPath,
    html_path: htmlPath,
    pdf_path: pdfPath,
    model_path: modelPath,
  };
}

function toneWarnings(strings: string[]): string[] {
  return lintTone(strings).map(
    (v) => `Tone rule: "${v.match}" (${v.why}) in: ${v.text.slice(0, 90)}`,
  );
}

// ---------------------------------------------------------------------------

export async function buildTrip(
  cfg: TripConfig,
  opts: BuildOptions,
): Promise<BuildOutcome> {
  const log = opts.onLog ?? (() => {});
  await mkdir(opts.outDir, { recursive: true });

  const client = opts.client ?? new TripMcpClient({ onLog: log });
  let pull: TripPull;
  let verdicts: Map<string, LinkVerdict>;
  try {
    pull = await pullTrip(client, cfg, log);
    const urls = collectTripUrls(cfg, pull);
    log(`verify ${urls.length} link(s) (mode: ${cfg.provenance.link_check})`);
    verdicts = await verifyLinks(urls, { mode: cfg.provenance.link_check, onLog: log });
  } finally {
    if (!opts.client) await client.close();
  }

  const model = buildTripModel({
    config: cfg,
    pull,
    linkVerdicts: verdicts,
    ...(opts.now ? { generated_at: opts.now } : {}),
  });

  const artifacts: BuiltArtifact[] = [];
  if (cfg.outputs.jsx || cfg.outputs.pdf) {
    artifacts.push(await emit("TripReport", model, "standard", cfg.slug, opts));
  }
  if (cfg.outputs.offline) {
    artifacts.push(await emit("OfflineBrief", model, "offline", cfg.slug, opts));
  }

  return {
    slug: cfg.slug,
    artifacts,
    warnings: model.warnings,
    tone_violations: toneWarnings(modelStrings(model)),
  };
}

export async function buildOptionsCard(
  cfg: OptionsConfig,
  opts: BuildOptions,
): Promise<BuildOutcome> {
  const log = opts.onLog ?? (() => {});
  await mkdir(opts.outDir, { recursive: true });

  const client = opts.client ?? new TripMcpClient({ onLog: log });
  let pull: OptionsPull;
  let verdicts: Map<string, LinkVerdict>;
  try {
    pull = await pullOptions(client, cfg, log);
    const urls = collectOptionsUrls(cfg, pull);
    log(`verify ${urls.length} link(s) (mode: ${cfg.provenance.link_check})`);
    verdicts = await verifyLinks(urls, { mode: cfg.provenance.link_check, onLog: log });
  } finally {
    if (!opts.client) await client.close();
  }

  const model = buildOptionsModel({
    config: cfg,
    pull,
    linkVerdicts: verdicts,
    ...(opts.now ? { generated_at: opts.now } : {}),
  });

  const artifacts = [await emit("OptionsCard", model, "standard", cfg.slug, opts)];

  const strings = [
    model.title,
    ...model.criteria_lines,
    ...[...model.qualified, ...model.disqualified].flatMap((c) => [
      ...c.summary,
      ...c.failures.map((f) => f.detail),
    ]),
  ];

  return {
    slug: cfg.slug,
    artifacts,
    warnings: model.warnings,
    tone_violations: toneWarnings(strings),
  };
}
