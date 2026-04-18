# Ouroboros（衔尾蛇）Agent 极简技术总结

> **一句话定位**：一个能自己改自己代码、自己提交 Git、自己持续进化的开源 AI 系统，目标是做「有持久身份的连续数字实体」，不是一次性脚本。

---

## 一、核心解决什么痛点？

传统 Agent 三大问题：

- **重启就失忆**，没有 "连续身份"
- **只会被动执行**，没主动性
- **改代码必须靠人**，进化成本高

Ouroboros 用这套机制破局：

- **持久身份**：identity、宪法、记忆跨重启保存
- **LLM-First**：LLM 做决策，代码只负责执行
- **自进化闭环**：读代码 → 多模型审查 → Git 提交 → 重启生效
- **后台意识**：没事也在轻量思考、观察环境

---

## 二、最关键功能

1. **宪法驱动（BIBLE.md）**
   9 条原则，硬约束：不能删核心身份、不能支付、不能违法，运行时真会遵守。

2. **后台意识循环**
   低开销模型，无任务时自动总结、规划、更知识库。

3. **任务系统**
   任务分解 + 单消费者路由，避免重复执行浪费预算。

4. **工具栈（≈40 个）**
   代码读写、浏览器自动化、GitHub、多模型审查、视觉分析等。

5. **预算守护**
   实时算 OpenRouter 开销，超预算自动停进化。

---

## 三、极简架构（两层）

- **监督层（supervisor）**
  进程管理、任务队列、Git、持久化（Google Drive）、多进程 Worker。

- **代理核心（ouroboros）**
  - `loop`：并发工具 + 提示缓存
  - `context`：上下文构建压缩
  - `consciousness`：后台意识
  - `tools`：插件式注册，易扩展

---

## 四、怎么跑

- **最简单**：Google Colab + Fork 仓库 + 填密钥 → 跑启动脚本
- **本地**：Linux/macOS/WSL，配环境变量，挂载 Google Drive 或改路径

---

## 五、适合谁

- **初学者**：学现代 Agent 架构的 "活教材"
- **开发者**：研究自修改、多模型协同、可信 Agent
- **产品**：验证自主助手原型，但要严控风险

---

> **Immutable floor**: `core/rule-engine.ts`. Everything else — including the **Agent Loop itself** — is a **Skill** that can be learned, patched, and replaced.

---

## Quick Start

**Requirements**: Node.js >= 20.0.0 (check with `node -v`).

```bash
cd ~/ouroboros-agent
npm install

# If better-sqlite3 fails to load, rebuild the native module:
npm rebuild better-sqlite3

# Run the main interactive demo (mock LLM)
npx tsx main.ts

# Test LLM connectivity (requires .env)
cp .env.example .env
# Edit .env to add your API key
npx tsx scripts/test-llm.ts
```

---

## Demo Scripts

| Script | What it proves |
|--------|----------------|
| `npx tsx main.ts` | Base agent loop + SQLite persistence + skill auto-discovery |
| `npx tsx scripts/self-evolve-demo.ts` | **Priority A**: The Agent Loop reads its own source and replaces itself via `self_modify` |
| `npx tsx scripts/im-nervous-demo.ts` | **Priority B**: Mock IM channel injects messages, Agent processes them, replies back via `ChannelPlugin` |
| `npx tsx scripts/skill-code-demo.ts` | **Priority C**: A Skill carries executable `index.ts`; Ouroboros dynamically imports it and registers the exported Tool |
| `npx tsx scripts/test-background-review.ts` | **Hermes blood**: Triggers the background review agent with a real LLM (requires API key) |
| `npx tsx scripts/export-trajectories.ts` | **Priority D**: Exports SessionDB trajectories as ShareGPT JSONL for model training |
| `npx tsx scripts/test-self-healing.ts` | **OpenClaw nerves**: Simulates an error and triggers snapshot + rollback |
| `npx tsx scripts/test-task-scheduler.ts` | Registers a cron task and manually triggers it via the scheduler API |

---

## Architecture

