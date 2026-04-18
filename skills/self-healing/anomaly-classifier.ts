/**
 * Anomaly Classifier
 * =================
 * Classifies errors into categories and determines recoverability.
 */

import type { AnomalyInfo, ErrorCategory, ErrorSeverity } from "./self-healing-types.ts";

export class AnomalyClassifier {
  private static readonly PATTERNS: Array<{
    category: ErrorCategory;
    patterns: RegExp[];
    severity: ErrorSeverity;
  }> = [
    {
      category: "tool_execution",
      patterns: [
        /tool.*not.*found/i,
        /execution.*failed/i,
        /permission.*denied/i,
        /file.*not.*found/i,
        /tool.*timeout/i,
      ],
      severity: "medium",
    },
    {
      category: "model_call",
      patterns: [
        /rate.*limit/i,
        /model.*error/i,
        /api.*error/i,
        /context.*length/i,
        /token.*exceeded/i,
      ],
      severity: "high",
    },
    {
      category: "memory_failure",
      patterns: [
        /memory.*error/i,
        /allocation.*failed/i,
        /out.*of.*memory/i,
        /snapshot.*corrupt/i,
      ],
      severity: "critical",
    },
    {
      category: "security_violation",
      patterns: [
        /security.*error/i,
        /injection.*detected/i,
        /unauthorized.*access/i,
        /invalid.*input/i,
      ],
      severity: "high",
    },
    {
      category: "channel_disconnect",
      patterns: [
        /connection.*failed/i,
        /channel.*disconnect/i,
        /network.*error/i,
        /timeout.*exceeded/i,
      ],
      severity: "medium",
    },
    {
      category: "timeout",
      patterns: [/timeout/i, /timed.*out/i, /deadline.*exceeded/i],
      severity: "low",
    },
  ];

  classify(error: Error, context?: Record<string, unknown>): AnomalyInfo {
    const message = error.message.toLowerCase();
    for (const { category, patterns, severity } of AnomalyClassifier.PATTERNS) {
      if (patterns.some((p) => p.test(message))) {
        return {
          category,
          severity,
          error,
          context: context ?? {},
          timestamp: Date.now(),
          recoverable: severity !== "critical",
        };
      }
    }
    return {
      category: "unknown",
      severity: "medium",
      error,
      context: context ?? {},
      timestamp: Date.now(),
      recoverable: true,
    };
  }

  isRecoverable(anomaly: AnomalyInfo): boolean {
    if (anomaly.severity === "critical") return false;
    if (anomaly.category === "memory_failure") return false;
    return anomaly.recoverable;
  }
}
