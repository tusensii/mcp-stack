/**
 * Thin Sessions Health request layer over @mcp-stack/auth-rails.
 *
 * auth-rails owns cookies, CSRF token rotation, and the 401/302-to-login
 * re-auth retry. This file exists for ergonomics:
 *   - the same shGet/shPost/shPatch signatures the original client used,
 *     so endpoints.ts can remain unchanged
 *   - ShApiError mapping for HttpError responses, so tools see a stable
 *     error class
 *   - 200-empty-body handling on PATCH (Sessions Health returns no body
 *     on /appointment_requests/{id}/cancel)
 */

import { HttpError } from "@mcp-stack/http-fetch";
import { getAuth, BASE_URL } from "./auth.js";
import type { AuthEnv } from "./auth.js";

export class ShApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ShApiError";
  }
}

const COMMON_HEADERS: Record<string, string> = {
  Accept: "application/json, text/javascript",
  Origin: BASE_URL,
  Referer: `${BASE_URL}/appointments`,
};

function mapError(path: string, e: unknown): never {
  if (e instanceof HttpError) {
    if (e.status === 404) {
      throw new ShApiError(404, `Resource not found: ${path}`);
    }
    throw new ShApiError(e.status, `Sessions Health error ${e.status} on ${path}`);
  }
  throw e;
}

export async function shGet<T>(
  path: string,
  env: AuthEnv,
  params?: Record<string, string>,
): Promise<T> {
  let fullPath = path;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    fullPath = `${path}?${qs}`;
  }
  const auth = getAuth(env);
  try {
    return await auth.json<T>(fullPath, {
      method: "GET",
      headers: COMMON_HEADERS,
    });
  } catch (e) {
    mapError(path, e);
  }
}

export async function shPost<T>(
  path: string,
  env: AuthEnv,
  body: unknown,
): Promise<T> {
  const auth = getAuth(env);
  try {
    return await auth.json<T>(path, {
      method: "POST",
      headers: {
        ...COMMON_HEADERS,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    mapError(path, e);
  }
}

export async function shPatch<T>(
  path: string,
  env: AuthEnv,
  body?: unknown,
): Promise<T> {
  const auth = getAuth(env);
  const init: RequestInit = {
    method: "PATCH",
    headers: {
      ...COMMON_HEADERS,
      "Content-Type": "application/json; charset=UTF-8",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  try {
    const res = await auth.fetch(path, init);
    if (!res.ok) {
      const errBody = await res.text().catch(() => undefined);
      throw new HttpError(
        res.status,
        `HTTP ${res.status} ${res.statusText}`,
        errBody,
      );
    }
    // Sessions Health returns 200 with empty body on PATCH cancel.
    if (res.status === 200 && res.headers.get("content-length") === "0") {
      return {} as T;
    }
    const text = await res.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  } catch (e) {
    mapError(path, e);
  }
}
