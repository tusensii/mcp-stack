/**
 * Structured logger gated on env flag. No-op unless `env.DEBUG === "true"`
 * or `env.OBSERVABILITY === "true"`. Output is one JSON line per call,
 * suitable for `wrangler tail`.
 *
 * The point is verbosity discipline: production Workers stay quiet,
 * but flipping a secret (`wrangler secret put DEBUG --value true`)
 * turns logging on without a redeploy.
 */

export interface LoggerEnv {
  DEBUG?: string;
  OBSERVABILITY?: string;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/**
 * Build a logger. Returns no-op methods when the env flag is unset, so
 * call sites incur zero formatting cost in production.
 */
export function logger(env: LoggerEnv): Logger {
  const enabled = env.DEBUG === "true" || env.OBSERVABILITY === "true";
  if (!enabled) {
    const noop = (): void => {};
    return { debug: noop, info: noop, warn: noop, error: noop };
  }
  return {
    debug: (msg, fields) => write("debug", msg, fields),
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
  };
}

function write(level: string, msg: string, fields?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (fields) entry["fields"] = redact(fields);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
}

/**
 * Field names whose values are always replaced with "[REDACTED]".
 * Names are matched case-insensitively. Add to this set rather than
 * inventing per-call-site redaction.
 */
const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "device_key",
  "authorization",
  "cookie",
  "secret",
  "api_key",
  "apikey",
  "client_secret",
]);

/**
 * Replace sensitive field values, and redact email-shaped substrings
 * found inside string values. Non-string, non-sensitive values pass
 * through unchanged.
 */
export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "string") {
      out[k] = redactEmail(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi;

function redactEmail(s: string): string {
  return s.replace(EMAIL_RE, "[email]");
}
