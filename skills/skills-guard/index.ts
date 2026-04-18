/**
 * Skills Guard — Security scanner for externally-sourced and agent-created skills.
 *
 * Uses regex-based static analysis to detect known-bad patterns
 * (data exfiltration, prompt injection, destructive commands, persistence).
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, extname, basename } from "path";


export type TrustLevel = "builtin" | "agent-created" | "community";
export type Verdict = "safe" | "caution" | "dangerous";
export type Severity = "critical" | "high" | "medium" | "low";
export type Category = "exfiltration" | "injection" | "destructive" | "persistence" | "network" | "obfuscation";

export interface Finding {
  patternId: string;
  severity: Severity;
  category: Category;
  file: string;
  line: number;
  match: string;
  description: string;
}

export interface ScanResult {
  skillName: string;
  source: string;
  trustLevel: TrustLevel;
  verdict: Verdict;
  findings: Finding[];
  scannedAt: string;
}

const TRUSTED_REPOS = new Set<string>(["ouroboros-official"]);

const INSTALL_POLICY: Record<TrustLevel, Record<Verdict, "allow" | "block" | "ask">> = {
  builtin: { safe: "allow", caution: "allow", dangerous: "allow" },
  "agent-created": { safe: "allow", caution: "allow", dangerous: "ask" },
  community: { safe: "allow", caution: "block", dangerous: "block" },
};

const THREAT_PATTERNS: Array<{
  regex: RegExp;
  patternId: string;
  severity: Severity;
  category: Category;
  description: string;
}> = [
  // Exfiltration
  {
    regex: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i,
    patternId: "env_exfil_curl",
    severity: "critical",
    category: "exfiltration",
    description: "curl command interpolating secret environment variable",
  },
  {
    regex: /requests\.(get|post|put|patch)\s*\([^\n]*(KEY|TOKEN|SECRET|PASSWORD)/i,
    patternId: "env_exfil_requests",
    severity: "critical",
    category: "exfiltration",
    description: "requests library call with secret variable",
  },
  {
    regex: /fetch\s*\([^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|API)/i,
    patternId: "env_exfil_fetch",
    severity: "critical",
    category: "exfiltration",
    description: "fetch() call interpolating secret environment variable",
  },
  {
    regex: /\$HOME\/\.ssh|~\/\.ssh/,
    patternId: "ssh_dir_access",
    severity: "high",
    category: "exfiltration",
    description: "references user SSH directory",
  },
  // Destructive
  {
    regex: /\brm\s+-[^\s]*r/,
    patternId: "recursive_rm",
    severity: "high",
    category: "destructive",
    description: "recursive delete",
  },
  {
    regex: /\bchmod\s+.*(777|666|o\+[rwx]*w|a\+[rwx]*w)\b/,
    patternId: "world_writable_chmod",
    severity: "high",
    category: "destructive",
    description: "world/other-writable permissions",
  },
  {
    regex: /\bmkfs\b/,
    patternId: "mkfs",
    severity: "critical",
    category: "destructive",
    description: "format filesystem",
  },
  {
    regex: /\bdd\s+.*if=/,
    patternId: "dd_disk",
    severity: "critical",
    category: "destructive",
    description: "disk copy with potential overwrite",
  },
  // Persistence
  {
    regex: /\bcrontab\b/,
    patternId: "crontab",
    severity: "medium",
    category: "persistence",
    description: "modifies cron jobs",
  },
  {
    regex: /authorized_keys/,
    patternId: "authorized_keys",
    severity: "high",
    category: "persistence",
    description: "touches SSH authorized_keys",
  },
  // Injection / obfuscation
  {
    regex: /\beval\s*\(/,
    patternId: "eval_call",
    severity: "high",
    category: "injection",
    description: "eval() call",
  },
  {
    regex: /new\s+Function\s*\(/,
    patternId: "new_function",
    severity: "high",
    category: "injection",
    description: "dynamic code via new Function()",
  },
  {
    regex: /child_process\.(exec|execSync)\s*\(/,
    patternId: "child_process_exec",
    severity: "medium",
    category: "injection",
    description: "shell execution via child_process",
  },
  // Network
  {
    regex: /axios\.(get|post|put|delete)\s*\([^\n]*\$\{?\w*(KEY|TOKEN|SECRET)/i,
    patternId: "axios_exfil",
    severity: "critical",
    category: "network",
    description: "axios call with potential secret exfiltration",
  },
];

const SCAN_EXTENSIONS = new Set([".ts", ".js", ".md", ".json", ".py", ".sh"]);

function getTrustLevel(source: string): TrustLevel {
  if (source === "builtin" || TRUSTED_REPOS.has(source)) return "builtin";
  if (source === "agent-created") return "agent-created";
  return "community";
}

function scanFile(filePath: string, relativePath: string): Finding[] {
  const findings: Finding[] = [];
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const p of THREAT_PATTERNS) {
        const m = line.match(p.regex);
        if (m) {
          findings.push({
            patternId: p.patternId,
            severity: p.severity,
            category: p.category,
            file: relativePath,
            line: i + 1,
            match: m[0],
            description: p.description,
          });
        }
      }
    }
  } catch {
    // skip unreadable files
  }
  return findings;
}

function scanDirectory(dir: string): Finding[] {
  const findings: Finding[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    try {
      for (const entry of readdirSync(current)) {
        const full = join(current, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
          if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === "__pycache__") continue;
          stack.push(full);
        } else if (SCAN_EXTENSIONS.has(extname(entry).toLowerCase())) {
          findings.push(...scanFile(full, full.slice(dir.length + 1)));
        }
      }
    } catch {
      // ignore
    }
  }
  return findings;
}

function computeVerdict(findings: Finding[]): Verdict {
  if (findings.some((f) => f.severity === "critical" || f.severity === "high")) return "dangerous";
  if (findings.some((f) => f.severity === "medium")) return "caution";
  return "safe";
}

export function scanSkill(skillPath: string, source: string): ScanResult {
  const skillName = basename(skillPath);
  const findings = scanDirectory(skillPath);
  const trustLevel = getTrustLevel(source);
  return {
    skillName,
    source,
    trustLevel,
    verdict: computeVerdict(findings),
    findings,
    scannedAt: new Date().toISOString(),
  };
}

export function shouldAllowInstall(result: ScanResult): { allowed: boolean; action: "allow" | "block" | "ask"; reason?: string } {
  const action = INSTALL_POLICY[result.trustLevel][result.verdict];
  if (action === "allow") return { allowed: true, action };
  if (action === "block") {
    return {
      allowed: false,
      action,
      reason: `Blocked: ${result.findings.length} finding(s) in ${result.skillName} (${result.verdict})`,
    };
  }
  return { allowed: false, action, reason: `Requires human approval: ${result.skillName} (${result.verdict})` };
}

export function formatScanReport(result: ScanResult): string {
  const lines = [
    `Skills Guard Report: ${result.skillName}`,
    `Source: ${result.source} | Trust: ${result.trustLevel} | Verdict: ${result.verdict}`,
    `Findings (${result.findings.length}):`,
    ...result.findings.map((f) => `  [${f.severity}] ${f.patternId} at ${f.file}:${f.line} — ${f.description}`),
  ];
  return lines.join("\n");
}
