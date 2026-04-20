# Ouroboros（衔尾蛇）Agent

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0--rc.1-blue" alt="version" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20.0.0-brightgreen" alt="node" />
  <img src="https://img.shields.io/badge/coverage-80.24%25-success" alt="coverage" />
  <img src="https://img.shields.io/badge/tests-1417%20passed-purple" alt="tests" />
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="license" />
</p>

> **一句话定位**：一个能自己改自己代码、自己提交 Git、自己持续进化的开源 AI 系统，目标是做「有持久身份的连续数字实体」，不是一次性脚本。
>
> v1.0.0-rc.1 里程碑：测试覆盖率突破 80%，ESLint 工具链修复，Marketplace 版本管理加固，Hook 系统完成 ESM 兼容，CI 覆盖 Node 20/22/24 + Docker 构建。

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

### 系统要求

- **Node.js** >= 20.0.0（推荐 24.x，开发验证环境）
- **npm** >= 10
- **原生编译工具链**（用于 `better-sqlite3`）：
  - macOS: `xcode-select --install`
  - Ubuntu/Debian: `sudo apt-get install build-essential python3`
  - Windows: 安装 [windows-build-tools](https://github.com/felixrieseberg/windows-build-tools) 或使用 WSL2

### 方式一：本地源码启动

```bash
# 1. 克隆仓库
git clone https://github.com/your-org/ouroboros-agent.git
cd ouroboros-agent

# 2. 安装依赖（npm workspaces 自动管理 skills/ 下的子包）
npm install
# 若 better-sqlite3 编译失败，尝试：
npm rebuild better-sqlite3

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，至少填入：
#   LLM_PROVIDER=openai
#   LLM_MODEL=gpt-4o-mini
#   LLM_API_KEY=sk-...

# 4. 选择运行模式

# 模式 A: 主 Agent 循环（命令行交互，适合 headless 部署）
npm run dev:main

# 模式 B: Web 服务（前端 + API + WebSocket，适合人机协作）
npm run dev
# 打开浏览器访问 http://localhost:8080

# 模式 C: 后台守护进程（自动进化 + 定时任务 + IM 监听）
# 需在 .env 中启用 AUTONOMOUS_EVOLUTION_ENABLED=1
npx tsx main.ts --daemon
```

### 方式二：Docker 一键启动

```bash
# 构建并运行（使用 SQLite 默认后端）
docker build -t ouroboros-agent .
docker run -it --rm \
  -p 8080:8080 \
  -e LLM_PROVIDER=openai \
  -e LLM_API_KEY=sk-... \
  -v $(pwd)/.ouroboros:/app/.ouroboros \
  ouroboros-agent

# 或使用 Docker Compose（含 PostgreSQL + Redis 生产栈）
docker compose -f deploy/docker-compose.yml up
```

### 验证安装

```bash
# 验证 LLM 连通性
npx tsx scripts/test-llm.ts

# 验证核心功能（自我修改安全流水线）
npx tsx scripts/self-evolve-demo.ts

# 验证自我治愈（快照 + 回滚）
npx tsx scripts/test-self-healing.ts
```

### 运行测试

```bash
# 后端单元测试（1417 tests, coverage 80.24%）
npm test

# 带覆盖率报告
npm run test:coverage

# 前端单元测试
cd web && npm test

# E2E 测试（需先启动服务）
npm run e2e
```

### 数据清理与维护

```bash
# 查看会删除什么（dry-run）
npm run cleanup:dry-run

# 执行清理（按保留策略删除旧备份、检查点和日志）
npm run cleanup

# TypeScript 类型检查
npm run typecheck

# 代码检查
npm run lint

# 安全审计
npm run audit:ci
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
core/                         # Immutable kernel — skills/ 严格禁止反向依赖
  rule-engine.ts              # 自我修改的最高裁决者（唯一不可变地板）
  tool-framework.ts           # Fail-closed Tool builder + StreamingToolExecutor
  tool-registry.ts            # 运行时工具注册表
  permission-gate.ts          # 3-layer permission pipeline
  permission-engine.ts        # 多源规则引擎（CLI → 项目 → 会话 → 设置）
  constitution-guard.ts       # 运行时宪法守卫（硬编码规则 + 路径验证）
  security-framework.ts       # 审计日志 + 路径验证 + 速率限制
  security-integration.ts     # 安全策略集成层
  intrusion-detection.ts      # 入侵检测与异常行为分析
  prompt-defense.ts           # 提示词注入防御
  denial-tracker.ts           # 拒绝服务追踪与熔断

  db-manager.ts               # 连接单例 + 迁移（SQLite & PostgreSQL）
  db-adapter.ts               # DbAdapter 接口，运行时后端切换
  db-utils.ts                 # 数据库工具函数
  db-metrics.ts               # 查询性能指标
  db-pg.ts                    # PostgreSQL 专用连接池
  migrations/                 # Umzug 数据库迁移脚本
  repositories/               # 数据访问层（memory-layers, skill, modification）

  event-bus.ts                # 生产级事件总线（重试 + 退避 + 死信队列）
  hook-system.ts              # 可扩展 Hook Registry（超时 + 动态发现）

  llm-router.ts               # 多供应商 LLM 路由 + 负载均衡
  llm-resilience.ts           # 熔断器、重试、降级策略
  llm-metrics.ts              # 调用延迟与 Token 消耗统计
  llm-cache-wrapper.ts        # LLM 响应缓存层
  llm-stream-helpers.ts       # 流式响应处理
  llm-stream-providers.ts     # 流式供应商适配器
  llm-types.ts                # LLM 领域类型定义
  auxiliary-llm.ts            # 辅助模型（审查 / 压缩 / 视觉）调度

  redis.ts                    # Redis 连接管理（Pub/Sub + 分布式锁）
  distributed-lock.ts         # 分布式锁实现
  smart-cache.ts              # LRU + TTL + 大小感知的内存缓存
  semantic-cache.ts           # 语义缓存（基于向量相似度）
  vector-memory.ts            # 向量内存存储

  disk-monitor.ts             # 磁盘空间监控与告警
  performance-optimizer.ts    # 性能分析与优化建议
  batch-processor.ts          # 批量任务处理器

  config.ts                   # 中心化配置（环境变量驱动）
  config-extension.ts         # 配置扩展与数据库别名
  logger.ts                   # 结构化日志（JSON / 文本双模式）
  sentry.ts                   # 错误追踪与性能监控集成

  session-db.ts               # 会话持久化（SQLite WAL 模式）
  session-state.ts            # 会话状态机管理
  channel-registry.ts         # IM 通道注册表

  index.ts                    # Core barrel exports

skills/                       # 一切皆 Skill — 包括 Agent Loop 本身
  # Agent 核心
  agent-loop/                 # 主循环（可替换、可进化）
  agent-memory-patterns/      # 智能体记忆模式库
  agentic-coding/             # Agent 驱动的代码生成

  # 进化流水线（Evolution Cluster）
  autonomous-evolution/       # 24/7 自动进化守护进程
  evolution-core/             # Evolution 技能群 DI 注册表 + 领域边界
  evolution-orchestrator/     # 进化流水线协调器
  evolution-feedback/         # 失败反馈 + 自动回滚 + 修复提案
  evolution-consensus/        # 多智能体共识审查
  evolution-dependency-graph/ # 进化依赖拓扑分析
  evolution-executor/         # 进化执行引擎
  evolution-generator/        # LLM 驱动的代码生成器
  evolution-memory/           # 进化历史记忆与学习
  evolution-observability/    # 进化过程可观测性
  evolution-sync/             # 跨实例进化同步
  evolution-version-manager/  # 版本管理与风险评分
  evolution-viz/              # 进化可视化与趋势分析
  meta-evolution/             # 元进化参数自调优

  # 记忆与知识
  knowledge-base/             # RAG：ingest + embedding + 向量搜索
  learning/                   # 轨迹压缩 + skill 文件系统操作
  memory-wiki/                # 记忆维基（Claim + Evidence 结构化）
  memory-tiering/             # 记忆分层存储（热 / 温 / 冷）
  memory-never-forget/        # 长期记忆固化
  fluid-memory/               # 流式记忆处理
  elite-longterm-memory/      # 精英长期记忆筛选
  memory-system-optimizer/    # 记忆系统自优化
  dreaming/                   # 梦境记忆三阶段固化（light → deep → promoted）
  engraph/                    # 图数据库语义搜索（2-hop CTE + 加权评分）

  # 人格与身份
  personality/                # 人格演化（10 维特质 + 8 维价值观）
  personality/v2/             # Persona 解析器 v2
  semantic-constitution/      # 语义宪法守卫评估

  # IM 与通道集成
  feishu-* /                  # 飞书/Lark 全功能集成（文档/表格/审批/日历）
  mcp/                        # MCP 连接管理器（stdio / sse / streamable-http）
  mcp-adapter/                # MCP 工具适配器
  mcp-bridge/                 # MCP 跨实例桥接
  webhooks/                   # Webhook 注册 & 投递

  # 工具与自动化
  browser/                    # Playwright 浏览器自动化 + Computer Use
  file-tools.ts               # 文件系统操作工具集
  git-essentials/             # Git 基础操作
  git-workflows/              # Git 工作流自动化
  code-execution/             # 沙箱代码执行
  web-agent/                  # Web 代理与爬虫
  web-browsing/               # 智能网页浏览
  web-learner/                # 在线学习自动化
  playwright/                 # Playwright 高级封装
  canvas/                     # 画布与白板工具

  # 基础设施
  task-scheduler/             # Cron / 间隔 / 延迟 / 一次性任务 + 依赖图
  task-prioritizer/           # 任务优先级调度与并发控制
  rate-limiter/               # Redis 滑动窗口限流 + 内存降级
  telemetry/                  # OpenTelemetry spans、指标、OTLP 导出
  self-healing/               # 异常检测、快照、回滚、修复
  self-modify/                # 所有自我修改的统一网关
  hot-reload/                 # Skill 文件变更自动重载
  sandbox/                    # Subagent 上下文隔离
  sandbox-exec/               # 安全执行沙箱
  checkpoint/                 # Shadow-git 文件系统快照
  backup/                     # 数据库备份 & 恢复 + 自动保留策略
  monitoring-dashboard/       # 系统监控仪表板
  system-health-dashboard/    # 健康状态聚合面板

  # 生产力
  notion-skill/               # Notion 集成
  office-productivity/        # Office 自动化
  pdf-generator/              # PDF 生成
  pptx-generator/             # PPT 生成
  spreadsheet-automation/     # 表格自动化
  research-engine/            # 研究引擎
  in-depth-research/          # 深度研究
  summarize-pro/              # 专业摘要

  # 技能市场与管理
  marketplace/                # Skill 市场（Git/本地安装 + 版本比较）
  skill-versioning/           # Skill 快照、恢复、版本历史
  skill-factory/              # Skill 工厂（模板生成）
  skill-creator-assistant/    # Skill 创建助手
  skill-scan/                 # Skill 安全扫描
  skills-guard/               # Skill 运行守护
  incremental-test/           # 增量测试运行器
  test-generator/             # 测试代码生成

  # 多媒体与生成
  multimedia/                 # 图像/视频/音乐生成（MiniMax 等）
  ai-presentation-maker/      # AI 演示文稿生成
  minimax-docx/               # MiniMax Docx 生成
  minimax-pdf/                # MiniMax PDF 生成
  minimax-xlsx/               # MiniMax Excel 生成

  # 其他工具
  budget-guard/               # 实时预算追踪 + 自动熔断
  i18n/                       # 13 语言国际化
  crewai/                     # CrewAI 多智能体协作
  notification/               # 全局通知总线
  sop/                        # 标准操作流程引擎
  tool/                       # 通用工具框架
  toolrouter-gateway/         # 工具路由网关

extensions/
  im/
    mock-chat/                # Mock IM 通道（本地测试）
    feishu/                   # 飞书/Lark 企业集成
    telegram/                 # Telegram Bot API
    discord/                  # Discord Gateway WebSocket
    dingtalk/                 # 钉钉集成
    wechatwork/               # 企业微信集成
    slack/                    # Slack WebSocket 集成

types/                        # 严格 TypeScript 边界
  evolution.ts                # Evolution 领域共享类型
  llm-types.ts                # LLM 供应商类型
  index.ts                    # 全局类型导出

web/                          # Vite + React 19 SPA + WebSocket + HTTP API
  src/                        # 前端源码（TSX, Zustand, TanStack Query, Tailwind）
  server.ts                   # 生产服务器（静态文件 + API 代理）
  ws-server.ts                # WebSocket 服务器（Redis Pub/Sub 广播）
  routes/                     # API 路由处理器
    lib/                      # 共享工具（CORS、body解析、metrics、health）
    handlers/                 # 业务路由（agent、evolution、memory、tasks）

deploy/                       # Docker / Compose / Helm / K8s
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
Skills are discovered from `skills/<name>/SKILL.md`. They can optionally carry code attachments (`index.ts`) that are dynamically imported at runtime. The marketplace supports Git/ local path installation with semver comparison and security scanning.

### 4. Evolution DI Registry
The evolution skill cluster (~12 skills) uses a lightweight service locator (`skills/evolution-core/registry.ts`) to eliminate direct cross-skill imports. Modules register themselves at startup; consumers resolve dependencies via lazy getters. See [ADR-005](docs/adr/005-evolution-skill-cluster.md).

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
Cron, interval, delayed, and one-time tasks with dependency checking, retry backoff, timeout control, and priority queue.

### 13. i18n
13 locales supported on both backend (`skills/i18n/`) and frontend (`web/src/i18n/`), with nested-key fallback and `Intl` formatting.

### 14. Pluggable Database Backend
SQLite (via `better-sqlite3` + WAL) is the default for single-node deployments. Set `USE_POSTGRES=1` and `DATABASE_URL` to switch to PostgreSQL without changing business logic. See [ADR-001](docs/adr/001-postgresql-default.md).

### 15. Horizontal Scaling
When Redis is available (`REDIS_URL`), WebSocket broadcasts use Redis Pub/Sub so notifications reach clients connected to any instance. PostgreSQL mode enables safe multi-replica deployment.

### 16. LLM Resilience
`core/llm-resilience.ts` implements circuit breaker + retry + fallback patterns across multiple providers. When a provider fails, traffic automatically routes to the next available backend.

### 17. Telemetry & Observability
Built-in OpenTelemetry spans (`skills/telemetry/`), HTTP request metrics (`web/routes/lib/metrics.ts`), LLM call metrics (`core/llm-metrics.ts`), and disk monitoring (`core/disk-monitor.ts`) provide production-grade observability without external APM dependencies.

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
# === LLM 核心配置（必填） ===
LLM_PROVIDER=openai              # openai | anthropic | minimax | qwen | gemini | local
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=sk-...
# LLM_BASE_URL=                  # optional, for local proxies / 自定义端点

# === 辅助 LLM（可选，用于审查/压缩/视觉） ===
# AUXILIARY_REVIEW_PROVIDER=openai
# AUXILIARY_REVIEW_API_KEY=sk-...
# AUXILIARY_REVIEW_MODEL=gpt-4o-mini

# === 数据库（默认 SQLite，生产推荐 PostgreSQL） ===
# USE_POSTGRES=1
# DATABASE_URL=postgresql://user:pass@localhost:5432/ouroboros

# === Redis（分布式限流、WS 广播、任务队列） ===
# REDIS_URL=redis://localhost:6379/0

# === 自动进化（后台守护进程） ===
# AUTONOMOUS_EVOLUTION_ENABLED=1
# AUTONOMOUS_EVOLUTION_INTERVAL_MS=3600000
# AUTONOMOUS_MAX_CONSECUTIVE_FAILURES=3

# === 监控与可观测性 ===
# SLOW_QUERY_THRESHOLD_MS=500
# SENTRY_DSN=                    # 错误追踪
# OTEL_EXPORTER_URL=             # OpenTelemetry 导出端点

# === 数据保留策略 ===
# OUROBOROS_RETENTION_DAYS=30
# OUROBOROS_MAX_DB_BACKUPS=10
# OUROBOROS_MAX_CHECKPOINTS=20

# === IM 集成（按需启用） ===
# FEISHU_APP_ID= / FEISHU_APP_SECRET=
# TELEGRAM_BOT_TOKEN=
# DISCORD_BOT_TOKEN=
# DINGTALK_WEBHOOK=
# SLACK_BOT_TOKEN=
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
| [docs/adr/001-postgresql-default.md](./docs/adr/001-postgresql-default.md) | ADR：数据库后端选择（SQLite 默认 / PostgreSQL 生产） |
| [docs/adr/002-permission-engine-v2.md](./docs/adr/002-permission-engine-v2.md) | ADR：Permission Engine v2 多源规则引擎 |
| [docs/adr/003-self-modification-safety.md](./docs/adr/003-self-modification-safety.md) | ADR：自修改安全模型（4 层防护） |
| [docs/adr/004-multi-agent-event-bus.md](./docs/adr/004-multi-agent-event-bus.md) | ADR：多智能体协调 — 统一事件总线 |
| [docs/adr/005-evolution-skill-cluster.md](./docs/adr/005-evolution-skill-cluster.md) | ADR：Evolution Skill 集群 — 域内紧耦合与 DI 解耦 |

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 层级 | 技术 | 版本 |
|---|---|---|
| 运行时 | Node.js (ESM) | >= 20.0.0 (验证环境 24.x) |
| 语言 | TypeScript | 5.7.3 (strict mode) |
| 测试框架 | Vitest | 3.2.4 |
| 覆盖率 | @vitest/coverage-v8 | 3.1.0 |
| E2E 测试 | Playwright | 1.59.1 |
| 数据库 | SQLite (`better-sqlite3` + WAL) / PostgreSQL (`pg` + `umzug`) | 12.9.0 / 8.13.0 |
| 缓存/消息 | Redis (`ioredis`) | 5.10.1 |
| 向量搜索 | usearch | 2.21.4 |
| 前端框架 | React | 19 |
| 构建工具 | Vite | 6 |
| 样式 | TailwindCSS | 3 |
| 状态管理 | Zustand + TanStack Query | — |
| 部署 | Docker + Docker Compose + Helm | — |
| 进程管理 | PM2 (via ecosystem.config.js) | — |

---

## License

MIT
