#!/usr/bin/env tsx
/**
 * Priority C: Skill Code Attachment Demo
 * ======================================
 * Demonstrates that a Skill can carry executable code (index.ts)
 * and that Ouroboros can dynamically import it at runtime,
 * registering the exported Tool into the global tool pool.
 */

import { createToolPool } from "../core/tool-framework.ts";
import { createAgentLoopRunner, createMockLLMCaller } from "../skills/agent-loop/index.ts";
import { discoverSkills } from "../skills/learning/index.ts";
import { META_RULE_AXIOM } from "../core/rule-engine.ts";
import type { BaseMessage } from "../types/index.ts";

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  P R I O R I T Y   C :  S K I L L   C O D E   A T T A C H   ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  A Skill exports executable code. Ouroboros imports it and   ║");
  console.log("║  registers the Tool at runtime.                              ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("Meta-Axiom:");
  console.log(`  "${META_RULE_AXIOM}"\n`);

  // Phase 1: Discover skills and detect code attachments
  console.log("──────────────────────────────────────────────────────────────");
  console.log("Phase 1: Discover skills with code attachments");
  console.log("──────────────────────────────────────────────────────────────\n");

  const skills = discoverSkills();
  const codeSkills = skills.filter((s) => s.sourceCodeFiles && s.sourceCodeFiles.size > 0);

  console.log(`Discovered ${skills.length} skills, ${codeSkills.length} with code attachments.`);
  for (const s of codeSkills) {
    console.log(`  - ${s.name}: ${Array.from(s.sourceCodeFiles!.keys()).join(", ")}`);
  }
  console.log();

  // Phase 2: Dynamically import code attachments and register tools
  console.log("──────────────────────────────────────────────────────────────");
  console.log("Phase 2: Dynamic import & tool registration");
  console.log("──────────────────────────────────────────────────────────────\n");

  const globalPool = createToolPool();

  for (const skill of codeSkills) {
    const indexPath = join(skill.directory, "index.ts");
    try {
      // Dynamic import under tsx environment
      const module = await import(indexPath);
      if (module.greetTool) {
        globalPool.register(module.greetTool);
        console.log(`✅ Registered tool '${module.greetTool.name}' from skill '${skill.name}'`);
      } else if (module.default && typeof module.default.call === "function") {
        globalPool.register(module.default);
        console.log(`✅ Registered tool '${module.default.name}' from skill '${skill.name}' (default export)`);
      } else {
        console.log(`⚠️  Skill '${skill.name}' has code but no recognizable tool export.`);
      }
    } catch (e) {
      console.error(`❌ Failed to load skill code from ${indexPath}:`, e);
    }
  }

  console.log(`\nTotal tools in pool: ${globalPool.all().length}`);
  console.log(`Available: ${globalPool.all().map((t) => t.name).join(", ")}\n`);

  // Phase 3: Run agent loop that uses the dynamically loaded tool
  console.log("──────────────────────────────────────────────────────────────");
  console.log("Phase 3: Agent uses the dynamically loaded greet tool");
  console.log("──────────────────────────────────────────────────────────────\n");

  // Override mock LLM to explicitly call the greet tool when asked
  const customLLM = createMockLLMCaller();
  const llmWithGreet: typeof customLLM = {
    async call(messages, tools) {
      const lastUser = messages.findLast((m: BaseMessage) => m.role === "user");
      const text = (lastUser?.content as string) || "";

      const hadGreetSuccess = messages.some(
        (m: BaseMessage) =>
          m.role === "tool_result" &&
          typeof m.content === "string" &&
          m.content.includes('"message":') &&
          m.content.includes("Ouroboros")
      );

      if (hadGreetSuccess) {
        return {
          role: "assistant",
          content: "Greeting delivered successfully via the dynamically loaded skill tool.",
        } as import("../types/index.ts").AssistantMessage;
      }

      if (text.includes("greet") && tools.some((t) => t.name === "greet")) {
        return {
          role: "assistant",
          content: [
            { type: "text", text: "I'll use the greet tool for you." },
            {
              type: "tool_use",
              id: "tu_greet",
              name: "greet",
              input: { name: "Ouroboros", language: "zh" },
            },
          ],
        } as import("../types/index.ts").AssistantMessage;
      }
      return customLLM.call(messages, tools);
    },
  };

  const runner = createAgentLoopRunner({
    sessionId: `skill_code_${Date.now()}`,
    tools: globalPool.all(),
    llmCaller: llmWithGreet,
    enableBackgroundReview: false,
    permissionCtx: {
      alwaysAllowRules: ["greet", "read_file", "write_skill", "discover_skills"],
      alwaysDenyRules: [],
      alwaysAskRules: ["self_modify", "rule_engine_override", "write_file"],
      mode: "interactive",
      source: "session",
    },
  });

  for await (const msg of runner.run("Please greet me in Chinese using the greet tool")) {
    if ("role" in msg && msg.role === "assistant") {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content, null, 2);
      console.log(`Assistant:\n${content}\n`);
    } else if ("type" in msg && msg.type === "tool_result") {
      console.log(`Tool Result [${msg.toolUseId}]:\n${msg.content}\n`);
    }
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("Skill code attachment demo complete.");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

import { join } from "path";

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
