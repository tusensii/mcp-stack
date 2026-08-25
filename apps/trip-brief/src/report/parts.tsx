/**
 * Shared report fragments.
 *
 * The link renderer is the enforcement point for #105: a URL that did not
 * pass build-time verification renders as plain text, never as an anchor, so
 * a dead link is visibly a string rather than an invitation to tap.
 */

import type { RenderedLink, Section } from "../model/trip.ts";

export function SectionBlock({ section }: { section: Section | null }) {
  if (!section) return null; // STYLE.md rule 9: omit, don't scaffold.
  return (
    <section>
      <h2 className="section">{section.title}</h2>
      {section.paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
      {section.bullets.length ? (
        <ul className="lines">
          {section.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function LinkItem({ link, plain }: { link: RenderedLink; plain?: boolean }) {
  if (plain || link.render === "text") {
    return (
      <span>
        {link.label} <span className="plain-url">{link.url}</span>
      </span>
    );
  }
  return (
    <a href={link.url} rel="noreferrer">
      {link.label}
    </a>
  );
}

export function LinkList({ links, plain }: { links: RenderedLink[]; plain?: boolean }) {
  if (!links.length) return null;
  return (
    <ul className="lines">
      {links.map((l) => (
        <li key={l.url}>
          <LinkItem link={l} plain={plain} />
        </li>
      ))}
    </ul>
  );
}

export function Phones({
  phones,
  plain,
}: {
  phones: Array<{ label: string; number: string; hours?: string }>;
  plain?: boolean;
}) {
  if (!phones.length) return null;
  return (
    <ul className="lines">
      {phones.map((p) => (
        <li key={`${p.label}-${p.number}`}>
          {p.label}:{" "}
          {plain ? (
            <span className="tel-plain">{p.number}</span>
          ) : (
            <a href={`tel:${p.number.replace(/[^\d+]/g, "")}`}>{p.number}</a>
          )}
          {p.hours ? ` — ${p.hours}` : null}
        </li>
      ))}
    </ul>
  );
}

export function Citations({
  citations,
  plain,
}: {
  citations: Array<{ name: string; url: string; tier_label: string; render: "anchor" | "text" }>;
  plain?: boolean;
}) {
  if (!citations.length) return null;
  return (
    <section>
      <h2 className="section">Sources and method</h2>
      <ul className="lines citations">
        {citations.map((c) => (
          <li key={c.url}>
            {plain || c.render === "text" ? (
              <>
                {c.name} <span className="plain-url">{c.url}</span>
              </>
            ) : (
              <a href={c.url} rel="noreferrer">
                {c.name}
              </a>
            )}{" "}
            <span className="citation-tier">{c.tier_label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Warnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <section>
      <h2 className="section">Build notes</h2>
      <ul className="lines">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </section>
  );
}

/** Always the last element rendered (STYLE.md rule 6). */
export function Refresh({ line }: { line: string }) {
  return <div className="refresh">{line}</div>;
}
