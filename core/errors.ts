/**
 * Ouroboros Error Utilities
 * =========================
 * Telemetry-safe error classification inspired by Claude Code.
 */

export class TelemetrySafeError extends Error {
  readonly telemetryMessage: string;

  constructor(message: string, telemetryMessage?: string) {
    super(message);
    this.name = "TelemetrySafeError";
    this.telemetryMessage = telemetryMessage ?? message;
  }
}

export function hasErrnoCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error) {
    const code = (error as Error & { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * Classify a tool execution error into a telemetry-safe string.
 *
 * - TelemetrySafeError: use its telemetryMessage (already vetted)
 * - Node.js fs errors: log the error code (ENOENT, EACCES, etc.)
 * - Known error types: use their unminified name
 * - Fallback: "Error"
 */
export function classifyToolError(error: unknown): string {
  if (error instanceof TelemetrySafeError) {
    return error.telemetryMessage.slice(0, 200);
  }
  if (error instanceof Error) {
    const errnoCode = hasErrnoCode(error);
    if (typeof errnoCode === "string") {
      return `Error:${errnoCode}`;
    }
    if (error.name && error.name !== "Error" && error.name.length > 3) {
      return error.name.slice(0, 60);
    }
  }
  return "Error";
}
