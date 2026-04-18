/**
 * Denial Tracker
 * ==============
 * Tracks repeated permission denials and suggests fallback to prompting
 * to avoid infinite ask/deny loops.
 */

export interface DenialRecord {
  count: number;
  lastDeniedAt: number;
}

const DENIAL_LIMIT = 3;

const tracker = new Map<string, DenialRecord>();

function key(toolPattern: string, inputSummary: string): string {
  return `${toolPattern}::${inputSummary}`;
}

export function recordDenial(toolPattern: string, inputSummary: string): void {
  const k = key(toolPattern, inputSummary);
  const existing = tracker.get(k);
  if (existing) {
    existing.count++;
    existing.lastDeniedAt = Date.now();
  } else {
    tracker.set(k, { count: 1, lastDeniedAt: Date.now() });
  }
}

export function recordSuccess(toolPattern: string, inputSummary: string): void {
  const k = key(toolPattern, inputSummary);
  tracker.delete(k);
}

export function shouldFallbackToPrompting(toolPattern: string, inputSummary: string): boolean {
  const k = key(toolPattern, inputSummary);
  const existing = tracker.get(k);
  return !!existing && existing.count >= DENIAL_LIMIT;
}

export function buildDenialHint(toolPattern: string): string {
  return `User has repeatedly denied ${toolPattern} operations. Please ask for clarification before proceeding.`;
}

export function resetDenialTracker(): void {
  tracker.clear();
}
