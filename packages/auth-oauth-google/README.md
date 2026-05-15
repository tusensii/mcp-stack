# @mcp-stack/auth-oauth-google

Google OAuth 2.0 client builder. Wraps `OAuth2Client` from
`google-auth-library` with refresh-token credentials, so apps can import
`google.gmail()` / `google.calendar()` from `googleapis` and pass the
configured auth straight in. Refresh handling is delegated to the library
— it auto-refreshes on 401.

The package's job is normalizing how secrets are shaped (raw JSON vs
parsed objects from Google Cloud Console's "Download JSON" output, with
the `web`/`installed` envelope handled either way) and translating common
failure modes into `AuthExpired`. Used by `gmail-mcp` and `otf-mcp`.
