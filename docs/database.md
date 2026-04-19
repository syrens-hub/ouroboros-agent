# Database Configuration

Ouroboros Agent supports two database backends:

- **SQLite** (`better-sqlite3`) — default, zero-config, single-file
- **PostgreSQL** (`pg`) — recommended for production deployments

---

## Quick Start

### SQLite (Default / Development)

No extra dependencies required. Data is stored in a local file:

```bash
# Default path: .ouroboros/session.db
# Or specify a custom path:
DATABASE_PATH=./data/ouroboros.db
```

### PostgreSQL (Production Recommended)

```bash
npm install pg
```

```bash
USE_POSTGRES=1
DATABASE_URL=postgresql://user:password@localhost:5432/ouroboros
POSTGRES_POOL_SIZE=20
```

---

## Configuration Options

| Environment Variable | Default | Description |
|----------------------|---------|-------------|
| `DATABASE_BACKEND` | `sqlite` | Backend selection: `sqlite` or `postgres`. Takes precedence over `USE_POSTGRES`. |
| `USE_POSTGRES` | (unset) | Legacy flag. Set to `1` to enable PostgreSQL. |
| `DATABASE_URL` | (unset) | PostgreSQL connection string. **Required** when backend is `postgres`. |
| `POSTGRES_POOL_SIZE` | `10` | PostgreSQL connection pool size. |
| `POSTGRES_SSL` | `false` | Enable SSL for PostgreSQL connections. Set to `1` or `true` to enable. |
| `DATABASE_PATH` | `<OUROBOROS_DB_DIR>/session.db` | SQLite database file path. |
| `SQLITE_WAL` | `true` | Enable SQLite WAL (Write-Ahead Logging) mode. |
| `OUROBOROS_DB_DIR` | `.ouroboros` | Legacy directory for SQLite database and WAL files. Used as fallback when `DATABASE_PATH` is not set. |
| `SLOW_QUERY_THRESHOLD_MS` | `0` | Slow query warning threshold in milliseconds (`0` = disabled). |

> **Backward Compatibility**: `USE_POSTGRES=1` and `OUROBOROS_DB_DIR` continue to work exactly as before. The new `database` config object is the canonical source, while the legacy `db.*` properties remain as aliases.

---

## SQLite vs PostgreSQL

| Capability | SQLite | PostgreSQL | Recommendation |
|------------|--------|------------|----------------|
| **Setup complexity** | Zero (embedded) | Requires server | SQLite for dev, PG for prod |
| **Concurrent writers** | File-level lock | Row-level MVCC | PG for >100 req/s |
| **Horizontal scaling** | Single instance only | Multi-instance | PG for HA / replicas |
| **Connection pool** | Single file, single process | Configurable pool | PG for connection reuse |
| **Backup / restore** | File copy | `pg_dump`, WAL archiving | PG for enterprise needs |
| **BI / analytics** | Limited | Full SQL, window functions | PG for external tools |
| **Migration system** | Sync (`better-sqlite3`) | Async (`pg` + Umzug) | Both auto-run on startup |
| **Placeholder syntax** | `?` | `$1, $2...` | Abstracted by `DbAdapter` |
| **Docker Compose** | Built-in | Built-in | PG service included |

---

## Docker Compose Deployment

The included `docker-compose.yml` is pre-configured for PostgreSQL as the production backend:

```yaml
services:
  ouroboros:
    build: .
    environment:
      - NODE_ENV=production
      - USE_POSTGRES=1
      - DATABASE_URL=postgresql://ouroboros:ouroboros@postgres:5432/ouroboros
      - POSTGRES_POOL_SIZE=20
    depends_on:
      - postgres

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ouroboros
      POSTGRES_PASSWORD: ouroboros
      POSTGRES_DB: ouroboros
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ouroboros -d ouroboros"]
      interval: 10s
      timeout: 5s
      retries: 5
```

Start the stack:

```bash
docker compose up -d
```

Data is persisted in the named volume `postgres_data`.

---

## Migration Notes

### SQLite → PostgreSQL

Ouroboros does **not** provide automatic data migration between backends. To migrate manually:

1. **Export from SQLite**:
   ```bash
   sqlite3 .ouroboros/session.db ".mode json" "SELECT * FROM sessions" > sessions.json
   ```

2. **Set up PostgreSQL** and start Ouroboros so schema migrations run automatically.

3. **Import data** using a one-time script via `pg` or `psql`.

> **Tip**: `sessions` and `messages` are usually critical to migrate. Runtime metrics and caches can be discarded and rebuilt.

### PostgreSQL → SQLite

1. Remove `USE_POSTGRES` (or set `DATABASE_BACKEND=sqlite`).
2. Restart Ouroboros.
3. Note: PostgreSQL data does **not** sync back to SQLite automatically.

---

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `USE_POSTGRES is enabled but DATABASE_URL is not set` | Missing connection string | Set `DATABASE_URL` |
| `PostgreSQL driver is not installed` | `pg` package missing | Run `npm install pg` |
| `Concurrent initialization detected in getDb()` | Sync code calls `getDb()` during async PG init | Use `await getDbAsync()` |
| `Database is already locked` | Stale `session.lock` file | Delete `.ouroboros/session.lock` (and `.ouroboros/vitest-*/session.lock` if in tests) |
| Migration fails / "table already exists" | Interrupted migration left dirty state | Manually drop/recreate `umzug_migrations` table and restart |

---

## Programmatic Access

Both backends implement the same `DbAdapter` interface:

```ts
import { getDb, getDbAsync } from "./core/db-manager.ts";

// SQLite: synchronous, returns immediately
// PostgreSQL: must await schema init
const db = await getDbAsync();

const row = await db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
```

The adapter automatically converts `?` placeholders to PostgreSQL `$1, $2...` syntax when using the PostgreSQL backend.
