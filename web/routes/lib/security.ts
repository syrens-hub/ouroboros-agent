/**
 * Security Headers
 * ================
 */

import type { ServerResponse } from "http";

export function setSecurityHeaders(res: ServerResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.github.com; img-src 'self' data: https:; font-src 'self'; base-uri 'self';"
  );
}
