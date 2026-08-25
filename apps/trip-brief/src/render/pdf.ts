/**
 * Single-page mobile PDF (#102).
 *
 * Chromium at a 430px viewport, page height set to the document's own
 * scrollHeight so the whole brief lands on one page, then a post-pass that
 * drops the phantom trailing page Chromium always emits at these dimensions
 * and stamps the title metadata.
 *
 * The Python half of the original sandbox pipeline (pypdf) is done here with
 * pdf-lib instead — same two operations, one fewer runtime to install.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { PDFDocument } from "pdf-lib";
import { PAGE_WIDTH_PX } from "../report/theme.ts";

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

/**
 * Locate a Chromium the way this repo's environments actually provide one:
 * an explicit override, then a Playwright browsers directory, then whatever
 * playwright-core can resolve on its own.
 */
export function resolveChromium(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.TRIP_BRIEF_CHROMIUM?.trim();
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new RenderError(`TRIP_BRIEF_CHROMIUM points at a missing file: ${explicit}`);
    }
    return explicit;
  }

  const root = env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  if (root && existsSync(root)) {
    const direct = join(root, "chromium");
    if (existsSync(direct)) return direct;
    // Versioned layout: chromium-<build>/chrome-linux/chrome
    const candidates = readdirSync(root)
      .filter((d) => d.startsWith("chromium-"))
      .sort()
      .reverse()
      .map((d) => join(root, d, "chrome-linux", "chrome"))
      .filter((p) => existsSync(p));
    if (candidates[0]) return candidates[0];
  }
  // Undefined lets playwright-core use its own registry, if one is installed.
  return undefined;
}

export interface PdfOptions {
  html: string;
  /** Written into the PDF's Title metadata. */
  title: string;
  /**
   * Slack for the computed page height. Chromium rounds CSS pixels to points
   * and a hair of headroom is what keeps the last line off a second page.
   */
  heightSlack?: number;
  onLog?: (message: string) => void;
}

export interface PdfResult {
  bytes: Uint8Array;
  /** Pages Chromium produced before the trim. */
  pages_rendered: number;
  content_height_px: number;
}

export async function renderPdf(opts: PdfOptions): Promise<PdfResult> {
  const log = opts.onLog ?? (() => {});
  const executablePath = resolveChromium();

  let browser: Browser;
  try {
    browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  } catch (cause) {
    throw new RenderError(
      `Could not launch Chromium: ${(cause as Error).message}. Set ` +
        `TRIP_BRIEF_CHROMIUM to a Chromium binary, or PLAYWRIGHT_BROWSERS_PATH ` +
        `to a Playwright browsers directory.`,
    );
  }

  try {
    const page = await browser.newPage({
      viewport: { width: PAGE_WIDTH_PX, height: 900 },
      deviceScaleFactor: 2,
    });
    await page.setContent(opts.html, { waitUntil: "load" });
    // React renders synchronously on mount, but fonts settle a tick later and
    // an unsettled font is a wrong scrollHeight.
    await page.evaluate(() => document.fonts.ready);

    const contentHeight = await page.evaluate(() => {
      const root = document.getElementById("root");
      return Math.ceil(
        Math.max(
          root?.scrollHeight ?? 0,
          document.body.scrollHeight,
          document.documentElement.scrollHeight,
        ),
      );
    });
    if (!contentHeight) {
      throw new RenderError("Rendered document had zero height — the component produced nothing.");
    }

    const slack = opts.heightSlack ?? 1.02;
    const pdfHeight = Math.ceil(contentHeight * slack);
    log(`content height ${contentHeight}px, page height ${pdfHeight}px`);

    const raw = await page.pdf({
      width: `${PAGE_WIDTH_PX}px`,
      height: `${pdfHeight}px`,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    const trimmed = await trimAndStamp(raw, opts.title, log);
    return {
      bytes: trimmed.bytes,
      pages_rendered: trimmed.pages_rendered,
      content_height_px: contentHeight,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Keep page one, drop the rest, set the title.
 *
 * The page height was computed from the document's own scrollHeight, so all
 * content is on page one by construction; anything after it is the phantom
 * page Chromium emits at these dimensions. More than one extra page means the
 * height calculation was wrong, which is worth saying out loud rather than
 * silently discarding content.
 */
export async function trimAndStamp(
  input: Uint8Array,
  title: string,
  log: (message: string) => void = () => {},
): Promise<{ bytes: Uint8Array; pages_rendered: number }> {
  const doc = await PDFDocument.load(input);
  const pageCount = doc.getPageCount();

  if (pageCount > 2) {
    log(
      `WARNING: Chromium produced ${pageCount} pages; expected 1 plus the phantom ` +
        `trailing page. Keeping page 1 only — check the report for clipped content.`,
    );
  }
  for (let i = pageCount - 1; i >= 1; i--) doc.removePage(i);

  doc.setTitle(title);
  doc.setProducer("trip-brief");
  doc.setCreator("trip-brief");

  const bytes = await doc.save();
  return { bytes, pages_rendered: pageCount };
}
