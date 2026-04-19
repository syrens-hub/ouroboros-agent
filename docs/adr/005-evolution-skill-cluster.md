# ADR 005: Evolution Skill 集群 —— 域内紧耦合

| 属性 | 值 |
|---|---|
| **标题** | Evolution Skill 集群 —— 域内紧耦合 |
| **状态** | Accepted |
| **日期** | 2026-04-19 |
| **作者** | Ouroboros Maintainers |

---

## 上下文（Context）

Ouroboros 的**进化子系统（evolution subsystem）**是实现自修改能力的核心管道，由约 10 个 skill 组成：

- `mutate-code.ts`：执行代码变更
- `run-tests.ts`：触发测试运行
- `git-commit.ts`：执行 git 提交
- `dependency-analyzer.ts`：分析变更影响范围
- `rollback.ts`：失败时回滚变更
- `audit-logger.ts`：记录进化操作审计日志
- `constitution-checker.ts`：宪法守卫校验
- `syntax-validator.ts`：TypeScript 语法验证
- `canary-runner.ts`：金丝雀测试执行
- `evolution-orchestrator.ts`：协调整个进化流程

这些 skill 之间存在 **68 个跨 skill import**，构成了高度互联的调用网络。例如：

- `evolution-orchestrator` 直接 import 并调用 `mutate-code`、`syntax-validator`、`canary-runner`
- `mutate-code` 直接 import `constitution-checker` 和 `rollback`
- `canary-runner` 直接 import `dependency-analyzer` 以确定测试范围

早期曾尝试强制所有 skill 之间通过事件总线通信，但这导致：
1. **过度解耦的代价**：同一事务内的操作被拆分为多个异步事件，代码难以阅读。
2. **类型安全丧失**：事件总线的 `payload: unknown` 无法表达复杂的内部数据结构。
3. **调试困难**：单步追踪一个进化流程需要跨越多个事件，断点失效。

---

## 决策（Decision）

我们决定**允许 evolution skill 集群内部保持紧耦合**，同时严格限制跨域依赖：

### 域内规则（Intra-domain）

- Evolution skill 之间**允许直接 import 和同步调用**。
- 共享类型集中存放在 `types/evolution.ts`，被集群内所有 skill 引用。
- 共享工具函数存放在 `skills/evolution/lib/` 子目录。
- 集群被视为**单一内聚子系统**，而非 10 个独立 skill。

### 域间规则（Cross-domain）

- **禁止 evolution skill 直接 import 非 evolution skill**（例如不能直接从 `skills/network/` import）。
- **禁止非 evolution skill 直接 import evolution skill**。
- 跨域通信**必须通过事件总线**（`ProductionEventBus`）或 `HookRegistry` 间接交互。

**代码结构**：

```
skills/
  evolution/
    mutate-code.ts
    run-tests.ts
    ...
    lib/              # 集群内共享工具
    types/evolution.ts # 集群内共享类型
  network/
    fetch-tool.ts     # 若需触发进化，必须发事件，不能直接 import mutate-code
```

**静态检查**：

- ESLint 规则 `no-cross-domain-imports` 自动检测违规 import。
- CI 中运行 `npx ouroboros verify-architecture` 确保无新增跨域耦合。

---

## 权衡（Trade-offs）

### 域内紧耦合的优势

- **开发效率高**：同一功能域内的开发者可以同步调用、共享类型，无需定义冗余的事件 schema。
- **类型安全**：`types/evolution.ts` 提供精确的类型约束，编译期即可发现错误。
- **可追踪性**：单步调试一个进化流程时，调用栈保持在同一代码域内，直观易懂。
- **事务性**：进化流程的多个步骤（变更 → 验证 → 测试 → 提交）本质上是原子业务单元，同步调用更符合语义。

### 域内紧耦合的劣势

- **隔离性降低**：单个 skill 无法独立测试，必须 mock 整个集群的依赖。
- **重构成本**：集群内部接口变更可能产生连锁反应，影响多个文件。

---

## 后果（Consequences）

### 积极后果

1. **进化管道开发提速**：自修改流程涉及多步紧密协作，允许直接调用显著降低了实现复杂度。
2. **类型安全增强**：共享类型文件消除了事件序列化/反序列化中的 `as` 类型断言。
3. **架构边界清晰**：域间隔离规则确保了进化子系统的内部复杂性不会泄漏到系统其他部分。
4. **测试策略明确**：域内使用集成测试（测试整个进化流程）；域间使用事件总线的 mock 测试。

### 消极后果与缓解措施

| 风险 | 缓解措施 |
|---|---|
| 单个 skill 难以单元测试 | 提供 `skills/evolution/__mocks__/` 统一 mock 套件；鼓励对 `lib/` 中的纯函数进行单元测试 |
| 集群内部循环依赖 | 定期运行 `madge --circular skills/evolution/` 检测循环 import；重构时优先提取公共模块到 `lib/` |
| 集群规模膨胀（未来 > 20 个 skill） | 设定阈值：若集群 skill 数量超过 15 或跨 skill import 超过 100，触发架构评审，考虑拆分为子域 |
| 新开发者误将跨域 import 当作域内 import | ESLint 规则在 IDE 中实时报错；代码审查清单包含架构边界检查项 |

### 中立后果

- 需要在 `types/evolution.ts` 中维护较庞大的共享类型定义。
- 未来若将进化子系统提取为独立 npm 包或微服务，域内紧耦合将简化提取过程（已具备内聚边界）。
- 若集群继续增长，可能需要**内部事件总线**（子域级 bus）作为同步调用的补充。

---

## 替代方案（Alternatives Considered）

### 替代 A：强制所有 skill 完全解耦（统一事件总线）

- **拒绝原因**：进化流程的 10 个步骤本质上是同步事务，强制事件化导致代码碎片化、类型安全丧失、调试困难。已在早期原型中验证此方案不可行。

### 替代 B：将 evolution 合并为单个巨型 skill

- **拒绝原因**：丧失模块化带来的可维护性；`mutate-code` 与 `git-commit` 有独立的测试和发布节奏；单文件过大违背项目代码规范。

### 替代 C：提取为独立 monorepo package

- **拒绝原因**：当前阶段过度工程化；v0.9.0 仍需快速迭代，独立包增加发布和版本对齐成本。保留为 future work（v1.0 后评估）。

---

## 相关文档

- [Evolution 子系统架构](../evolution-subsystem.md)
- [Skill 架构规范](../skill-architecture.md)
- `skills/evolution/README.md`
- `types/evolution.ts`
- `scripts/verify-architecture.ts`
- `.eslintrc.cjs`（`no-cross-domain-imports` 规则配置）

---

## 修订历史

| 日期 | 修订人 | 说明 |
|---|---|---|
| 2026-04-19 | Maintainers | 初始版本，Accepted |
