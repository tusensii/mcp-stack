export interface Env {
  URL_SECRET: string;
  GMAIL_CREDENTIALS: string;
  GMAIL_OAUTH_KEYS: string;
  /**
   * Maximum attachment size in bytes that `gmail_get_attachment` will
   * fetch and decode without the `force: true` flag. Optional —
   * falls back to a 10 MiB default in code if unset or unparseable.
   */
  GMAIL_ATTACHMENT_BYTE_CAP?: string;
}
