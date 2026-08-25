import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { bundleBrowser, bundleJsx, htmlShell } from "./bundle.ts";
import { resolveChromium, trimAndStamp } from "./pdf.ts";
import { buildTripModel } from "../model/trip.ts";
import { buildOptionsModel } from "../model/options.ts";
import { FIXED_NOW, optionsConfig, tripConfig, tripPull } from "../test/fixtures.ts";

const MODEL = buildTripModel({
  config: tripConfig(),
  pull: tripPull(),
  linkVerdicts: new Map(),
  generated_at: FIXED_NOW,
});

describe("bundleJsx", () => {
  it("emits self-contained JSX with the data inlined", async () => {
    const { code } = await bundleJsx("TripReport", MODEL);
    // JSX survives the bundle, so the output drops into a React host as-is.
    expect(code).toContain("<style>");
    // esbuild hoists the default export into the trailing export clause.
    expect(code).toContain("function Report()");
    expect(code).toContain("Report as default");
    // The model is baked in — no fetch, no import of a data file.
    expect(code).toContain("OLYM-2026-884213");
    expect(code).not.toMatch(/^import .* from "\.\//m);
  });

  it("leaves React to the host rather than bundling it", async () => {
    const { code } = await bundleJsx("TripReport", MODEL);
    expect(code).not.toContain("react-dom/client");
  });

  it("bundles every component variant", async () => {
    const offline = await bundleJsx("OfflineBrief", MODEL);
    expect(offline.code).toContain("offline copy");

    const optionsModel = buildOptionsModel({
      config: optionsConfig(),
      pull: { candidates: [], pulled_at: FIXED_NOW },
      linkVerdicts: new Map(),
      generated_at: FIXED_NOW,
    });
    const options = await bundleJsx("OptionsCard", optionsModel);
    expect(options.code).toContain("Criteria");
  });
});

describe("bundleBrowser", () => {
  it("emits a minified IIFE with React bundled in", async () => {
    const { code } = await bundleBrowser("TripReport", MODEL);
    expect(code.startsWith("(()=>{")).toBe(true);
    expect(code).toContain("OLYM-2026-884213");
    // React itself is included, so the HTML shell fetches nothing.
    expect(code.length).toBeGreaterThan(50_000);
  });

  it("produces a shell that references no external resource", async () => {
    const { code } = await bundleBrowser("TripReport", MODEL);
    const html = htmlShell({ title: MODEL.title, stylesheet: "body{}", script: code });
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
  });

  it("escapes the title into the shell", () => {
    const html = htmlShell({ title: 'Royal "Basin" <b>', stylesheet: "", script: "" });
    expect(html).toContain("<title>Royal &quot;Basin&quot; &lt;b&gt;</title>");
  });
});

describe("trimAndStamp", () => {
  async function twoPagePdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.addPage([430, 900]);
    doc.addPage([430, 900]); // the phantom trailing page Chromium always emits
    return doc.save();
  }

  it("drops the phantom trailing page", async () => {
    const { bytes, pages_rendered } = await trimAndStamp(await twoPagePdf(), "Royal Basin");
    expect(pages_rendered).toBe(2);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("stamps the title metadata", async () => {
    const { bytes } = await trimAndStamp(await twoPagePdf(), "Royal Basin");
    expect((await PDFDocument.load(bytes)).getTitle()).toBe("Royal Basin");
  });

  it("leaves a single-page document alone", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([430, 900]);
    const { bytes, pages_rendered } = await trimAndStamp(await doc.save(), "x");
    expect(pages_rendered).toBe(1);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("warns rather than silently discarding when more than one page is extra", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 4; i++) doc.addPage([430, 900]);
    const logs: string[] = [];
    await trimAndStamp(await doc.save(), "x", (m) => logs.push(m));
    expect(logs.join(" ")).toContain("clipped content");
  });
});

describe("resolveChromium", () => {
  it("throws on an explicit path that does not exist", () => {
    expect(() => resolveChromium({ TRIP_BRIEF_CHROMIUM: "/nope/chrome" })).toThrow(
      /missing file/,
    );
  });

  it("returns undefined when nothing is configured, deferring to playwright", () => {
    expect(resolveChromium({})).toBeUndefined();
  });
});
