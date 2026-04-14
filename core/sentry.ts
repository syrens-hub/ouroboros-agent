/**
 * Sentry Error Tracking
 * =====================
 * Lightweight Sentry integration for Node.js backend.
 */

import * as Sentry from "@sentry/node";
import { appConfig } from "./config.ts";

const enabled = !!appConfig.sentry.dsn;

export function initSentry(): void {
  if (!enabled) return;
  Sentry.init({
    dsn: appConfig.sentry.dsn,
    environment: appConfig.sentry.environment,
    tracesSampleRate: 0.1,
  });
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  if (context) {
    Sentry.captureException(error, { extra: context });
  } else {
    Sentry.captureException(error);
  }
}

export function addBreadcrumb(message: string, category?: string, data?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level: "info",
  });
}
