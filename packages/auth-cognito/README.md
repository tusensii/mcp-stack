# @mcp-stack/auth-cognito

AWS Cognito refresh-token client. Designed for the case where SRP
authentication is performed once out-of-band (in a bootstrap script on a
developer machine) and the resulting `RefreshToken` + `DeviceKey` are
stored as Worker secrets. The Worker only ever calls `InitiateAuth` with
`REFRESH_TOKEN_AUTH` to mint short-lived ID/access tokens.

Why split? SRP needs Node-only crypto and `amazon-cognito-identity-js`,
neither of which run in the Workers runtime. Refresh tokens are
long-lived enough that re-bootstrapping is rare. Used by `otf-mcp`.
