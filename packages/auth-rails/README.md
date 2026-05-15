# @mcp-stack/auth-rails

Devise-style Rails authentication: GET sign-in page, extract the form
`authenticity_token`, POST credentials, expect a 302, then GET a post-login
page to extract the meta `csrf-token` for subsequent XHRs.

The two CSRF tokens are different — Rails rotates the token on auth, so
using the form token for later XHRs fails with InvalidAuthenticityToken
(HTTP 422). The package also retries once with fresh CSRF on a 422.

Used by `therapy-mcp` against Sessions Health.