```
core/                   # Immutable kernel (3 sacred files)
  rule-engine.ts        # The only unmodifiable floor
  tool-framework.ts     # Fail-closed Tool builder + StreamingToolExecutor
  permission-gate.ts    # 3-layer permission pipeline
  db-manager.ts         # Connection singleton + migrations (SQLite & PostgreSQL)
  db-adapter.ts         # DbAdapter interface for pluggable backends
  db-pg.ts              # PostgreSQL adapter (runtime switchable)
  config.ts             # Central configuration
  logger.ts             # Structured logging
  session-db.ts         # Barrel re-export for backward compatibility
  index.ts              # Core barrel exports

skills/                 # Everything is a Skill — including the Agent Loop
  agent-loop/           # Main agent loop (replaceable)
  autonomous-evolution/ # Background daemon that auto-creates skills
  backup/               # Database backup & restore
  browser/              # Playwright-based browser automation + Computer Use
  budget-guard/         # Real-time budget tracking and automatic circuit-breaking
  checkpoint/           # Shadow-git filesystem snapshots
  hot-reload/           # File watcher for skill auto-reload
  i18n/                 # 13-locale internationalization
  knowledge-base/       # RAG: ingest + embedding + vector search
  learning/             # Trajectory compression + skill filesystem ops
  mcp/                  # MCP connection manager + output storage + utils
  notification/         # Global notification bus (EventEmitter)
  sandbox/              # Subagent context isolation
  self-healing/         # Anomaly detection, snapshots, rollback, repair
  rate-limiter/         # Token-bucket rate limiting (API + per-user)
  self-modify/          # Gateway for all self-mutations
  session-archiver/     # Session archiving & cleanup
  skill-versioning/     # Skill snapshot, restore, and version history
  skills-guard/         # Runtime validation of skill safety constraints
  smart-cache/          # LRU cache with TTL and size eviction
  task-scheduler/       # Cron / interval / delayed tasks with retries
  telemetry/            # OpenTelemetry spans, metrics, OTLP exporter
  webhooks/             # Webhook registration & delivery

extensions/
  im/mock-chat/index.ts # Mock IM channel implementing ChannelPlugin
  im/feishu/index.ts    # Feishu/Lark integration
  im/telegram/index.ts  # Telegram Bot API adapter
  im/discord/index.ts   # Discord Gateway WebSocket adapter

types/index.ts          # Strict Zod + TypeScript boundaries
web/                    # Vite + React 18 SPA with WebSocket real-time chat + HTTP API
k8s/                    # Kubernetes manifests + HPA
```

---

## Key Design Patterns

### 1. Fail-Closed Tools
Every new tool defaults to `isReadOnly: false` and `isConcurrencySafe: false`. It must explicitly opt-in to broader permissions.

### 2. Permission Pipeline
```
Rule matching (deny → ask → allow)
  → Tool-specific checkPermissions()
  → Mode layer (bypass / auto / interactive)
  → Optional human confirmation callback
```

### 3. Skill = File
Skills are discovered from `skills/<name>/SKILL.md`. They can optionally carry code attachments (`index.ts`) that are dynamically imported at runtime.

### 4. Background Review (Hermes)
After a conversation ends, a non-blocking review agent analyzes the trajectory and may auto-create or patch skills.

### 5. IM Integration (OpenClaw)
All IM adapters implement `ChannelPlugin`:
- `inbound`: receives messages from the platform
- `outbound`: sends replies back
- `meta`: localization, aliases, capabilities

### 6. Self-Healing (OpenClaw)
The agent loop creates a `SystemSnapshot` before every tool execution block. If an anomaly is detected, the `SelfHealer` attempts repair strategies and can fall back to rollback.

### 7. Personality & Dreaming (OpenClaw)
- **PersonalityEvolution**: 10-dimensional traits + 8-dimensional values evolve per session; anchor memories are persisted in SQLite.
- **DreamingMemory**: A 3-phase consolidation pipeline (light → deep → REM) promotes important memories automatically.

### 8. Multimedia Generation
Unified skill for image, video, and music generation via MiniMax (extensible to other providers).

### 9. Task Scheduler
Cron, interval, delayed, and one-time tasks with dependency checking, retry backoff, and timeout control.

### 10. i18n
13 locales supported on both backend (`core/i18n.ts`) and frontend (`web/src/i18n`), with nested-key fallback and `Intl` formatting.

### 11. Pluggable Database Backend
SQLite (via `better-sqlite3` + WAL) is the default for single-node deployments. Set `USE_POSTGRES=1` and `DATABASE_URL` to switch to PostgreSQL without changing business logic.

### 12. Horizontal Scaling
When Redis is available (`REDIS_URL`), WebSocket broadcasts use Redis Pub/Sub so notifications reach clients connected to any instance. PostgreSQL mode enables safe multi-replica deployment.

---

## Self-Modification Flow

1. User asks the agent to improve its loop
2. Agent reads `skills/agent-loop/index.ts` via `read_file`
3. Agent proposes a patch via `self_modify` with `type: loop_replace`
4. **Rule Engine** evaluates risk → requires confirmation
5. Human confirms (or `askConfirmCallback` auto-approves in demo mode)
6. Patch is applied to disk
7. Next invocation loads the new Agent Loop

---

## Environment Variables

Copy `.env.example` to `.env` and configure:

```env
LLM_PROVIDER=openai        # openai | anthropic | minimax | qwen | gemini | local
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=sk-...
# LLM_BASE_URL=            # optional, for local proxies

# MiniMax specific
# MINIMAX_API_KEY=...
# MINIMAX_GROUP_ID=...

# Optional: PostgreSQL backend for multi-node deployments
USE_POSTGRES=1
DATABASE_URL=postgresql://user:pass@localhost:5432/ouroboros

# Optional: Redis for distributed rate limiting and WS broadcast
REDIS_URL=redis://localhost:6379/0

# Optional: slow query logging threshold (ms)
SLOW_QUERY_THRESHOLD_MS=500
```

---

## License

MIT (or specify your own)
