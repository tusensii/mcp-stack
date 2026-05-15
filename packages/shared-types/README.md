# @mcp-stack/shared-types

Cross-MCP TypeScript types. Only types that two or more apps reference
belong here — app-specific shapes (e.g. Oura sleep payloads) stay in the
app.

Exports `IsoDateTime`, `IsoDate`, `TimeWindow`, `Address`, `Location`,
`BookingStatus`. Zero runtime code; pure `.d.ts` after `tsc`.
