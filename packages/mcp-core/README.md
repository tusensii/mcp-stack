# @mcp-stack/mcp-core

Thin shared layer over `@modelcontextprotocol/sdk` and Cloudflare's `agents`
package. Owns the cross-cutting bits — URL path-secret check, tool-response
shape, and the `AuthExpired` / `RateLimited` error classes the auth packages
throw. The Workers-only `createMcpWorker` lives at the `/worker` subpath so
that loading this package in Node (tests, build tools) doesn't trigger
`cloudflare:`-scheme imports.

Apps register tools with the SDK's `McpServer` directly — `mcp-core` does
not abstract that away.
