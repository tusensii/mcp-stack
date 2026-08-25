# Trip-brief style guide

Tone rules for anything the generator renders, and for any editing session
that touches `src/prose/templates.ts` or a report component.

These are not preferences to weigh. They were arrived at by correcting the
same drift three times during the Aug 2026 Royal Basin cycle. A template
cannot drift; a freehand rewrite can, which is why prose lives in templates
and this file exists next to them.

## The rules

1. **Dry, matter-of-fact, declarative.** State the value. `Saturday is 12%
   chance of rain, high near 68°F, low 44°F.` Nothing is "looking solid" and
   nothing "carries a" percentage.

2. **Current state only.** The report says what the forecast is now. It never
   says what it was, how it changed, or which direction it is trending.
   Change summaries are useful — they belong in the chat message that
   accompanies a refresh, not in the document.

3. **No mini pre-headers.** A section has one title. It does not get a bolded
   lead-in phrase, an emoji, or a one-line teaser above the content.

4. **Plain section titles.** `Weather`, `Camp`, `Getting there`. Not
   `Weather outlook & considerations`.

5. **Citations and methodology in exactly one section, at the end.** Optional
   — omit it entirely rather than rendering an empty scaffold. Nothing is
   cited inline.

6. **The refresh timestamp is the last line of the document.** Always
   present, always last.

7. **No editorializing and no verdicts.** The report does not conclude that a
   trip is on or off. It reports the conditions that decision is made from.

8. **Hedge visibly or not at all.** A fact that is not solid gets an explicit
   prefix (`Unverified lookup:`, `Reported by hikers:`, `Low confidence:`) or
   it is left out. Nothing is quietly softened with "should" or "likely".

9. **Omit, don't scaffold.** A section with no data does not render. There are
   no "None reported" placeholders except where absence is itself the fact
   (no active alerts, no thunderstorms).

## Canonical forms

| Thing | Form |
| --- | --- |
| Day summary | `{Day} is {pct}% chance of rain, high near {hi}°F, low {lo}°F.` |
| Thunder | `Thunderstorms are in the forecast for {days}.` / `No thunderstorms are in the forecast for the trip window.` |
| Alerts | `Active NWS alerts: {list}.` / `No active NWS alerts for the point.` |
| Sun | `{Day}: sunrise {t}, sunset {t}, dark {t}.` |
| Camp | `Camp is {area} for {n} nights, at {elev} ft.` |
| Gauge | `{Site} is {n} cfs, {context}, read {time}.` |
| Road | `{Road} is {status}, {detail}.` |
| Drive | `Drive from {origin} is {h} hr {m} min.` |

## Enforcement

`lintTone()` in `src/prose/templates.ts` holds the banned-phrase list from the
corrections that were actually needed. It runs over every rendered string in
`src/prose/templates.test.ts` and over the assembled model in
`src/model/trip.test.ts`, so a reintroduced construction fails CI rather than
review.

Determinism is enforced the same way: `render the same data twice → identical
output` is a test, because a template that reaches for a clock or a random
tiebreak stops being a template.

## Adding prose

New sentence forms go in `src/prose/templates.ts` as pure functions of their
arguments. If a component is about to interpolate a string inline, that is the
signal to add a template instead.
