# Ouroboros（衔尾蛇）Agent

<p align="center">
  <img src="https://img.shields.io/badge/version-0.9.0-blue" alt="version" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20.0.0-brightgreen" alt="node" />
  <img src="https://img.shields.io/badge/coverage-76.9%25-success" alt="coverage" />
  <img src="https://img.shields.io/badge/tests-1226%20passed-purple" alt="tests" />
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="license" />
</p>

> **一句话定位**：一个能自己改自己代码、自己提交 Git、自己持续进化的开源 AI 系统，目标是做「有持久身份的连续数字实体」，不是一次性脚本。

---

## 目录

- [核心痛点](#核心痛点)
- [关键功能](#关键功能)
- [快速开始](#快速开始)
- [Demo 脚本](#demo-脚本)
- [架构概览](#架构概览)
- [设计模式](#设计模式)
- [自我修改流程](#自我修改流程)
- [环境变量](#环境变量)
- [文档](#文档)
- [许可证](#许可证)

---

## 核心痛点

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

## 关键功能

1. **宪法驱动（BIBLE.md）**
   9 条原则，硬约束：不能删核心身份、不能支付、不能违法，运行时真会遵守。

2. **后台意识循环**
   低开销模型，无任务时自动总结、规划、更新知识库。

3. **任务系统**
   任务分解 + 单消费者路由，避免重复执行浪费预算。

4. **工具栈（≈40 个）**
   代码读写、浏览器自动化、GitHub、多模型审查、视觉分析等。

5. **预算守护**
   实时算 OpenRouter 开销，超预算自动停进化。

---

## 快速开始

**Requirements**: Node.js >= 20.0.0 (check with `node -v`).

```bash
# 1. 克隆仓库
git clone https://github.com/your-org/ouroboros-agent.git
cd ouroboros-agent

# 2. 安装依赖（npm workspaces 自动管理 skills）
npm install
# 若 better-sqlite3 编译失败：
npm rebuild better-sqlite3

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 LLM_API_KEY 等

# 4. 启动 Web 服务（前端 + API + WebSocket）
npm run dev

# 5. 打开浏览器访问 http://localhost:8080
```

### 验证 LLM 连通性

```bash
npx tsx scripts/test-llm.ts
```

### 运行测试

```bash
# 后端单元测试（1,226 tests, coverage 76.9%）
npm test

# 前端单元测试
cd web && npm test

# E2E 测试
npm run e2e
```

### 数据清理

```bash
# 查看会删除什么
npm run cleanup:dry-run

# 执行清理（按保留策略删除旧备份和检查点）
npm run cleanup
```

---

## Demo 脚本

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

## 架构概览

```
core/                   # Immutable kernel — 严格禁止 skills/ 反向依赖
  rule-engine.ts        # 自我修改的最高裁决者（唯一不可变地板）
  tool-framework.ts     # Fail-closed Tool builder + StreamingToolExecutor
  permission-gate.ts    # 3-layer permission pipeline
  permission-engine.ts  # 多源规则引擎（CLI → 项目 → 会话 → 设置）
  constitution-guard.ts # 运行时宪法守卫（硬编码规则 + 路径验证）
  db-manager.ts         # 连接单例 + 迁移（SQLite & PostgreSQL）
  db-adapter.ts         # DbAdapter 接口，支持运行时切换后端
  event-bus.ts          # 生产级事件总线（重试 + 退避 + 死信队列）
  hook-system.ts        # 可扩展 Hook Registry
  smart-cache.ts        # LRU + TTL + 大小感知的内存缓存
  security-framework.ts # 审计日志 + 路径验证 + 速率限制
  config.ts             # 中心化配置（环境变量驱动）
  logger.ts             # 结构化日志
  index.ts              # Core barrel exports

skills/                 # 一切皆 Skill — 包括 Agent Loop 本身
  agent-loop/           # 主循环（可替换）
  autonomous-evolution/ # 后台守护进程：自动创建 skill
  backup/               # 数据库备份 & 恢复 + 自动保留策略
  browser/              # Playwright 浏览器自动化 + Computer Use
  budget-guard/         # 实时预算追踪 + 自动熔断
  checkpoint/           # Shadow-git 文件系统快照
  evolution-core/       # Evolution 技能群 DI 注册表 + 领域边界
  evolution-orchestrator/   # 进化流水线协调器
  evolution-feedback/       # 失败反馈 + 自动回滚 + 修复提案
  evolution-consensus/      # 多智能体共识审查
  hot-reload/           # Skill 文件变更自动重载
  i18n/                 # 13 语言国际化
  knowledge-base/       # RAG：ingest + embedding + 向量搜索
  learning/             # 轨迹压缩 + skill 文件系统操作
  mcp/                  # MCP 连接管理器
  notification/         # 全局通知总线（EventBus 适配器）
  sandbox/              # Subagent 上下文隔离
  self-healing/         # 异常检测、快照、回滚、修复
  self-modify/          # 所有自我修改的统一网关
  skill-versioning/     # Skill 快照、恢复、版本历史
  task-scheduler/       # Cron / 间隔 / 延迟任务 + 重试
  telemetry/            # OpenTelemetry spans、指标、OTLP 导出
  webhooks/             # Webhook 注册 & 投递

extensions/
  im/mock-chat/         # Mock IM 通道
  im/feishu/            # 飞书/Lark 集成
  im/telegram/          # Telegram Bot API
  im/discord/           # Discord Gateway WebSocket
  im/dingtalk/          # 钉钉集成
  im/wechatwork/        # 企业微信集成

types/                  # 严格 TypeScript 边界
  evolution.ts          # Evolution 领域共享类型（减少跨 skill 耦合）
  index.ts              # 全局类型导出

web/                    # Vite + React 19 SPA + WebSocket 实时聊天 + HTTP API
  src/                  # 前端源码（TSX, Zustand, TanStack Query）
  server.ts             # 生产服务器（静态文件 + API 代理）
  ws-server.ts          # WebSocket 服务器（Redis Pub/Sub 多实例广播）

deploy/                 # Docker / Compose / Helm / K8s
```

> **Immutable floor**: `core/rule-engine.ts`。Everything else — including the **Agent Loop itself** — is a **Skill** that can be learned, patched, and replaced.

---

## 设计模式

### 1. Fail-Closed Tools
Every new tool defaults to `isReadOnly: false` and `isConcurrencySafe: false`. It must explicitly opt-in to broader permissions.

### 2. Permission Pipeline v2
```
Rule matching (deny → ask → allow), first-match wins
  → Tool-specific checkPermissions()
  → Mode layer (bypass / auto / interactive / readOnly / plan)
  → Optional human confirmation callback
```
Rules come from 4 sources ordered by precedence: **CLI > Project > Session > Settings**.

### 3. Skill = File
Skills are discovered from `skills/<name>/SKILL.md`. They can optionally carry code attachments (`index.ts`) that are dynamically imported at runtime.

### 4. Evolution DI Registry
The evolution skill cluster (~10 skills) uses a lightweight service locator (`skills/evolution-core/registry.ts`) to eliminate direct cross-skill imports. Modules register themselves at startup; consumers resolve dependencies via lazy getters. See [ADR-005](docs/adr/005-evolution-skill-cluster.md).

### 5. Production EventBus
All cross-module communication flows through `core/event-bus.ts`:
- Async queue with retry, exponential backoff, and dead-letter persistence in SQLite
- Wraps `HookRegistry` for backward compatibility
- Guarantees delivery even when handlers fail transiently

### 6. Self-Modification Safety (4 Layers)
```
① Constitution Guard  → 硬编码规则拦截（不可变文件、core/ 删除、新增依赖）
② Syntax Validation   → tsc --noEmit 全项目类型检查
③ Atomic Write        → tmp → validate → rename
④ Canary Tests        → 变更后自动跑测试，失败自动 rollback
```
See [ADR-003](docs/adr/003-self-modification-safety.md).

### 7. Background Review (Hermes)
After a conversation ends, a non-blocking review agent analyzes the trajectory and may auto-create or patch skills.

### 8. IM Integration (OpenClaw)
All IM adapters implement `ChannelPlugin`:
- `inbound`: receives messages from the platform
- `outbound`: sends replies back
- `meta`: localization, aliases, capabilities

### 9. Self-Healing (OpenClaw)
The agent loop creates a `SystemSnapshot` before every tool execution block. If an anomaly is detected, the `SelfHealer` attempts repair strategies and can fall back to rollback.

### 10. Personality & Dreaming (OpenClaw)
- **PersonalityEvolution**: 10-dimensional traits + 8-dimensional values evolve per session; anchor memories are persisted in SQLite.
- **DreamingMemory**: A 3-phase consolidation pipeline (light → deep → promoted) promotes important memories automatically.

### 11. Multimedia Generation
Unified skill for image, video, and music generation via MiniMax (extensible to other providers).

### 12. Task Scheduler
Cron, interval, delayed, and one-time tasks with dependency checking, retry backoff, and timeout control.

### 13. i18n
13 locales supported on both backend (`core/i18n.ts`) and frontend (`web/src/i18n`), with nested-key fallback and `Intl` formatting.

### 14. Pluggable Database Backend
SQLite (via `better-sqlite3` + WAL) is the default for single-node deployments. Set `USE_POSTGRES=1` and `DATABASE_URL` to switch to PostgreSQL without changing business logic. See [ADR-001](docs/adr/001-sqlite-default-postgres-production.md).

### 15. Horizontal Scaling
When Redis is available (`REDIS_URL`), WebSocket broadcasts use Redis Pub/Sub so notifications reach clients connected to any instance. PostgreSQL mode enables safe multi-replica deployment.

---

## 自我修改流程

1. User asks the agent to improve its loop
2. Agent reads `skills/agent-loop/index.ts` via `read_file`
3. Agent proposes a patch via `self_modify` with `type: loop_replace`
4. **Constitution Guard** checks immutable rules
5. **Rule Engine** evaluates risk → requires confirmation
6. Human confirms (or `askConfirmCallback` auto-approves in demo mode)
7. Patch is applied atomically (tmp → validate → rename)
8. **Canary tests** run automatically; failure triggers rollback
9. Next invocation loads the new Agent Loop

---

## 环境变量

Copy `.env.example` to `.env` and configure:

```env
LLM_PROVIDER=openai        # openai | anthropic | minimax | qwen | gemini | local
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=sk-...
# LLM_BASE_URL=            # optional, for local proxies

# Optional: auxiliary LLM for review/compression/vision
# AUXILIARY_REVIEW_PROVIDER=openai
# AUXILIARY_REVIEW_API_KEY=sk-...
# AUXILIARY_REVIEW_MODEL=gpt-4o-mini

# Optional: PostgreSQL backend for multi-node deployments
USE_POSTGRES=1
DATABASE_URL=postgresql://user:pass@localhost:5432/ouroboros

# Optional: Redis for distributed rate limiting and WS broadcast
REDIS_URL=redis://localhost:6379/0

# Data retention (used by cleanup script)
# OUROBOROS_RETENTION_DAYS=30
# OUROBOROS_MAX_DB_BACKUPS=10
# OUROBOROS_MAX_CHECKPOINTS=20

# Optional: slow query logging threshold (ms)
SLOW_QUERY_THRESHOLD_MS=500
```

完整环境变量列表见 [docs/configuration.md](./docs/configuration.md)。

---

## 文档

| 文档 | 说明 |
|---|---|
| [AGENTS.md](./AGENTS.md) | AI 辅助开发指南：架构、编码规范、测试、自我修改安全流程 |
| [docs/architecture.md](./docs/architecture.md) | 系统架构详解：核心模块、数据流、自我进化流水线、前端架构 |
| [docs/api.md](./docs/api.md) | HTTP API 与 WebSocket 协议文档 |
| [docs/configuration.md](./docs/configuration.md) | 完整环境变量参考与生产配置模板 |
| [docs/contributing.md](./docs/contributing.md) | 开发环境搭建、提交规范、PR 流程、测试要求、安全审核 |
| [docs/deployment.md](./docs/deployment.md) | Docker / Compose / K8s / 裸机部署指南 |
| [docs/postgresql-migration.md](./docs/postgresql-migration.md) | SQLite → PostgreSQL 迁移指南 |
| [docs/adr/001-sqlite-default-postgres-production.md](./docs/adr/001-sqlite-default-postgres-production.md) | ADR：数据库后端选择 |
| [docs/adr/002-permission-engine-v2.md](./docs/adr/002-permission-engine-v2.md) | ADR：Permission Engine v2 多源规则引擎 |
| [docs/adr/003-self-modification-safety.md](./docs/adr/003-self-modification-safety.md) | ADR：自修改安全模型（4 层防护） |
| [docs/adr/004-multi-agent-event-bus.md](./docs/adr/004-multi-agent-event-bus.md) | ADR：多智能体协调 — 统一事件总线 |
| [docs/adr/005-evolution-skill-cluster.md](./docs/adr/005-evolution-skill-cluster.md) | ADR：Evolution Skill 集群 — 域内紧耦合与 DI 解耦 |

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 运行时 | Node.js >= 20, TypeScript 5.7 (strict) |
| 测试 | Vitest 3.x, Playwright (E2E), `@testing-library/react` |
| 数据库 | SQLite (`better-sqlite3` + WAL) / PostgreSQL (`pg` + `umzug`) |
| 缓存/消息 | Redis (`ioredis`), 内存 `SmartCache` |
| 前端 | React 19, Vite 6, TailwindCSS, Zustand, TanStack Query |
| 部署 | Docker, Docker Compose, Helm |

---

## License

MIT
