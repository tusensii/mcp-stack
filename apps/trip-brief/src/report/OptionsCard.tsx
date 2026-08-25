/**
 * The options card (#106).
 *
 * Nine candidates across three regions, each scored against the same criteria
 * block. Failures render — with the criterion that killed them named — rather
 * than vanishing, because "we already looked at that one" is a fact the group
 * needs as much as the shortlist.
 */

import type { CandidateCard, OptionsModel } from "../model/options.ts";
import { PrecipBars } from "./Chart.tsx";
import { Citations, LinkList, Refresh, Warnings } from "./parts.tsx";

const STYLE_LABEL: Record<CandidateCard["style"], string> = {
  backpack: "Backpack",
  "car-camp": "Car camp",
};

const MECHANISM_LABEL: Record<CandidateCard["permit_mechanism"], string> = {
  none: "No permit",
  "self-issue": "Self-issue",
  "walk-up": "Walk-up",
  reservation: "Reservation",
  lottery: "Lottery",
};

export function OptionsCard({ model }: { model: OptionsModel }) {
  return (
    <div className="page">
      <h1 className="doc-title">{model.title}</h1>
      {model.subtitle ? <p className="doc-subtitle">{model.subtitle}</p> : null}
      <p className="doc-dates">{model.date_range}</p>

      <section>
        <h2 className="section">Criteria</h2>
        <ul className="lines">
          {model.criteria_lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="section">
          Meets criteria ({model.qualified.length})
        </h2>
        {model.qualified.length ? (
          model.qualified.map((c) => <Card key={c.id} card={c} limitPct={model.precip_limit_pct} />)
        ) : (
          <p>No candidate met every criterion.</p>
        )}
      </section>

      {model.disqualified.length ? (
        <section>
          <h2 className="section">Ruled out ({model.disqualified.length})</h2>
          {model.disqualified.map((c) => (
            <Card key={c.id} card={c} limitPct={model.precip_limit_pct} />
          ))}
        </section>
      ) : null}

      {model.excluded_regions.length ? (
        <section>
          <h2 className="section">Regions not searched</h2>
          <ul className="lines">
            {model.excluded_regions.map((r) => (
              <li key={r.name}>
                {r.name} — {r.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Warnings warnings={model.warnings} />
      <Citations citations={model.citations} />
      <Refresh line={model.refresh_line} />
    </div>
  );
}

function Card({ card, limitPct }: { card: CandidateCard; limitPct: number }) {
  return (
    <div className={card.qualified ? "card" : "card bad"}>
      <div className="card-title">
        {card.name}{" "}
        <span className={card.qualified ? "pill ok" : "pill fail"}>
          {card.qualified ? "meets criteria" : "ruled out"}
        </span>
      </div>
      <div className="card-meta">
        {card.region} · {STYLE_LABEL[card.style]} · {MECHANISM_LABEL[card.permit_mechanism]} ·{" "}
        {card.drive_label} drive
        {card.proposed_by ? ` · proposed by ${card.proposed_by}` : ""}
      </div>

      {card.failures.length ? (
        <ul className="lines">
          {card.failures.map((f) => (
            <li key={f.criterion}>{f.detail}</li>
          ))}
        </ul>
      ) : null}

      <table className="grid">
        <thead>
          <tr>
            <th>Day</th>
            <th className="num">Rain</th>
            <th className="num">High</th>
            <th className="num">Low</th>
            <th className="num">Thndr</th>
          </tr>
        </thead>
        <tbody>
          {card.days.map((d) => (
            <tr key={d.iso}>
              <td>{d.short_weekday}</td>
              <td className="num">{d.precip_pct == null ? "—" : `${Math.round(d.precip_pct)}%`}</td>
              <td className="num">{d.high_f == null ? "—" : `${Math.round(d.high_f)}°`}</td>
              <td className="num">{d.low_f == null ? "—" : `${Math.round(d.low_f)}°`}</td>
              <td className="num">{d.thunder ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <PrecipBars days={card.days} limitPct={limitPct} />

      {card.note ? <p>{card.note}</p> : null}
      <LinkList links={card.links} />
    </div>
  );
}
