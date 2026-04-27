/**
 * Devise-style Rails authentication: GET sign-in page, extract the form
 * `authenticity_token`, POST credentials, expect a 302, then GET a
 * post-login page to extract the meta `csrf-token` for subsequent XHRs.
 *
 * The two CSRF tokens are different: the form token lives in the
 * `<input name="authenticity_token">` of the sign-in form, the XHR
 * token lives in the `<meta name="csrf-token">` of authenticated
 * pages. Rails rotates the token on auth — using the form token for
 * later XHRs will fail with InvalidAuthenticityToken (HTTP 422).
 */

import {
  createFetchClient,
  HttpError,
  type FetchClient,
} from "@mcp-stack/http-fetch";
import { AuthExpired } from "@mcp-stack/mcp-core";

export class InvalidCredentials extends Error {
  override readonly name = "InvalidCredentials";
  constructor(message?: string) {
    super(message ?? "Invalid email or password");
  }
}

export class CsrfMismatch extends Error {
  override readonly name = "CsrfMismatch";
  constructor(message?: string) {
    super(message ?? "CSRF token rejected by server");
  }
}

export class AccountLocked extends Error {
  override readonly name = "AccountLocked";
  constructor(message?: string) {
    super(message ?? "Account is locked");
  }
}

export interface RailsAuthOptions {
  baseUrl: string;
  email: string;
  password: string;
  /**
   * Sign-in path. Common values: `"/sign_in"`, `"/users/sign_in"`,
   * `"/clients/sign_in"`. Required — Rails apps vary.
   */
  loginPath: string;
  /**
   * Path fetched after a successful POST to extract the meta `csrf-token`
   * for XHRs. Default `"/"`. Should be a page only authenticated users
   * can access — otherwise the post-login check can't detect a failed
   * session establishment.
   */
  postLoginPath?: string;
  /**
   * Devise resource scope, used to construct form field names like
   * `<resource>[email]` and `<resource>[password]`. Default `"user"`.
   */
  resource?: string;
  /** Send a `Referer` header on the POST, matching the login URL. Default `true`. */
  sendReferer?: boolean;
  /** Optional User-Agent. */
  userAgent?: string;
  /** Headers applied to every request (e.g. `Accept`, `X-Requested-With`). */
  defaultHeaders?: Record<string, string>;
  /** Override the request timeout (ms). Default 30000. */
  timeoutMs?: number;
}

export interface RailsAuthClient {
  /** Authenticated fetch with cookies and `X-CSRF-Token` applied automatically. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** JSON convenience: fetches and parses, throws `HttpError` on non-2xx. */
  json<T>(path: string, init?: RequestInit): Promise<T>;
  /** Drop the cached session so the next call re-runs the login flow. */
  invalidateSession(): void;
}

/**
 * Build a Rails-aware authenticated client. The first authenticated call
 * triggers a lazy login; the result is cached for the lifetime of the
 * client instance. On 401 or a 302 to the sign-in path, the session is
 * invalidated and one re-auth attempt is made before failing with
 * `AuthExpired`.
 */
