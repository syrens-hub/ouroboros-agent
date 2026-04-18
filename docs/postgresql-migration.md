# PostgreSQL 迁移指南

Ouroboros Agent 默认使用 **SQLite**（`better-sqlite3` + WAL 模式），适合单机部署和开发。当需要以下能力时，建议迁移到 **PostgreSQL**：

- 多实例并发访问（水平扩展）
- 高并发写入（>100 req/s）
- 外部 BI / 数据分析工具对接
- 企业级备份与容灾

---

## 1. 安装依赖

```bash
npm install pg
npm install -D @types/pg
```

`pg` 是可选依赖，未安装时系统自动回退到 SQLite。

---

## 2. 环境变量配置

在 `.env` 中添加：

```bash
# 启用 PostgreSQL 后端
USE_POSTGRES=1

# PostgreSQL 连接字符串（必须包含数据库名）
DATABASE_URL=postgresql://ouroboros:your_password@localhost:5432/ouroboros

# （可选）慢查询阈值（毫秒）
SLOW_QUERY_THRESHOLD_MS=100
```

> **注意**：`USE_POSTGRES=1` 后，系统**不再使用 SQLite**，`.ouroboros/session.db` 中的历史数据不会自动迁移。

---

## 3. 创建数据库与用户

```sql
CREATE USER ouroboros WITH PASSWORD 'your_password';
CREATE DATABASE ouroboros OWNER ouroboros;
GRANT ALL PRIVILEGES ON DATABASE ouroboros TO ouroboros;
```

Ouroboros 启动时会自动运行 [Umzug](https://github.com/sequelize/umzug) 迁移，创建所有表和索引。**无需手动导入 schema**。

---

## 4. SQLite → PostgreSQL 数据迁移

目前系统**不提供自动迁移工具**。如需保留历史数据，建议：

1. 使用 `sqlite3` 导出 JSON/CSV：
   ```bash
   sqlite3 .ouroboros/session.db ".mode json" "SELECT * FROM sessions" > sessions.json
   ```
2. 编写一次性脚本通过 `pg` 客户端导入 PostgreSQL。
3. 优先迁移关键表：`sessions`, `messages`, `trajectories`, `memory_layers`。

> **会话数据（sessions / messages）** 通常是必须迁移的；**运行时指标（metrics）** 和 **缓存（cache）** 可以丢弃后重建。

---

## 5. 已知限制

| 功能 | SQLite | PostgreSQL | 说明 |
|------|--------|------------|------|
| 初始化方式 | 同步 | 异步 | PostgreSQL 路径下需使用 `getDbAsync()` 等待迁移完成 |
| `db.pragma()` | 支持 WAL/同步模式 | 空操作（返回 `"ok"`） | 仅 SQLite 调优参数 |
| 连接池 | 单文件单进程 | `max: 20` 连接池 | 由 `PgDbAdapter` 内部管理 |
| 占位符 | `?` | `$1, $2...` | 自动转换，调用方无需修改 |
| 锁竞争 | 文件级（fork 测试受限） | 行级MVCC | 彻底解决并行测试锁问题 |

---

## 6. 回滚到 SQLite

1. 移除 `USE_POSTGRES` 环境变量（或设为 `0`）。
2. 系统会自动回到 `.ouroboros/session.db`。
3. 注意：PostgreSQL 中新增的数据**不会自动同步回 SQLite**。

---

## 7. 故障排查

| 错误 | 原因 | 解决 |
|------|------|------|
| `USE_POSTGRES is enabled but DATABASE_URL is not set` | 缺少连接字符串 | 配置 `DATABASE_URL` |
| `PostgreSQL driver is not installed` | 未安装 `pg` | 执行 `npm install pg` |
| `Concurrent initialization detected in getDb()` | 同步代码在 PG 初始化期间调用 `getDb()` | 改用 `await getDbAsync()` |
| 迁移失败 / 表已存在 | 之前中断的迁移留下脏状态 | 手动清理 `umzug_migrations` 表后重启 |

---

## 8. Docker Compose 示例

```yaml
services:
  ouroboros:
    build: .
    environment:
      USE_POSTGRES: "1"
      DATABASE_URL: postgresql://ouroboros:secret@db:5432/ouroboros
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ouroboros
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: ouroboros
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```
