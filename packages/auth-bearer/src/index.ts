/**
 * Static-token authentication. The simplest of the auth packages —
 * a personal-access-token shipped in a request header.
 *
 * Supports custom header names and schemes (Oura uses `Authorization:
 * Bearer <PAT>`; APIs that use `X-Api-Key: <token>` are also covered).
 */

import { createFetchClient, type FetchClient, type FetchClientOptions } from "@mcp-stack/http-fetch";

export interface BearerOptions {
  /** The token. Required and non-empty. */
  token: string;
  /** Header name. Default `"Authorization"`. */
  header?: string;
  /**
   * Scheme prefix. Default `"Bearer"`. Pass an empty string to send
   * the raw token without a scheme (e.g. for `X-Api-Key`).
   */
  scheme?: string;
}

/**
 * Build the request header that carries the token. Useful when you
 * already have a fetch client and just need the header.
 */
export function bearerHeader(options: BearerOptions): Record<string, string> {
  const { token, header = "Authorization", scheme = "Bearer" } = options;
  if (!token) throw new Error("bearerHeader: token is required");
  const value = scheme ? `${scheme} ${token}` : token;
  return { [header]: value };
}

/**
 * Build a `FetchClient` with the bearer header baked into every
 * outbound request. Accepts the same options as `createFetchClient`
 * for `baseUrl`, `userAgent`, timeouts, and retries.
 */
export function createBearerClient(
  options: BearerOptions & Omit<FetchClientOptions, "defaultHeaders"> & {
    defaultHeaders?: Record<string, string>;
  },
): FetchClient {
  const { token, header, scheme, defaultHeaders, ...rest } = options;
  return createFetchClient({
    ...rest,
    defaultHeaders: {
      ...defaultHeaders,
      ...bearerHeader({ token, header, scheme }),
    },
  });
}
