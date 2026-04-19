# ADR 004: 多智能体协调 —— 统一事件总线

| 属性 | 值 |
|---|---|
| **标题** | 多智能体协调 —— 统一事件总线 |
| **状态** | Accepted |
| **日期** | 2026-04-19 |
| **作者** | Ouroboros Maintainers |

---

## 上下文（Context）

Ouroboros Agent v0.9.0 的架构中，多个独立运行的 Agent 实例和后台进程需要协同工作：

- **主 Agent 循环**：处理用户请求，调用工具，生成响应
- **后台审查 Agent**：对主 Agent 的输出进行安全/质量审查
- **进化 Agent**：执行自修改管道（代码变更、测试、提交）
- **守护进程**：文件监控、定时任务、外部 API 轮询
- **Web 前端**：React 应用通过 WebSocket 与后端交互

早期采用直接函数调用（模块间 import 并调用），导致：
1. **紧耦合**：调用方必须知道被调用方的具体实现和文件位置。
2. **难以扩展**：新增 Agent 类型需要修改所有相关调用点。
3. **无可靠性保证**：进程崩溃时，未处理的消息永久丢失。
4. **跨进程通信困难**：同一台机器上的多个 Node.js 进程无法直接共享内存。

我们需要一个解耦的、可靠的、支持持久化的统一通信机制。

---

## 决策（Decision）

我们决定构建并采用 **`ProductionEventBus`** 作为所有跨模块通信的唯一通道：

```
┌─────────────┐     ┌──────────────────────┐     ┌─────────────┐
│  Main Agent │────▶│  ProductionEventBus  │◀────│ Review Agent│
└─────────────┘     │  (async queue + retry)│     └─────────────┘
┌─────────────┐     │                      │     ┌─────────────┐
│  Evolution  │────▶│  - SQLite persistence │◀────│   Daemon    │
└─────────────┘     │  - Dead-letter table  │     └─────────────┘
                    │  - Backoff & retry    │
                    └──────────────────────┘
                             │
                             ▼
                     ┌───────────────┐
                     │  HookRegistry │
                     │  (本地订阅分发) │
                     └───────────────┘
```

**核心设计**：

1. **统一接口**：所有模块通过 `eventBus.publish(event)` 和 `eventBus.subscribe(pattern, handler)` 交互，不直接 import 彼此。
2. **SQLite 持久化**：事件首先写入 `events` 表（事务保证），再由消费者异步拉取。
3. **重试与退避**：消费失败时按指数退避重试（最多 5 次），间隔 1s → 2s → 4s → 8s → 16s。
4. **死信队列（Dead Letter）**：超过最大重试次数后，事件转入 `dead_letters` 表，供人工排查。
5. **HookRegistry 封装**：`ProductionEventBus` 内部包装现有的 `HookRegistry`，保持同进程内的本地订阅高效分发（内存级），跨进程场景通过 SQLite 表协调。

**事件 Schema**：

```typescript
interface BusEvent {
  id: string;           // ULID
  type: string;         // 点分命名，如 "agent.mutation.requested"
  payload: unknown;
  source: string;       // 发布者标识
  timestamp: number;
  traceId: string;      // 分布式追踪 ID
}
```

---

## 权衡（Trade-offs）

### 事件总线的优势

- **松耦合**：发布者无需知晓订阅者存在，便于新增/移除 Agent 类型。
- **可靠性**：SQLite 持久化保证事件不丢失（at-least-once delivery）。
- **可观测性**：统一的 `events` 表天然支持审计、回放和调试。
- **水平扩展基础**：未来可将 SQLite 后端替换为 RabbitMQ / Redis，业务代码无需改动。

### 事件总线的劣势

- **延迟**：相比直接函数调用，增加了一次 SQLite 写入和轮询延迟（通常 < 10ms，但在高并发下可能累积）。
- **调试复杂度**：异步、分布式的事件流比同步调用栈更难追踪（需依赖 traceId）。

---

## 后果（Consequences）

### 积极后果

1. **模块边界清晰**：core、skills、web 三层之间所有通信必须通过总线，架构图与代码结构一致。
2. **Agent 可动态启停**：后台审查 Agent 可随时启动或关闭，不影响主 Agent 运行。
3. **事件回放能力**：基于 `events` 表，可重放特定时间段的事件用于调试或测试。
4. **死信可审计**：失败事件不会静默消失，运维人员可定期审查 `dead_letters` 表发现系统性问题。

### 消极后果与缓解措施

| 风险 | 缓解措施 |
|---|---|
| 事件总线延迟影响实时交互 | 同进程内优先走 `HookRegistry` 内存通道（< 1ms）；跨进程走 SQLite；WebSocket 连接保持长连接，不受事件持久化阻塞 |
| `events` 表无限增长 | 自动归档策略：7 天前已消费事件移至 `events_archive`；90 天前的归档数据可压缩导出 |
| `dead_letters` 表膨胀 | 提供 CLI 命令 `npx ouroboros dead-letters prune --before 30d`；Dashboard 可视化死信趋势 |
| 循环消息（A→B→A） | 每个事件携带 `hopCount`（最大 10），超限自动转入死信；推荐业务层使用状态机避免循环 |

### 中立后果

- 所有 skill 开发者需要学习事件驱动编程模式（发布/订阅、幂等消费）。
- 测试需要引入 `TestEventBus`（内存实现）替代 `ProductionEventBus`，避免测试污染数据库。

---

## 替代方案（Alternatives Considered）

### 替代 A：直接函数调用 + DI 容器

- **拒绝原因**：无法解决跨进程通信问题；模块间仍然通过接口耦合；缺乏持久化和重试机制。

### 替代 B：Redis Pub/Sub

- **拒绝原因**：增加外部依赖，与项目"默认零配置"的哲学冲突；Redis 的 at-most-once delivery 不满足可靠性要求（需要额外实现 Stream 或消费者组）。

### 替代 C：Node.js `EventEmitter`

- **拒绝原因**：纯内存实现，进程崩溃即丢消息；无持久化、无重试、无死信，无法满足生产级可靠性需求。可作为同进程内的性能补充，但不能作为统一总线。

---

## 相关文档

- [事件总线使用指南](../event-bus.md)
- [HookRegistry 架构](../hook-registry.md)
- `core/event-bus.ts`
- `core/production-event-bus.ts`
- `core/hook-registry.ts`
- `core/db/schema/events.sql`

---

## 修订历史

| 日期 | 修订人 | 说明 |
|---|---|---|
| 2026-04-19 | Maintainers | 初始版本，Accepted |
