# Ouroboros Agent — 贡献指南

> 感谢你对 Ouroboros Agent 的兴趣！本指南涵盖开发环境搭建、代码规范、提交规范、PR 流程、测试要求和安全审核流程。

---

## 目录

- [1. 开发环境搭建](#1-开发环境搭建)
- [2. 项目结构速览](#2-项目结构速览)
- [3. 提交规范](#3-提交规范)
- [4. PR 流程](#4-pr-流程)
- [5. 测试要求](#5-测试要求)
- [6. 安全审核流程](#6-安全审核流程)
- [7. 常见问题](#7-常见问题)

---

## 1. 开发环境搭建

### 1.1 前置要求

- **Node.js** >= 20.0.0（建议 20 LTS 或 22 LTS）
- **npm** >= 10
- **Git**
- （可选）**PostgreSQL** 16+（若测试 PG 后端）
- （可选）**Redis** 7+（若测试分布式功能）
- （可选）**Playwright**（若运行 E2E 测试）

### 1.2 克隆与安装

```bash
git clone https://github.com/your-org/ouroboros-agent.git
cd ouroboros-agent

# 安装后端依赖
npm install

# 若 better-sqlite3 原生模块加载失败，重建之
npm rebuild better-sqlite3

# 安装前端依赖
cd web && npm install && cd ..

# 安装 Playwright（用于 E2E）
npx playwright install
```

### 1.3 环境变量

```bash
cp .env.example .env
# 编辑 .env，至少配置 LLM_PROVIDER 和 LLM_API_KEY
```

### 1.4 验证环境

```bash
# 类型检查
npm run typecheck

# 后端测试
npm test

# 前端测试
cd web && npm test && cd ..

# 启动开发服务器
npm run dev
```

访问 http://localhost:8080 验证 Web UI 正常加载。

---

## 2. 项目结构速览

```
core/           # Immutable kernel + 基础设施
web/            # React SPA + HTTP API + WebSocket
skills/         # 所有功能模块（Agent Loop、自我修改、RAG 等）
extensions/im/  # IM 通道插件
types/          # Zod + TypeScript 共享类型
tests/          # 单元与集成测试
e2e/            # Playwright E2E 测试
```

修改前请先阅读 [架构文档](./architecture.md) 和 [AGENTS.md](../AGENTS.md)。

---

## 3. 提交规范

本项目使用 **Conventional Commits** 风格，便于自动生成 CHANGELOG。

### 3.1 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 3.2 Type

| 类型 | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 仅文档变更 |
| `style` | 代码格式（不影响逻辑） |
| `refactor` | 重构（非 feat 非 fix） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `chore` | 构建/工具链/依赖 |
| `security` | 安全修复 |

### 3.3 Scope

常用 scope：`core`、`web`、`skills`、`api`、`test`、`ci`、`deps`。

### 3.4 示例

```
feat(skills): add csv-processor skill with column statistics

Implements a new skill that parses CSV files and returns
basic statistics (min, max, mean) per numeric column.

Closes #123
```

```
fix(core): fail-closed on unresolvable path in normalizePath

Previously caught exceptions and returned raw input,
allowing potential path-traversal bypass. Now throws.

Refs: #456
```

---

## 4. PR 流程

### 4.1 创建分支

```bash
git checkout -b feat/your-feature-name
# 或
git checkout -b fix/issue-description
```

### 4.2 开发 checklist

- [ ] 代码通过 `npm run typecheck`（零错误）
- [ ] 代码通过 `npm run lint`（零错误，最小化 warning）
- [ ] 新功能附带测试
- [ ] 所有测试通过 `npm test` 和 `cd web && npm test`
- [ ] 覆盖率不降低（见下方阈值）
- [ ] 文档已更新（若修改了 API 或配置）
- [ ] `.env.example` 已更新（若新增环境变量）

### 4.3 提交 PR

1. Push 分支到远程
2. 在 GitHub 创建 PR，填写模板：
   - **描述**：解决了什么问题，如何解决的
   - **测试**：如何验证的
   - **影响范围**：是否涉及权限/规则/安全模块
3. 等待 CI 通过（GitHub Actions 运行 typecheck、lint、test）
4. 至少 **1 名维护者** approve 后合并

### 4.4 合并后

- 使用 **Squash and Merge** 保持主分支线性历史
- 合并提交信息遵循 Conventional Commits

---

## 5. 测试要求

### 5.1 覆盖率阈值

```ts
// vitest.config.ts
thresholds: {
  statements: 75,
  branches: 73,
  functions: 72,
  lines: 75,
}
```

**PR 不得降低现有覆盖率。** 若新增未覆盖文件（如纯 UI 组件），请在 `vitest.config.ts` 的 `exclude` 中说明理由。

### 5.2 测试分类

| 类型 | 位置 | 工具 | 说明 |
|---|---|---|---|
| 单元测试 | `tests/**/*.test.ts` | Vitest (forks pool) | 进程隔离，避免 SQLite 锁 |
| 前端测试 | `web/src/**/*.test.tsx` | Vitest + happy-dom | 组件级测试 |
| E2E 测试 | `e2e/**/*.spec.ts` | Playwright | 端到端用户流程 |

### 5.3 数据库测试隔离

- SQLite：每个 fork worker 使用独立目录 `.ouroboros/vitest-<pid>/`。
- PostgreSQL：使用事务回滚，测试结束后自动清理。
- 若遇到 `Database is already locked`：
  ```bash
  rm -rf .ouroboros/vitest-*
  npx vitest run
  ```

### 5.4 Mock 规范

- LLM 调用必须 mock（`tests/` 中使用 `vi.mock()` 或拦截层）。
- 文件系统操作优先使用内存 mock 或临时目录。
- 时间敏感测试使用 `vi.useFakeTimers()`。

---

## 6. 安全审核流程

### 6.1 触发条件

以下路径的修改 **必须** 经过安全审核（额外 +1 名安全模块维护者 approve）：

- `core/rule-engine.ts`
- `core/tool-framework.ts`
- `core/permission-gate.ts`
- `core/security-framework.ts`
- `core/safe-utils.ts`
- `skills/self-modify/**`
- `skills/skills-guard/**`
- `skills/constitution-guard/**`

### 6.2 审核 checklist

审核者需确认：

- [ ] **Fail-closed**：安全代码在异常时是否拒绝/阻断，而非放行？
- [ ] **路径遍历**：是否有新的文件系统操作？是否经过 `normalizePath` 和 `PathValidator`？
- [ ] **注入风险**：是否有用户输入直接进入 LLM prompt？是否经过 `prompt-defense.ts` 处理？
- [ ] **权限降级**：是否意外放宽了默认权限？
- [ ] **审计覆盖**：新操作是否记录到 `security_audit_log` 或 `api_audit_log`？
- [ ] **回滚能力**：修改是否破坏备份/快照机制？

### 6.3 安全修复流程

1. 使用 `security:` 类型的 commit
2. PR 标题前缀 `[SECURITY]`
3. 合并后由维护者评估是否需要发布安全公告（`SECURITY.md`）

---

## 7. 常见问题

| 问题 | 解决 |
|---|---|
| `Database is already locked` | 删除 `.ouroboros/session.lock` 和 `.ouroboros/vitest-*/session.lock` |
| `better-sqlite3` native crash | `npm rebuild better-sqlite3` |
| E2E 429 错误 | 确保 `webServer.command` 清理了 session.lock |
| Vitest 并行锁错误 | `rm -rf .ouroboros/vitest-*` 后重试 |
| `Concurrent initialization detected` | PG 模式下改用 `await getDbAsync()` |

---

## 相关文档

- [AGENTS.md](../AGENTS.md)
- [架构文档](./architecture.md)
- [API 文档](./api.md)
- [配置参考](./configuration.md)