export function createRailsAuthClient(options: RailsAuthOptions): RailsAuthClient {
  const {
    baseUrl,
    email,
    password,
    loginPath,
    postLoginPath = "/",
    resource = "user",
    sendReferer = true,
    userAgent,
    defaultHeaders,
    timeoutMs,
  } = options;

  const http: FetchClient = createFetchClient({
    baseUrl,
    userAgent,
    defaultHeaders,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    retries: 0,
  });

  let csrfToken: string | null = null;
  let authenticated = false;

  function invalidateSession(): void {
    csrfToken = null;
    authenticated = false;
    http.jar.clear();
  }

  async function login(): Promise<void> {
    // Login pages are HTML — override any consumer-set Accept (which is
    // typically "application/json" for the post-auth XHR calls). Sending
    // a JSON Accept against /sign_in makes some Rails apps return 500.
    const HTML_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

    const pageRes = await http.fetch(loginPath, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: HTML_ACCEPT },
    });
    if (!pageRes.ok && pageRes.status !== 302) {
      throw new Error(`GET ${loginPath} failed: ${pageRes.status}`);
    }
    const pageHtml = await pageRes.text();
    const formToken = extractFormToken(pageHtml);
    if (!formToken) {
      throw new Error(`Could not extract authenticity_token from ${loginPath}`);
    }

    const body = new URLSearchParams({
      authenticity_token: formToken,
      [`${resource}[email]`]: email,
      [`${resource}[password]`]: password,
    });

    const postHeaders: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: HTML_ACCEPT,
    };
    if (sendReferer) postHeaders["Referer"] = `${baseUrl}${loginPath}`;

    const loginRes = await http.fetch(loginPath, {
      method: "POST",
      headers: postHeaders,
      body: body.toString(),
      redirect: "manual",
    });

    if (loginRes.status !== 302) {
      const errBody = await loginRes.text().catch(() => "");
      if (errBody.includes("Invalid authenticity token")) throw new CsrfMismatch();
      if (/locked|too many|Try again/i.test(errBody)) throw new AccountLocked();
      if (/invalid/i.test(errBody)) throw new InvalidCredentials();
      throw new InvalidCredentials(`Unexpected login response: HTTP ${loginRes.status}`);
    }

    const after = await http.fetch(postLoginPath, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: HTML_ACCEPT },
    });
    if (
      after.status === 302 &&
      (after.headers.get("Location") ?? "").includes(loginPath)
    ) {
      throw new InvalidCredentials("Login appeared to succeed but session was not established");
    }
    if (!after.ok) {
      throw new Error(`GET ${postLoginPath} after login failed: ${after.status}`);
    }
    const afterHtml = await after.text();
    const meta = extractMetaCsrf(afterHtml);
    if (!meta) {
      throw new Error(`Could not extract csrf-token meta from ${postLoginPath}`);
    }
    csrfToken = meta;
    authenticated = true;
  }

  async function authenticatedFetch(
    path: string,
    init: RequestInit = {},
    attempt = 0,
  ): Promise<Response> {
    if (!authenticated) await login();

    const headers = new Headers(init.headers);
    if (csrfToken && !headers.has("X-CSRF-Token")) {
      headers.set("X-CSRF-Token", csrfToken);
    }

    const res = await http.fetch(path, { ...init, headers, redirect: "manual" });

    const redirectedToLogin =
      res.status === 302 && (res.headers.get("Location") ?? "").includes(loginPath);
    const expired = res.status === 401 || redirectedToLogin;

    if (expired) {
      if (attempt >= 1) throw new AuthExpired("Re-authentication failed");
      invalidateSession();
      return authenticatedFetch(path, init, attempt + 1);
    }

    return res;
  }

  async function authenticatedJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await authenticatedFetch(path, init);
    if (!res.ok) {
      const body = await res.text().catch(() => undefined);
      throw new HttpError(res.status, `HTTP ${res.status} ${res.statusText}`, body);
    }
    return (await res.json()) as T;
  }

  return {
    fetch: authenticatedFetch,
    json: authenticatedJson,
    invalidateSession,
  };
}

/**
 * Extract the form-level `authenticity_token` from a sign-in page.
 * Returns null if the input is missing — caller decides how to fail.
 */
export function extractFormToken(html: string): string | null {
  const a = html.match(/name=["']authenticity_token["'][^>]+value=["']([^"']+)["']/i);
  if (a?.[1]) return a[1];
  const b = html.match(/value=["']([^"']+)["'][^>]+name=["']authenticity_token["']/i);
  return b?.[1] ?? null;
}

/**
 * Extract the XHR `csrf-token` meta tag from an authenticated page.
 * This is *not* the same as the form token — Rails rotates the token
 * on auth and uses different ones for form submission vs XHR.
 */
export function extractMetaCsrf(html: string): string | null {
  const a = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i);
  if (a?.[1]) return a[1];
  const b = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i);
  return b?.[1] ?? null;
}
