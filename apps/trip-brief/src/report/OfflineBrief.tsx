/**
 * The offline companion (#107).
 *
 * A different document from the pre-trip brief, not a stylesheet variant of
 * it. The reader has no signal, is standing in a parking lot or a basin, and
 * needs the facts that a tappable link was standing in for: the phone number
 * as digits, the coordinates as numbers, the reservation printed in full, and
 * the drive home written out in the direction they are about to drive it.
 *
 * Nothing here renders an anchor. Every link is plain text, so a PDF viewer
 * that mangles hrefs, or a phone with no data, costs the reader nothing.
 */

import type { TripModel } from "../model/trip.ts";
import { Citations, LinkList, Phones, Refresh, SectionBlock } from "./parts.tsx";

export function OfflineBrief({ model }: { model: TripModel }) {
  return (
    <div className="page">
      <h1 className="doc-title">{model.title} — offline copy</h1>
      <p className="doc-dates">
        {model.date_range}
        {model.area_name ? ` · ${model.area_name}` : ""}
      </p>

      {/* Staleness is the first thing a field reader needs to judge. */}
      <div className="stale-banner">
        <strong>This copy does not update.</strong>
        {model.refresh_line} Weather and road status below are that old.
      </div>

      <ReservationBlock model={model} />

      <section>
        <h2 className="section">Phone</h2>
        <Phones phones={model.phones} plain />
        {model.phones.length ? null : <p>No numbers were supplied in the trip config.</p>}
      </section>

      <section>
        <h2 className="section">Coordinates</h2>
        <ul className="lines">
          {model.coordinates.map((c) => (
            <li key={c.label}>
              <span className="tel-plain">
                {c.lat.toFixed(5)}, {c.lon.toFixed(5)}
              </span>{" "}
              — {c.label}
              {c.elevation_ft ? ` (${c.elevation_ft.toLocaleString("en-US")} ft)` : ""}
            </li>
          ))}
        </ul>
      </section>

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

      {model.directions_back.length ? (
        <section>
          <h2 className="section">Drive home</h2>
          {model.directions_back_derived ? (
            <p className="hedge">
              Reversed from the outbound steps. Check turn directions against the road.
            </p>
          ) : null}
          <ol className="steps">
            {model.directions_back.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      ) : null}

      <section>
        <h2 className="section">Days</h2>
        {model.days.map((day) => (
          <div key={day.iso} className={day.is_climb_day ? "day climb" : "day"}>
            <div className="day-heading">{day.heading}</div>
            {day.forecast ? <p>{day.forecast}</p> : null}
            <div className="day-sun">{day.sun}</div>
          </div>
        ))}
      </section>

      <SectionBlock section={model.hazards} />
      <SectionBlock section={model.ranger} />

      {model.roles.length ? (
        <section>
          <h2 className="section">Who has what</h2>
          <ul className="lines">
            {model.roles.map((r) => (
              <li key={`${r.role}-${r.who}`}>
                {r.role}: {r.who}
                {r.note ? ` — ${r.note}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <SectionBlock section={model.access} />
      <SectionBlock section={model.rivers} />
      <SectionBlock section={model.water} />

      {model.links.length ? (
        <section>
          <h2 className="section">Links (printed, not tappable)</h2>
          <LinkList links={model.links} plain />
        </section>
      ) : null}

      <Citations citations={model.citations} plain />
      <Refresh line={model.refresh_line} />
    </div>
  );
}

function ReservationBlock({ model }: { model: TripModel }) {
  const camp = model.camp;
  return (
    <section>
      <h2 className="section">Camp and permit</h2>
      <div className={camp.verified ? "card" : "card warn"}>
        <div className="card-title">{camp.headline}</div>
        {camp.reservation_facts.length ? (
          <dl className="kv">
            {camp.reservation_facts.map((f) => (
              <div key={f.label} style={{ display: "contents" }}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
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
