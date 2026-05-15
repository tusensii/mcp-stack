# @mcp-stack/observability

Structured JSON logger gated on env flag. No-op unless `env.DEBUG === "true"`
or `env.OBSERVABILITY === "true"`, so production Workers stay quiet by default.

Output is one JSON line per call, suitable for `wrangler tail`. Flipping a
secret turns logging on without a redeploy. Also exports `redact()`, which
scrubs `Authorization`/`Password`/`token`/`secret` field values and
email-shaped substrings — used on all logged field payloads.
