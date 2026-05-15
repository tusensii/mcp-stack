# @mcp-stack/http-fetch

Fetch wrapper with the patterns every MCP needs: per-instance cookie jar
(so concurrent requests can't cross-contaminate), retries on 5xx, per-call
timeout, `Retry-After`-aware rate-limit detection, and User-Agent injection.

Exposes `HttpError`, `TimeoutError`, and a `createFetchClient(options)`
factory. Used by `auth-rails`, `auth-bearer`, and tools that need raw HTTP
beyond what the typed clients provide.
