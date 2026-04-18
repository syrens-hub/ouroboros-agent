/**
 * Skill Quality Gate
 * ==================
 * Lightweight static analysis for generated skill code.
 */

export interface QualityScore {
  score: number;
  issues: string[];
}

export function scoreSkillCode(code: string): QualityScore {
  const issues: string[] = [];
  let score = 100;

  // 1. Must contain a zod schema
  const hasSchema = /z\.(object|string|number|boolean|array|enum)\s*\(/i.test(code);
  if (!hasSchema) {
    issues.push("Missing Zod input schema (z.object, z.string, etc.)");
    score -= 30;
  }

  // 2. Must export a tool (buildTool or default export)
  const hasToolExport = /buildTool\s*\(/i.test(code) || /export\s+default/i.test(code);
  if (!hasToolExport) {
    issues.push("Missing tool export (buildTool or export default)");
    score -= 30;
  }

  // 3. Must have a description
  const hasDescription = /description\s*:\s*["']/.test(code);
  if (!hasDescription) {
    issues.push("Missing tool description");
    score -= 15;
  }

  // 4. Dangerous patterns
  const dangerousPatterns = [
    { pattern: /process\.exit\s*\(/i, name: "process.exit()" },
    { pattern: /eval\s*\(/i, name: "eval()" },
    { pattern: /new\s+Function\s*\(/i, name: "new Function()" },
    { pattern: /require\s*\(\s*["']child_process["']\s*\)/i, name: "child_process require" },
    { pattern: /require\s*\(\s*["']fs["']\s*\)/i, name: "fs require without sandbox" },
  ];
  for (const { pattern, name } of dangerousPatterns) {
    if (pattern.test(code)) {
      issues.push(`Dangerous API detected: ${name}`);
      score -= 20;
    }
  }

  // 5. Must not be empty/minimal
  const lineCount = code.split("\n").filter((l) => l.trim().length > 0).length;
  if (lineCount < 5) {
    issues.push("Generated code is too short/minimal");
    score -= 20;
  }

  return { score: Math.max(0, score), issues };
}
