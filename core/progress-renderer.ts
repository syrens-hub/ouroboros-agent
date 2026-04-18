/**
 * Ouroboros Progress Renderer
 * ============================
 * ANSI/TTY rendering helpers, progress bar drawing, ETA formatting.
 */

import type { Checkpoint, CheckpointStatus } from "./progress-types.ts";

// -----------------------------------------------------------------------------
// ANSI / TTY constants and helpers
// -----------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const GRAY = "\x1b[90m";

export const isTTY = process.stdout.isTTY;

export function color(code: string, text: string): string {
  return isTTY ? `${code}${text}${RESET}` : text;
}

export function clearLine(): void {
  if (isTTY) {
    process.stdout.write("\r\x1b[K");
  }
}

export function moveUp(lines = 1): void {
  if (isTTY) {
    process.stdout.write(`\x1b[${lines}A`);
  }
}

// -----------------------------------------------------------------------------
// Progress bar rendering
// -----------------------------------------------------------------------------

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function renderSpinner(frameIdx: number): string {
  return color(GRAY, SPINNER_FRAMES[frameIdx % SPINNER_FRAMES.length]);
}

export function renderBar(percent: number, width = 24): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = color(GREEN, "█".repeat(filled)) + color(DIM, "░".repeat(empty));
  return `[${bar}]`;
}

// -----------------------------------------------------------------------------
// Duration / ETA formatting
// -----------------------------------------------------------------------------

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function formatETA(ms: number | undefined): string {
  if (ms === undefined || ms <= 0) return "calculating...";
  if (ms < 1000) return "<1s";
  return formatDuration(ms);
}

// -----------------------------------------------------------------------------
// Checkpoint rendering
// -----------------------------------------------------------------------------

export function checkpointIcon(status: CheckpointStatus): string {
  switch (status) {
    case "completed": return color(GREEN, "✓");
    case "error": return color(RED, "✗");
    case "warning": return color(YELLOW, "⚠");
    default: return color(DIM, "›");
  }
}

// -----------------------------------------------------------------------------
// Single-line progress render
// -----------------------------------------------------------------------------

export interface RenderProgressOptions {
  label: string;
  percent: number;
  currentStep: number;
  totalSteps: number;
  message: string;
  showETA: boolean;
  etaMs?: number;
  spinnerFrame: number;
  childProgress?: { subStep: number; subTotal: number; subMessage: string } | null;
  checkpoints?: Checkpoint[];
  warningMsg?: string;
  errorMsg?: string;
}

export function renderProgressLine(opts: RenderProgressOptions): string {
  const spinner = renderSpinner(opts.spinnerFrame);
  const bar = renderBar(opts.percent);
  const pct = color(BOLD, `${opts.percent}%`);
  const eta = opts.showETA && opts.etaMs !== undefined
    ? ` ${color(DIM, "ETA:")} ${color(CYAN, formatETA(opts.etaMs))}`
    : "";

  const label = opts.label ? `${color(MAGENTA, opts.label)} ` : "";
  const msg = opts.message ? ` ${opts.message}` : "";
  const step = ` [${opts.currentStep}/${opts.totalSteps}]`;

  let line = `${spinner} ${label}${bar} ${pct}${step}${eta}${msg}`;

  // Render active child progress inline
  if (opts.childProgress && opts.childProgress.subStep > 0 && opts.childProgress.subStep < opts.childProgress.subTotal) {
    const childPct = Math.round((opts.childProgress.subStep / opts.childProgress.subTotal) * 100);
    const childBar = renderBar(childPct);
    line += `\n  ${color(DIM, "└")} ${childBar} ${childPct}% ${opts.childProgress.subMessage}`;
  }

  // Render checkpoint summary inline (up to 4)
  const checkpoints = opts.checkpoints || [];
  const done = checkpoints.filter(
    (c) => c.status === "completed" || c.status === "error" || c.status === "warning"
  );
  if (done.length > 0 && done.length <= 4) {
    const cpStr = done.map((c) => `${checkpointIcon(c.status)} ${c.label}`).join(" ");
    line += `  ${color(DIM, "|")} ${cpStr}`;
  }

  if (opts.warningMsg) {
    line += `  ${color(YELLOW, "⚡")} ${opts.warningMsg}`;
  }
  if (opts.errorMsg) {
    line += `  ${color(RED, "✗")} ${opts.errorMsg}`;
  }

  return line;
}

// -----------------------------------------------------------------------------
// Final render (completion / error)
// -----------------------------------------------------------------------------

export function renderFinal(label: string, message: string, isError = false): void {
  const bar = renderBar(100);
  if (isError) {
    console.log(`${color(RED, "✗")} ${label} ${bar} ${color(RED, "ERROR")} ${message}`);
  } else {
    console.log(`${color(GREEN, "✓")} ${color(BOLD, label)} ${bar} ${color(GREEN, "100%")} ${message}`);
  }
}
