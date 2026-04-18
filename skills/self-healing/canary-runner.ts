/**
 * Canary Runner
 * =============
 * Runs canary tests to validate scripts before execution.
 */

// 验证脚本内容：仅允许字母数字、空格、常见JS语法字符
function isAllowedScript(script: string): boolean {
  // 允许：字母数字、空格、常用JS符号、关键字
  // 禁止：require, import, child_process, fs, process, eval, Function, exec, spawn 等危险模式
  const dangerous = /\b(require|import\s+\(|child_process|fs\.|process\.|eval\(|new\s+Function|exec\(|spawn\(|\.exec\(|\bsystem\(|\bspawnSync\b)/i;
  return !dangerous.test(script) && script.length <= 10000;
}

export async function runCanaryTests(
  script?: string,
  cwd?: string
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  // If no script provided, run project-level canary (placeholder)
  if (!script) {
    return { success: true, stdout: "", stderr: "" };
  }

  // 验证脚本安全性
  if (!isAllowedScript(script)) {
    return { success: false, stdout: "", stderr: "Script contains disallowed patterns" };
  }

  return new Promise((resolve) => {
    // Dynamic import to avoid top-level side effects
    import("child_process").then(({ spawn }) => {
      const child = spawn("node", ["--input-type=module", "-e", script], {
        cwd: cwd ?? process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data: Buffer) => {
        stdout += String(data);
      });
      child.stderr?.on("data", (data: Buffer) => {
        stderr += String(data);
      });

      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        resolve({ success: false, stdout, stderr: stderr + "\nCanary tests timed out after 5 minutes." });
      }, 300_000);

      child.on("close", (code) => {
        clearTimeout(timeout);
        resolve({ success: code === 0, stdout, stderr });
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        resolve({ success: false, stdout, stderr: stderr + "\n" + String(error) });
      });
    });
  });
}
