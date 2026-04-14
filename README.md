# Ouroboros Agent

> A self-modifying agent system.
> **Skeleton**: Claude Code's tool/permission architecture.
> **Blood**: Hermes' autonomous learning & background review.
> **Nerves**: OpenClaw's type discipline & IM integration boundaries.

## Core Philosophy

The only immutable component in the system is the **Rule Engine** (`core/rule-engine.ts`).

> *"The system is allowed to modify itself, but every modification must pass through the Rule Engine's boundary checks."*

Everything else — including the **Agent Loop itself** — is a **Skill** that can be learned, patched, and replaced.

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
core/
  rule-engine.ts        # The immutable floor
  tool-framework.ts     # Fail-closed Tool builder + StreamingToolExecutor
  permission-gate.ts    # 3-layer permission pipeline
  sandbox.ts            # Subagent context isolation
  llm-router.ts         # Unified OpenAI / Anthropic / MiniMax / Qwen / Gemini / Local streaming
  llm-resilience.ts     # Retry, fallback, and circuit breaker layer
  db-manager.ts         # Connection singleton + migrations (SQLite & PostgreSQL)
  db-adapter.ts         # DbAdapter interface for pluggable backends
  db-pg.ts              # PostgreSQL adapter (runtime switchable)
  redis.ts              # Shared Redis client + Pub/Sub helpers
  self-healing.ts       # Auto-diagnosis, snapshots, rollback, repair strategies (OpenClaw)
  task-scheduler.ts     # Cron, interval, delayed, and one-time tasks with retries
  i18n.ts               # Backend i18n with 13 locales and Intl formatting
  session-db.ts         # Barrel re-export for backward compatibility
  repositories/         # Repository modules (session, message, trajectory, skill, modification)

skills/
  agent-loop/index.ts   # The Agent Loop (itself a replaceable Skill)
  learning/index.ts     # Trajectory compression + skill filesystem ops
  learning/review-agent.ts  # Background review agent (Hermes pattern)
  self-modify/index.ts  # Gateway for all self-mutations
  personality/index.ts  # 10-dim trait evolution + 8-dim values + anchor memory
  dreaming/index.ts     # Light / deep / REM memory consolidation pipeline
  multimedia/index.ts   # Image / video / music generation (MiniMax)
  file-tools.ts         # Basic read_file / write_file tools
  greet-tool/           # Example skill with executable code attachment

extensions/
  im/mock-chat/index.ts # Mock IM channel implementing ChannelPlugin
  im/feishu/index.ts    # Feishu/Lark integration
  im/telegram/index.ts  # Telegram Bot API adapter
  im/discord/index.ts   # Discord Gateway WebSocket adapter

types/index.ts          # Strict Zod + TypeScript boundaries
web/                    # Vite + React 18 SPA with WebSocket real-time chat
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
