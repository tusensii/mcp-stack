# @mcp-stack/auth-bearer

Static-token authentication — the simplest auth package. Injects a
personal-access-token into a configurable request header. Supports both
`Authorization: Bearer <PAT>` (Oura's flow) and `X-Api-Key: <token>` style
APIs via the `header` and `scheme` options.

Used by `oura-mcp`. Builds on `@mcp-stack/http-fetch` for the underlying
fetch client.
