# Ouroboros Agent — AI 辅助开发指南

> **定位**：一个能自己改自己代码、自己提交 Git、自己持续进化的开源 AI 系统，目标是做「有持久身份的连续数字实体」。
> **Immutable floor**：`core/rule-engine.ts`。其余一切 —— 包括 **Agent Loop 本身** —— 都是可被学习、补丁和替换的 **Skill**。

---

## 1. 项目架构概览（core / web / skills 三层）

```
ouroboros-agent/
├── core/                 # Immutable kernel + 基础设施
│   ├── rule-engine.ts    # 唯一不可变层：元规则引擎
│   ├── tool-framework.ts # Fail-closed 工具构造器 + 流式执行器
│   ├── permission-gate.ts# 三层权限管道
│   ├── event-bus.ts      # 异步事件队列 + 死信存储
│   ├── db-*.ts           # 数据库连接、迁移、适配器（SQLite / PostgreSQL）
│   ├── config.ts         # 中央配置（环境变量单一可信源）
│   └── logger.ts         # 结构化日志
├── web/                  # 前端 + HTTP API + WebSocket
│   ├── src/              # React 19 + Vite 6 SPA（React Query 状态管理）
│   ├── server.ts         # Node.js native HTTP 服务器
│   ├── ws-server.ts      # WebSocket 实时聊天与通知
│   └── routes/           # REST API 路由处理器
├── skills/               # 一切皆为 Skill（≈ 60+ 个目录）
│   ├── agent-loop/       # 主代理循环（可替换）
│   ├── self-modify/      # 自我修改安全网关
│   ├── autonomous-evolution/ # 自动进化守护进程
│   ├── knowledge-base/   # RAG：嵌入 + 向量搜索
│   ├── browser/          # Playwright 浏览器自动化
│   └── ...               # 其余按功能划分的 Skill
├── extensions/im/        # IM 通道插件（Feishu / Telegram / Discord / Slack …）
├── types/                # 严格的 Zod + TypeScript 边界
└── tests/                # 单元 + 集成测试（Vitest）
```

### 1.1 核心设计哲学

- **Skill = File**：每个 Skill 由 `skills/<name>/SKILL.md` 描述，可选携带 `index.ts` 代码附件，运行时动态导入。
- **Fail-Closed 默认**：所有新工具默认 `isReadOnly: false`、`isConcurrencySafe: false`，必须显式 opt-in。
- **Immutable Kernel**：`core/` 中只有 `rule-engine.ts`、`tool-framework.ts`、`permission-gate.ts` 属于神圣地板；其余 `core/` 文件（如 `db-pg.ts`、`config.ts`）仍可进化，只是不推荐随意修改。

---

## 2. 编码规范

### 2.1 TypeScript 严格模式

- 使用 **TypeScript 5.4+**，`tsc --noEmit` 零错误才能提交。
- 所有公共 API 必须带 Zod Schema；禁止 `any`，除非与外部不确定结构交互（需标注 `// eslint-disable-next-line @typescript-eslint/no-explicit-any`）。
- 优先使用 `readonly`、不可变数据结构和显式返回类型。

### 2.2 Fail-Closed 策略

安全敏感代码（Rule Engine、Permission Gate、Webhook 签名、指纹检查）**必须 fail-closed**：

```ts
// ✅ 正确：任何异常都导致拒绝/阻断
export function safeFailClosed<T>(fn: () => T, context: string): T | undefined {
  try { return fn(); } catch (e) { logger.warn(`${context} failed closed`, { error: String(e) }); return undefined; }
}

// ❌ 错误：异常时返回原始输入，可能导致绕过
```

基础设施探测（表存在性、进程存活）可以 fail-open，但必须记录 `logger.info`。
清理/关闭操作静默忽略错误，使用 `safeIgnore()` 并记录 `logger.debug`。

### 2.3 Immutable Kernel 保护

以下路径受 **Constitution Guard** 保护，禁止自我修改：

- `core/rule-engine.ts`
- `core/tool-framework.ts`
- `core/permission-gate.ts`
- `core/config.ts`
- `identity.md`、`BIBLE.md`

任何对这些文件的修改请求都会被 `self-modify` 拒绝，并记录安全审计日志。

---

## 3. 测试规范

### 3.1 测试框架

- **后端 + 前端单元测试**：Vitest
- **E2E**：Playwright
- **覆盖率引擎**：`@vitest/coverage-v8`

