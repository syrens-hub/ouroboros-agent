/**
 * Bash Command Classifier
 * =======================
 * Lightweight regex-based classifier for Bash/shell commands.
 * Downgrades dangerous commands from "allow" to "ask" as a safety net.
 */

export type BashRiskLevel = "safe" | "caution" | "dangerous";

const DANGEROUS_PATTERNS = [
  /\brm\s+-[^\s]*r/i, // rm -r, rm -rf
  /\bcurl\s+.*\|\s*\b(bash|sh|zsh)\b/i, // curl | bash
  /\bwget\s+.*\|\s*\b(bash|sh|zsh)\b/i, // wget | bash
  /\beval\s*\(/i, // eval(
  /\bnew\s+Function\s*\(/i, // new Function(
  /\bdd\s+.*if=/i, // dd if=
  /\bmkfs\b/i, // mkfs
  /\bchmod\s+.*777/i, // chmod 777
  />\s*\/dev\/null\s+2>&1\s+&&\s+:\s*\|\|\s*rm\s+-rf/i, // common obfuscation
  /\bsudo\s+rm\b/i,
  /\b(rm|del)\s+(-f\s+)?["']?\/[\s\S]*/i,
];

const CAUTION_PATTERNS = [
  /\bgit\s+push\b/i,
  /\bgit\s+force\b/i,
  /\bnpm\s+publish\b/i,
  /\bdocker\s+run\b/i,
  /\bdocker\s+exec\b/i,
  /\bkubectl\s+(apply|delete)\b/i,
  /\bsudo\s+/i,
];

const SAFE_WHITELIST = [
  /^\s*git\s+status\b/i,
  /^\s*git\s+log\b/i,
  /^\s*git\s+diff\b/i,
  /^\s*git\s+show\b/i,
  /^\s*ls\b/i,
  /^\s*cat\b/i,
  /^\s*find\b/i,
  /^\s*grep\b/i,
  /^\s*head\b/i,
  /^\s*tail\b/i,
  /^\s*wc\b/i,
  /^\s*echo\b/i,
  /^\s*pwd\b/i,
  /^\s*which\b/i,
  /^\s*whoami\b/i,
  /^\s*uname\b/i,
  /^\s*env\b/i,
  /^\s*printenv\b/i,
];

export function classifyBashCommand(command: string): BashRiskLevel {
  if (SAFE_WHITELIST.some((p) => p.test(command))) return "safe";
  if (DANGEROUS_PATTERNS.some((p) => p.test(command))) return "dangerous";
  if (CAUTION_PATTERNS.some((p) => p.test(command))) return "caution";
  return "safe";
}
