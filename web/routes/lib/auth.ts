/**
 * Authentication
 * ==============
 */

import type { IncomingMessage } from "http";
import { createHash, timingSafeEqual } from "crypto";
import { appConfig } from "../../../core/config.ts";

function getApiToken(): string {
  return appConfig.web.apiToken || "";
}

let _authWarningEmitted = false;

export function isAuthValid(req: IncomingMessage, urlPath: string): boolean {
  if (urlPath === "/api/health" || urlPath === "/api/ready" || urlPath === "/api/metrics") {
    return true;
  }
  const apiToken = getApiToken();
  if (!apiToken) {
    if (process.env.NODE_ENV === "production") {
      return false;
    }
    if (process.env.NODE_ENV === "development") {
      if (!_authWarningEmitted) {
        _authWarningEmitted = true;
        console.warn(
          "[Ouroboros Security] WEB_API_TOKEN is not set. " +
            "Authentication is bypassed in development mode. " +
            "Set WEB_API_TOKEN in production to enable authentication."
        );
      }
      return true;
    }
    return false;
  }
  const auth = req.headers.authorization || "";
  const bearer = auth.replace(/^Bearer\s+/i, "");
  if (!bearer) return false;
  const a = createHash("sha256").update(bearer).digest();
  const b = createHash("sha256").update(apiToken).digest();
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export { getApiToken };
