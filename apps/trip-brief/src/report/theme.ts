/**
 * Report stylesheet.
 *
 * Sized for a 430px viewport because the artifact and the PDF are the same
 * document and the PDF is read on a phone. Everything is a single column;
 * nothing depends on hover, and no rule assumes a viewport wider than the
 * page. Colours are fixed light: this prints, and a theme-aware brief that
 * renders white-on-white in someone's PDF viewer is a bug, not a feature.
 */

export const PAGE_WIDTH_PX = 430;

export const STYLESHEET = `
:root {
  --ink: #16191d;
  --ink-soft: #4a5058;
  --ink-faint: #757d87;
  --rule: #dcdfe4;
  --rule-soft: #eceef1;
  --bg: #ffffff;
  --bg-soft: #f6f7f9;
  --accent: #1f4f7a;
  --warn-bg: #fdf4e3;
  --warn-rule: #e0b96a;
  --bad-bg: #fbeeec;
  --bad-rule: #d9a49c;
  --good: #1d6b45;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--ink);
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}

.page {
  width: ${PAGE_WIDTH_PX}px;
  margin: 0 auto;
  padding: 22px 20px 28px;
}

.doc-title {
  font-size: 22px;
  line-height: 1.2;
  font-weight: 700;
  margin: 0 0 2px;
  letter-spacing: -0.01em;
}

.doc-subtitle {
  font-size: 14px;
  color: var(--ink-soft);
  margin: 0 0 2px;
}

.doc-dates {
  font-size: 13px;
  color: var(--ink-faint);
  margin: 0 0 18px;
}

/* One title per section. No pre-headers, no teasers (STYLE.md rule 3). */
h2.section {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  font-weight: 700;
  color: var(--ink-faint);
  margin: 22px 0 8px;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--rule);
}

p { margin: 0 0 8px; }
p:last-child { margin-bottom: 0; }

ul.lines {
  list-style: none;
  margin: 0;
  padding: 0;
}

ul.lines > li {
  position: relative;
  padding-left: 14px;
  margin-bottom: 6px;
}

ul.lines > li::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 8px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--ink-faint);
}

ol.steps {
  margin: 0;
  padding-left: 20px;
}
ol.steps > li { margin-bottom: 6px; }

.day {
  border-left: 2px solid var(--rule);
  padding: 0 0 0 11px;
  margin-bottom: 14px;
}
.day.climb { border-left-color: var(--accent); }
.day-heading {
  font-weight: 650;
  font-size: 14px;
  margin-bottom: 3px;
}
.day-sun {
  font-size: 12.5px;
  color: var(--ink-faint);
}

.card {
  background: var(--bg-soft);
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  padding: 12px 13px;
  margin-bottom: 12px;
}
.card.warn { background: var(--warn-bg); border-color: var(--warn-rule); }
.card.bad  { background: var(--bad-bg);  border-color: var(--bad-rule); }

.card-title {
  font-weight: 650;
  font-size: 14.5px;
  margin-bottom: 4px;
}
.card-meta {
  font-size: 12.5px;
  color: var(--ink-soft);
  margin-bottom: 6px;
}

.kv {
  display: grid;
  grid-template-columns: minmax(88px, auto) 1fr;
  gap: 3px 12px;
  font-size: 13px;
}
.kv dt { color: var(--ink-faint); }
.kv dd { margin: 0; }

table.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  margin: 6px 0 2px;
}
table.grid th,
table.grid td {
  text-align: left;
  padding: 4px 6px 4px 0;
  border-bottom: 1px solid var(--rule-soft);
}
table.grid th {
  color: var(--ink-faint);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
/* Numeric headers must track their cells or the columns read as misaligned. */
table.grid th.num,
table.grid td.num { text-align: right; padding-right: 0; }
table.grid td.num { font-variant-numeric: tabular-nums; }

a { color: var(--accent); }

/* An unverified URL never becomes an anchor (#105). */
.plain-url {
  color: var(--ink-soft);
  word-break: break-all;
  font-size: 12px;
}

.tel-plain {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.pill {
  display: inline-block;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--rule-soft);
  color: var(--ink-soft);
}
.pill.ok   { background: #e3f1e9; color: var(--good); }
.pill.fail { background: #f6e2de; color: #8d3125; }

.hedge {
  font-size: 12.5px;
  color: var(--ink-soft);
  font-style: italic;
}

.chart { display: block; width: 100%; height: auto; margin: 8px 0 4px; }
.chart-caption {
  font-size: 11.5px;
  color: var(--ink-faint);
  margin-top: 2px;
}

.citations { font-size: 12px; color: var(--ink-soft); }
.citations li { margin-bottom: 5px; }
.citation-tier {
  display: inline-block;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-faint);
}

.stale-banner {
  border: 1px solid var(--warn-rule);
  background: var(--warn-bg);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 16px;
  font-size: 13px;
}
.stale-banner strong { display: block; font-size: 13.5px; margin-bottom: 2px; }

/* STYLE.md rule 6: the refresh timestamp is the last line, always. */
.refresh {
  margin-top: 24px;
  padding-top: 10px;
  border-top: 1px solid var(--rule);
  font-size: 11.5px;
  color: var(--ink-faint);
}
`;
