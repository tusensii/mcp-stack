/**
 * Constant-time string comparison. Used for the URL path-secret check
 * to avoid leaking secret length or partial matches via timing.
 *
 * The implementation is portable JS rather than `crypto.subtle.timingSafeEqual`
 * (a Cloudflare-specific extension) so the same code runs in vitest under
 * Node and in the Workers runtime. The threat model is brute-force over
 * the network — JS-level constant-time is adequate.
 */
export function safeCompare(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);

  if (aBuf.byteLength !== bBuf.byteLength) {
    let touch = 0;
    for (let i = 0; i < aBuf.byteLength; i++) touch |= aBuf[i] ?? 0;
    void touch;
    return false;
  }

  let diff = 0;
  for (let i = 0; i < aBuf.byteLength; i++) {
    diff |= (aBuf[i] ?? 0) ^ (bBuf[i] ?? 0);
  }
  return diff === 0;
}
