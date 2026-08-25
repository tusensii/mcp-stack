/**
 * End-to-end render: model → esbuild → Chromium → single-page PDF.
 *
 * Skipped unless a Chromium is actually resolvable, so `pnpm test` stays green
 * on a CI runner with no Playwright browsers installed. Run it locally (or in
 * any image with PLAYWRIGHT_BROWSERS_PATH set) to exercise the half of the
 * pipeline the unit tests stub out.
 */

import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { bundleBrowser, htmlShell } from "./bundle.ts";
import { renderPdf, resolveChromium } from "./pdf.ts";
import { buildTripModel } from "../model/trip.ts";
import { PAGE_WIDTH_PX, STYLESHEET } from "../report/theme.ts";
import { FIXED_NOW, tripConfig, tripPull } from "../test/fixtures.ts";

function chromiumAvailable(): boolean {
  try {
    return resolveChromium() !== undefined;
  } catch {
    return false;
  }
}

const MODEL = buildTripModel({
  config: tripConfig(),
  pull: tripPull(),
  linkVerdicts: new Map(),
  generated_at: FIXED_NOW,
});

/** PDF user space is 1/72", CSS px is 1/96" — Chromium writes points. */
const PT_PER_CSS_PX = 72 / 96;

async function render(component: "TripReport" | "OfflineBrief") {
  const { code } = await bundleBrowser(component, MODEL);
  const html = htmlShell({ title: MODEL.title, stylesheet: STYLESHEET, script: code });
  return renderPdf({ html, title: MODEL.title });
}

describe.skipIf(!chromiumAvailable())("PDF render", () => {
  it("produces a single-page mobile PDF from the standard brief", async () => {
    const result = await render("TripReport");
    const doc = await PDFDocument.load(result.bytes);

    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe(MODEL.title);

    // Chromium's phantom trailing page means it always renders one more than
    // it keeps; anything else means the height calculation drifted.
    expect(result.pages_rendered).toBeLessThanOrEqual(2);

    const page = doc.getPage(0);
    expect(Math.round(page.getWidth())).toBe(Math.round(PAGE_WIDTH_PX * PT_PER_CSS_PX));
    // The whole brief on one page: taller than the viewport it was measured in.
    expect(page.getHeight() / PT_PER_CSS_PX).toBeGreaterThan(900);
    expect(page.getHeight() / PT_PER_CSS_PX).toBeGreaterThanOrEqual(result.content_height_px);
  }, 90_000);

  it("produces the offline variant too", async () => {
    const result = await render("OfflineBrief");
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(result.content_height_px).toBeGreaterThan(0);
  }, 90_000);
});
