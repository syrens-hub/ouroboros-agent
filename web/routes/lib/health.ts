import { getDb } from "../../../core/db-manager.ts";
import { getMcpConnectionManager } from "../../../skills/mcp/index.ts";
import { listSessions } from "../../../core/session-db.ts";
import { discoverSkills } from "../../../skills/learning/index.ts";
import { llmCfg, getDaemonStatus } from "../../runner-pool.ts";
import { getWsClientCount } from "../../ws-server.ts";

export const getHealthStatus = async () => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  let healthy = true;

  // DB check
  try {
    await getDb().prepare("SELECT 1").get();
    checks.db = { ok: true };
  } catch (e) {
    checks.db = { ok: false, detail: String(e) };
    healthy = false;
  }

  // LLM check
  checks.llm = { ok: !!llmCfg, detail: llmCfg ? `${llmCfg.provider}:${llmCfg.model}` : "not configured" };

  // Skills check
  let skillCount = 0;
  try {
    skillCount = discoverSkills().length;
    checks.skills = { ok: true, detail: `${skillCount} skills loaded` };
  } catch (e) {
    checks.skills = { ok: false, detail: String(e) };
    healthy = false;
  }

  // MCP check
  const mcpManager = getMcpConnectionManager();
  if (mcpManager) {
    const mcpHealth = mcpManager.health();
    const mcpServers = Object.keys(mcpHealth);
    if (mcpServers.length > 0) {
      const allConnected = mcpServers.every((n) => mcpHealth[n]!.connected);
      checks.mcp = { ok: allConnected, detail: `${mcpServers.length} servers, ${mcpServers.filter((n) => mcpHealth[n]!.connected).length} connected` };
      if (!allConnected) healthy = false;
    } else {
      checks.mcp = { ok: true, detail: "no servers configured" };
    }
  } else {
    checks.mcp = { ok: true, detail: "MCP not initialized" };
  }

  const daemon = getDaemonStatus();
  return {
    healthy,
    status: healthy ? "ok" : "degraded",
    uptime: Math.floor(process.uptime()),
    checks,
    wsClients: getWsClientCount(),
    sessions: (await listSessions()).length,
    daemonRunning: daemon.running,
    memory: process.memoryUsage(),
  };
};