### 3.2 并行与隔离

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    pool: "forks",           // 进程隔离，避免 SQLite 文件锁竞争
    poolOptions: { forks: { singleFork: false } },
    coverage: {
      thresholds: {
        statements: 75,
        branches: 73,
        functions: 72,
        lines: 75,
      },
    },
  },
});
```

### 3.3 DB 隔离

- 每个 fork worker 使用独立的数据库文件或 schema（`.ouroboros/vitest-<pid>/session.db`）。
- 测试结束后自动清理；若遇到 `Database is already locked`，先删除 `.ouroboros/vitest-*/session.lock`。
- PostgreSQL 模式下使用事务回滚实现测试隔离。

### 3.4 故障注入

- `tests/skills/self-healing/` 中通过模拟异常触发快照 + 回滚流水线。
- `tests/core/llm-resilience.test.ts` 中通过拦截网络请求模拟 Provider 超时和熔断。

### 3.5 提交前必跑

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint 9
npm test            # Vitest 后端
cd web && npm test  # Vitest 前端
cd web && npm run build
```

---

## 4. 自我修改安全流程（4 层防线）

所有自我修改（`self_modify`、`write_skill`、`loop_replace` 等）必须经过以下流水线：

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ 1. Constitution │ → │ 2. Syntax       │ → │ 3. Backup       │ → │ 4. Canary       │
│    Guard        │    │    Validation   │    │    Snapshot     │    │    Test         │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 4.1 Constitution Guard

- 检查目标路径是否在受保护列表中（`core/rule-engine.ts` 等）。
- 检查修改类型风险等级：`loop_replace` / `rule_engine_override` 永远需要人工确认。
- 自动允许的只有 `skill_create`、`skill_patch`、`skill_delete` 且风险分低于阈值时。

### 4.2 Syntax Validation

- 对修改后的 `.ts` / `.js` 文件运行 `tsc --noEmit`。
- 语法检查不通过 → 拒绝补丁，不写入磁盘。

### 4.3 Backup Snapshot

- 修改前调用 `createBackup()`，完整备份文件树到 `.ouroboros/backups/<timestamp>/`。
- 若 canary 失败或运行时异常，自动调用 `restoreBackup()` 回滚。

### 4.4 Canary Test

- 修改后执行一组轻量 canary 测试（如加载 Skill、执行一次 mock LLM 调用）。
- 失败 → 自动回滚并通知 EventBus。

> **Demo 模式**：设置 `OUROBOROS_DEMO_MODE=1` 可开启交互式确认，低/中风险变更可在终端批准。高风险变更始终拒绝。

---

## 5. 如何添加新技能

### 5.1 最小 Skill（仅文档）

```bash
mkdir skills/my-skill
cat > skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
version: 1.0.0-rc.1
description: A concise description
tags: [utility]
---

# My Skill

Explain what this skill does and when to use it.
EOF
```

重启后 `discoverSkills()` 会自动识别。

### 5.2 带代码的 Skill

```bash
mkdir skills/my-tool-skill
cat > skills/my-tool-skill/SKILL.md << 'EOF'
---
name: my-tool-skill
version: 1.0.0-rc.1
description: Demonstrates executable skill
tags: [tool]
---
EOF

cat > skills/my-tool-skill/index.ts << 'EOF'
import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";

export const myTool = buildTool({
  name: "my_tool",
  description: "Does something useful",
  inputSchema: z.object({ query: z.string() }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async call(input, ctx) {
    ctx.reportProgress({ message: "Working..." });
    return { result: `You said: ${input.query}` };
  },
});
EOF
```

### 5.3 注册与加载

- `web/runner-pool.ts` 启动时会调用 `reconcileSkillRegistry()`，扫描所有 `skills/*/SKILL.md` 和 `index.ts`。
- 代码附件通过 `await import(path)` 动态加载，导出的 Tool 自动注册到 `globalPool`。
- 热重载：文件变更时 `hot-reload` Skill 会触发 `reloadSkillTools()`，向所有活跃 Session Pool 传播新工具。

### 5.4 Skill 安全约束

- 新工具默认 `isReadOnly: false`；若实际只读，请显式设为 `true` 以降低权限审查。
- 涉及文件系统、网络、自我修改的操作必须在 `checkPermissions` 中声明风险。
- Skill 代码必须通过 `skills-guard` 的静态检查（禁止 `eval`、`Function` 构造器、敏感路径写操作）。

---

## 6. 常用命令速查

| 命令 | 作用 |
|------|------|
| `npm run dev` | 启动 Web 服务器（开发模式） |
| `npm run dev:main` | 运行主交互式 demo（mock LLM） |
| `npm test` | 运行后端单元测试 |
| `npm run test:coverage` | 带覆盖率报告 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 检查 |
| `npm run e2e` | Playwright E2E 测试 |
| `cd web && npm run dev` | 前端 Vite 开发服务器 |
| `cd web && npm test` | 前端单元测试 |

---

## 7. 延伸阅读

- [系统架构](./docs/architecture.md)
- [API 文档](./docs/api.md)
- [配置参考](./docs/configuration.md)
- [贡献指南](./docs/contributing.md)
- [部署指南](./docs/deployment.md)
