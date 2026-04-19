# Ouroboros Agent — 系统架构文档

> 本文档描述 Ouroboros Agent 的宏观架构、核心模块、数据流与自我进化机制。适用于新成员 onboarding、架构评审和故障排查。

---

## 目录

- [1. 架构全景](#1-架构全景)
- [2. 核心模块](#2-核心模块)
  - [2.1 Rule Engine](#21-rule-engine)
  - [2.2 Tool Framework](#22-tool-framework)
  - [2.3 Permission Gate](#23-permission-gate)
  - [2.4 Event Bus](#24-event-bus)
- [3. 数据流](#3-数据流)
- [4. 自我进化流水线](#4-自我进化流水线)
- [5. 前端架构](#5-前端架构)
- [6. 数据持久化](#6-数据持久化)
- [7. 扩展点](#7-扩展点)

---

## 1. 架构全景

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client Layer                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Web SPA    │  │ Feishu Bot  │  │ Telegram    │  │  Prometheus / OTLP  │ │
│  │ (React+Vite)│  │             │  │ Discord     │  │  (Observability)    │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────────────────────┘ │
└─────────┼────────────────┼────────────────┼─────────────────────────────────┘
          │                │                │
          └────────────────┴────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────────────────┐
│                        Web / API Layer                                       │
│  ┌─────────────────────────┼─────────────────────────────────────────────┐   │
│  │   HTTP Server (native)  │   WebSocket Server                          │   │
│  │   ───────────────────   │   ───────────────────                       │   │
│  │   • REST API handlers   │   • Real-time chat                          │   │
│  │   • Rate limiting       │   • Progress streaming                      │   │
│  │   • Bearer auth         │   • Notification broadcast                  │   │
│  │   • CORS / Security hdr │   • Redis Pub/Sub (multi-instance)          │   │
│  └─────────────────────────┴─────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
┌─────────────────────────────────────┼────────────────────────────────────────┐
│                              Core Kernel                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Rule Engine │  │ Tool Framew │  │Permission   │  │   Event Bus         │ │
│  │ (Immutable) │  │ (Fail-closed)│  │   Gate      │  │ (Async + DeadLetter)│ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                │                    │            │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────────┴──────────┐ │
│  │ Config      │  │ DB Manager  │  │ Logger      │  │  Security Framework │ │
│  │ (env-based) │  │ (SQLite/PG) │  │ (structured)│  │  (Audit + PathVal)  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
┌─────────────────────────────────────┼────────────────────────────────────────┐
│                            Skills Ecosystem                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Agent Loop  │  │ Self-Modify │  │ Knowledge   │  │  Browser / Computer │ │
│  │ (Replaceable)│  │ (Safety 4x) │  │   Base      │  │      Use            │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Autonomous  │  │ Evolution   │  │ Task Sched  │  │  Self-Healing       │ │
│  │ Evolution   │  │ Observability│  │ (Cron/Delay)│  │  (Snapshot/Rollback)│ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Budget Guard│  │ Rate Limiter│  │ Telemetry   │  │  i18n (13 locales)  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心模块

### 2.1 Rule Engine

**文件**：`core/rule-engine.ts`  
**性质**：系统唯一 Immutable 组件。

职责：

- 定义元规则公理：*"系统允许自我修改，但每一次修改都必须通过 Rule Engine 的边界检查。"*
- 评估修改请求的风险等级（`low` / `medium` / `high` / `critical`）。
- 对受保护路径（`core/rule-engine.ts`、`core/tool-framework.ts`、`core/permission-gate.ts` 等）实施硬拒绝。
- 决定某类修改是否需要人工确认（`ask`）或可直接自动执行（`allow`）。

```ts
export interface RuleEngine {
  evaluate(request: ModificationRequest): Result<EvaluatedRisk>;
}
```

### 2.2 Tool Framework

**文件**：`core/tool-framework.ts`

职责：

- 提供 `buildTool()` 工厂函数，所有工具必须通过此函数注册。
- **Fail-closed 默认**：`isReadOnly = false`、`isConcurrencySafe = false`。
- 支持流式执行：`ToolCallContext.reportProgress()` 可向 WebSocket 推送中间状态。
- `createToolPool()` 管理工具注册表，支持热重载（`reload` / `unregister`）。

```ts
export function buildTool<Input, Output, Progress>(opts: ToolBuildOptions<Input, Output, Progress>): Tool;
```

### 2.3 Permission Gate

**文件**：`core/permission-gate.ts`

三层权限管道：

```
┌────────────────────────────────────────────────────────────┐
│  Layer 1: Rule Matching                                    │
│  • alwaysDenyRules → deny                                  │
│  • alwaysAskRules  → ask                                   │
│  • alwaysAllowRules → allow                                │
│  • 默认 → ask（保守策略）                                   │
├────────────────────────────────────────────────────────────┤
│  Layer 2: Tool-specific checkPermissions()                 │
│  • 每个 Tool 可自定义权限逻辑                               │
│  • 返回 deny / ask / allow                                 │
├────────────────────────────────────────────────────────────┤
│  Layer 3: Mode Layer                                       │
│  • bypass / auto / interactive                             │
│  • 可选 human confirmation callback                        │
└────────────────────────────────────────────────────────────┘
```

### 2.4 Event Bus

**文件**：`core/event-bus.ts`

生产级异步事件总线，向后兼容 `HookRegistry`：

- 内存队列 + 持久化死信存储（`dead_letters` 表）。
- 可配置重试策略：指数退避、线性退避、固定间隔。
- 默认重试 3 次，超过阈值后写入死信表，供后续人工排查或自动重试。
- 支持事件类型：`evolution:proposed`、`evolution:executed`、`evolution:failed`、`webhook`、`tool_result` 等。

---

## 3. 数据流

### 3.1 典型请求生命周期

```
Client Request
       │
       ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Rate Limiter │ → │  CORS / Auth  │ → │  API Router   │
│  (Token Bucket)│   │  (Bearer)     │    │  (path match) │
└──────────────┘    └──────────────┘    └──────┬───────┘
                                                │
                       ┌────────────────────────┼────────────────────────┐
                       │                        │                        │
                       ▼                        ▼                        ▼
                ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
                │  Session    │         │  Skill      │         │  System     │
                │  Handler    │         │  Handler    │         │  Handler    │
                └──────┬──────┘         └──────┬──────┘         └──────┬──────┘
                       │                        │                        │
                       ▼                        ▼                        ▼
                ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
                │  SessionDB   │         │  Skill Registry│      │  DB / Cache  │
                │  Repository  │         │  (discover)   │       │  (metrics)   │
                └──────┬──────┘         └─────────────┘         └──────┬──────┘
                       │                                               │
                       └───────────────────────┬───────────────────────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │  Event Bus   │
                                        │  (async)     │
                                        └──────┬──────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │ WebSocket    │
                                        │ Broadcast    │
                                        └─────────────┘
```

### 3.2 WebSocket 聊天流

1. 前端通过 `new WebSocket("ws://host")` 连接。
2. 发送 `{ type: "chat", message: "...", sessionId: "..." }`。
3. `ws-server.ts` 将消息路由到对应 `AgentLoopRunner`。
4. `AgentLoop` 调用 LLM → 触发工具 → 产生 `tool_result`。
5. 中间进度通过 `reportProgress()` → EventBus → WebSocket 推回前端。
6. 最终 `assistant` 消息写入 `messages` 表，并再次推回前端。

---

## 4. 自我进化流水线

Ouroboros 的核心差异化能力：**代码级的自我进化**，而非仅参数调优。

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Review    │ → │   Propose   │ → │  Consensus  │ → │   Execute   │ → │  Validate   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

### 4.1 Review（审查）

- **Background Review Agent（Hermes）**：会话结束后，非阻塞地分析轨迹，识别改进点。
- **Evolution Generator（v8.3）**：启发式扫描代码异味（magic numbers、长函数 >50 行、深层嵌套 >4、缺失返回类型）和测试缺口。
- **Meta-Evolution（v9.1）**：分析历史进化结果，自动调优系统参数（阈值、冻结期）。

### 4.2 Propose（提案）

- 生成 `EvolutionProposal`，包含：目标文件、unified diff、风险评分、预期收益。
- 写入 `evolution_versions` 表，状态为 `proposed`。

### 4.3 Consensus（共识）

- **Hybrid Approval Generator**：低风险（`riskScore < 20`）自动批准；中风险需人工或 demo 模式确认；高风险拒绝。
- **Evolution Dependency Graph（v8.2）**：检测提案间的文件冲突和顺序依赖，拓扑排序后批量执行。

### 4.4 Execute（执行）

- 通过 `self-modify` 应用补丁：Constitution Guard → Syntax Validation → Atomic Write → Backup Snapshot。
- 状态更新为 `executed` 或 `failed`。

### 4.5 Validate（验证）

- **Canary Test**：运行轻量测试验证修改后系统可正常启动。
- **Evolution Observability（v8.1）**：收集指标，若检测到异常（成本飙升、错误率上升）自动触发 `evolution:rolledBack`。
- **Evolution Feedback（v7.1+）**：记录结果到 Knowledge Base，为未来的 RAG 引导决策提供依据。

---

## 5. 前端架构

### 5.1 技术栈

| 层 | 技术 |
|---|---|
| 框架 | React 19 |
| 构建工具 | Vite 6 |
| 样式 | Tailwind CSS 3 + PostCSS |
| 数据获取 | `@tanstack/react-query` 5 |
| 路由 | 无外部路由库，基于本地状态切换 Tab |
| 图标 | `lucide-react` |
| Markdown | `react-markdown` + `remark-gfm` + `react-syntax-highlighter` |
| 测试 | Vitest + `@testing-library/react` + `happy-dom` |

### 5.2 页面结构

```
App.tsx
├── ChatView          # 主聊天界面（WebSocket 实时消息）
├── SystemDashboard   # 系统状态、Token 用量、Circuit Breaker
├── SkillManager      # Skill 列表、安装、生成
├── KnowledgeBaseManager # KB 文档管理
├── WorkflowStudio    # 可视化工作流编排
├── MemoryBrowser     # 记忆层浏览与搜索
├── TokenUsagePage    # 详细 Token 消耗统计
├── Gallery           # 浏览器截图画廊
└── ToastContainer    # 全局通知
```

### 5.3 状态管理

- **服务端状态**：React Query (`useQuery` / `useMutation`) 负责缓存、去重和后台刷新。
- **客户端 UI 状态**：React `useState` / `useReducer` 管理当前 Tab、模态框、表单输入。
- **全局通知**：通过 WebSocket 接收 `notification` 事件，写入本地状态并渲染 Toast。

---

## 6. 数据持久化

### 6.1 数据库后端

| 模式 | 适用场景 | 切换方式 |
|---|---|---|
| **SQLite**（默认） | 单机、开发、快速启动 | 无需配置 |
| **PostgreSQL** | 多实例、水平扩展、高并发 | `USE_POSTGRES=1` + `DATABASE_URL` |

SQLite 使用 `better-sqlite3` + WAL 模式；PostgreSQL 使用 `pg` + 连接池（max 20）。

### 6.2 核心数据表

- `sessions` / `messages` —— 会话与消息历史
- `trajectories` —— 完整执行轨迹（用于训练数据导出）
- `memory_layers` / `kb_chunks` / `vector_embeddings` —— 记忆与 RAG
- `evolution_versions` / `evolution_executions` —— 进化版本与执行记录
- `dead_letters` —— Event Bus 死信
- `api_audit_log` / `security_audit_log` —— 审计日志
- `token_usage` —— LLM Token 消耗统计

### 6.3 文件系统

- `.ouroboros/session.db` —— SQLite 主库
- `.ouroboros/backups/` —— 自动备份
- `.ouroboros/skill-versions/` —— Skill 修改快照
- `.ouroboros/browser-screenshots/` —— 浏览器截图（自动清理，保留 200 张 / 24 小时）
- `.ouroboros/uploads/` —— 上传文件（30 天自动清理）

---

## 7. 扩展点

### 7.1 添加 IM 通道

实现 `ChannelPlugin` 接口：

```ts
interface ChannelPlugin {
  id: string;
  inbound: { onMessage(handler: (msg: InboundMessage) => Promise<void>): void };
  outbound: { sendText(channelId: string, text: string): Promise<void> };
  meta: { name: string; locale: Record<string, string> };
}
```

在 `extensions/im/<name>/index.ts` 实现后，于 `web/routes/shared.ts` 中 `channelRegistry.register()` 注册。

### 7.2 添加数据库适配器

实现 `DbAdapter` 接口（`core/db-adapter.ts`），在 `core/db-manager.ts` 中根据 `USE_POSTGRES` 环境变量切换。

### 7.3 添加监控导出器

`skills/telemetry/otel.ts` 已集成 OpenTelemetry。如需新增导出目标，修改 `initOtel()` 中的 `NodeSDK` 配置即可。

---

## 相关文档

- [API 文档](./api.md)
- [配置参考](./configuration.md)
- [部署指南](./deployment.md)
- [PostgreSQL 迁移指南](./postgresql-migration.md)
