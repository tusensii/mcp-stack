/**
 * The standard pre-trip brief (#102).
 *
 * Pure layout. Every string was produced by `buildTripModel`, which produced
 * it from a template — this component never composes prose, so the tone rules
 * cannot drift here.
 */

import type { TripModel } from "../model/trip.ts";
import { ClimbChart, PrecipBars } from "./Chart.tsx";
import { Citations, LinkList, Phones, Refresh, SectionBlock, Warnings } from "./parts.tsx";

export function TripReport({ model }: { model: TripModel }) {
  return (
    <div className="page">
      <h1 className="doc-title">{model.title}</h1>
      {model.subtitle ? <p className="doc-subtitle">{model.subtitle}</p> : null}
      <p className="doc-dates">
        {model.date_range}
        {model.area_name ? ` · ${model.area_name}` : ""}
      </p>

      <section>
        <h2 className="section">Summary</h2>
        {model.summary.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <PrecipBars days={model.days} />
      </section>

      <CampSection model={model} />

      {model.climb ? (
        <section>
          <h2 className="section">{model.climb.heading}</h2>
          <p>{model.climb.summary}</p>
          {model.climb.precip ? <p>{model.climb.precip}</p> : null}
          <ClimbChart series={model.climb.series} />
          <p className="chart-caption">{model.climb.caveat}</p>
          {model.climb.gear.length ? (
            <ul className="lines">
              {model.climb.gear.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/*
        The forecast sentences are already the Summary above, so the Days
        spine carries only what is not up there: the date and the light.
        The offline variant has no Summary and does print both.
      */}
      <section>
        <h2 className="section">Days</h2>
        {model.days.map((day) => (
          <div key={day.iso} className={day.is_climb_day ? "day climb" : "day"}>
            <div className="day-heading">{day.heading}</div>
            <div className="day-sun">{day.sun}</div>
          </div>
        ))}
      </section>

      <SectionBlock section={model.hazards} />
      <SectionBlock section={model.ranger} />

      {model.roles.length ? (
        <section>
          <h2 className="section">Who has what</h2>
          <dl className="kv">
            {model.roles.map((r) => (
              <div key={`${r.role}-${r.who}`} style={{ display: "contents" }}>
                <dt>{r.role}</dt>
                <dd>
                  {r.who}
                  {r.note ? ` — ${r.note}` : ""}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <SectionBlock section={model.access} />

      {model.directions_out.length ? (
        <section>
          <h2 className="section">Drive out</h2>
          <ol className="steps">
            {model.directions_out.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      ) : null}

      <SectionBlock section={model.rivers} />
      <SectionBlock section={model.water} />

      {model.reports.length ? (
        <section>
          <h2 className="section">Recent trip reports</h2>
          <p className="hedge">Reported by hikers: unverified first-hand accounts.</p>
          <ul className="lines">
            {model.reports.map((r) => (
              <li key={`${r.title}-${r.url ?? ""}`}>
                {r.url && r.render === "anchor" ? (
                  <a href={r.url} rel="noreferrer">
                    {r.title}
                  </a>
                ) : (
                  r.title
                )}
                {r.date ? ` — ${r.date}` : ""}
                {r.source ? ` (${r.source})` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <SectionBlock section={model.permits_catalog} />

      {model.phones.length ? (
        <section>
          <h2 className="section">Phone</h2>
          <Phones phones={model.phones} />
        </section>
      ) : null}

      {model.links.length ? (
        <section>
          <h2 className="section">Links</h2>
          <LinkList links={model.links} />
        </section>
      ) : null}

      <Warnings warnings={model.warnings} />
      <Citations citations={model.citations} />
      <Refresh line={model.refresh_line} />
    </div>
  );
}

function CampSection({ model }: { model: TripModel }) {
  const camp = model.camp;
  const hasBody = camp.lines.length > 0 || camp.checklist.length > 0;
  if (!camp.headline && !hasBody) return null;
  return (
    <section>
      <h2 className="section">Camp and permit</h2>
      <div className={camp.verified ? "card" : "card warn"}>
        <div className="card-title">{camp.headline}</div>
        {camp.lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      {camp.checklist.length ? (
        <ul className="lines">
          {camp.checklist.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
