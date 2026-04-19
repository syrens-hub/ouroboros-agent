# ADR 001: SQLite 作为默认数据库，PostgreSQL 作为生产级扩展

| 属性 | 值 |
|---|---|
| **标题** | SQLite 作为默认数据库，PostgreSQL 作为生产级扩展 |
| **状态** | Accepted |
| **日期** | 2024-04-15 |
| **作者** | Ouroboros Maintainers |

---

## 上下文（Context）

Ouroboros Agent 需要持久化存储以下数据：

- 会话与消息历史（`sessions`, `messages`）
- 执行轨迹（`trajectories`）
- 记忆层与向量嵌入（`memory_layers`, `kb_chunks`, `vector_embeddings`）
- 进化版本与执行记录（`evolution_versions`, `evolution_executions`）
- 审计日志与死信队列（`api_audit_log`, `dead_letters`）

在项目早期，我们面临一个架构抉择：**默认使用哪种数据库？**

候选方案：

1. **SQLite 作为唯一后端** —— 简单、零配置、单文件。
2. **PostgreSQL 作为唯一后端** —— 企业级、支持并发、水平扩展。
3. **SQLite 作为默认，PostgreSQL 作为可切换扩展** —— 兼顾开发体验和生产能力。

---

## 决策（Decision）

我们决定采用 **方案 3**：

- **默认后端为 SQLite**（`better-sqlite3` + WAL 模式）。
- **通过环境变量 `USE_POSTGRES=1` 无缝切换到 PostgreSQL**，无需修改业务逻辑。
- 抽象 `DbAdapter` 接口（`core/db-adapter.ts`），所有业务代码面向接口编程。

---

## 权衡（Trade-offs）

### SQLite 的优势

- **零配置**：新用户 `npm install && npm run dev` 即可运行，无需安装 PostgreSQL。
- **单文件**：备份、复制、排查极为简单（一个 `.db` 文件）。
- **性能足够**：单机场景下，SQLite WAL 模式的读取性能极佳，完全满足个人 Agent 的并发需求。
- **测试友好**：每个 Vitest fork worker 可使用独立数据库文件，天然隔离。

### SQLite 的劣势

- **写并发受限**：文件级锁，不适合多实例同时写入。
- **无法水平扩展**：无法在多节点间共享单个 SQLite 文件。
- **缺乏高级运维工具**：缺少 pg_dump、行级统计、复杂权限管理等。

### PostgreSQL 的优势

- **行级 MVCC**：彻底解决并行测试锁问题，支持高并发。
- **多实例共享**：K8s / Docker Compose 多副本部署的基础。
- **外部工具生态**：pg_dump、BI 工具、连接池监控等。
- **连接池**：`PgDbAdapter` 内部管理 `max: 20` 的连接池。

### PostgreSQL 的劣势

- **部署成本**：需要独立服务、用户权限、网络配置。
- **开发环境复杂化**：新用户需要额外安装和配置。

---

## 后果（Consequences）

### 积极后果

1. **开发体验优先**：新贡献者可以在 5 分钟内跑起完整系统。
2. **渐进式扩展**：用户从单机原型到生产集群无需重写代码，仅需切换环境变量。
3. **统一接口**：`DbAdapter` 屏蔽了底层差异，占位符（`?` vs `$1`）自动转换。
4. **测试策略清晰**：SQLite 用于快速单元测试，PostgreSQL 用于集成测试和 CI。

### 消极后果与缓解措施

| 风险 | 缓解措施 |
|---|---|
| SQLite 与 PostgreSQL 的语法差异 | `DbAdapter` 自动转换占位符；避免使用数据库特有函数 |
| 迁移状态不一致 | Umzug 迁移在两种后端上保持一致；`umzug_migrations` 表统一管理 |
| 性能特征不同 | 基准测试覆盖两种后端；慢查询日志（`SLOW_QUERY_THRESHOLD_MS`）辅助优化 |
| 数据迁移无自动工具 | 文档提供手动迁移脚本模板；社区可贡献 `sqlite-to-pg` CLI |

---

## 替代方案（Alternatives Considered）

### 替代 A：PostgreSQL 作为唯一后端

- **拒绝原因**：提高了贡献门槛，与项目 "5 分钟上手" 的目标冲突。早期用户反馈表明，强制 PostgreSQL 导致 Windows/WSL 环境下的安装失败率显著上升。

### 替代 B：嵌入式 LevelDB / LMDB

- **拒绝原因**：缺乏成熟的 Node.js 驱动和 SQL 抽象，需要重写所有查询逻辑。向量搜索和复杂 JOIN 难以高效实现。

### 替代 C：ORM（Prisma / TypeORM）

- **拒绝原因**：ORM 增加了抽象层和构建时依赖，与项目 "轻量、可控" 的哲学不符。同时，ORM 的迁移系统与 Umzug 重复。

---

## 相关文档

- [PostgreSQL 迁移指南](../postgresql-migration.md)
- [配置参考](../configuration.md)
- `core/db-adapter.ts`
- `core/db-manager.ts`
- `core/db-pg.ts`
- `core/migrations/index.ts`

---

## 修订历史

| 日期 | 修订人 | 说明 |
|---|---|---|
| 2024-04-15 | Maintainers | 初始版本，Accepted |
