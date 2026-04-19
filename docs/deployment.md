# Ouroboros Agent — 部署指南

> 本文档涵盖 Docker 部署、Docker Compose 部署（推荐）、环境变量配置、监控告警和备份策略。

---

## 目录

- [1. Docker 部署](#1-docker-部署)
- [2. Docker Compose 部署（推荐）](#2-docker-compose-部署推荐)
- [3. 裸机 / VPS 部署](#3-裸机--vps-部署)
- [4. Kubernetes 部署](#4-kubernetes-部署)
- [5. 环境变量配置检查清单](#5-环境变量配置检查清单)
- [6. 监控和告警](#6-监控和告警)
- [7. 备份策略](#7-备份策略)
- [8. 升级流程](#8-升级流程)

---

## 1. Docker 部署

### 1.1 构建镜像

```bash
cd /path/to/ouroboros-agent
docker build -t ouroboros-agent:latest .
```

Dockerfile 说明：

- 基于 `node:20-slim`
- 安装 `python3 make g++` 用于编译 `better-sqlite3` 原生模块
- 创建非 root 用户 `ouroboros`
- 自动构建前端 `web/dist`
- 暴露 `8080`，内置健康检查

### 1.2 单机运行

```bash
docker run -d \
  --name ouroboros-agent \
  -p 8080:8080 \
  -v $(pwd)/.ouroboros:/app/.ouroboros \
  -v $(pwd)/skills:/app/skills \
  -v $(pwd)/.env:/app/.env:ro \
  --restart unless-stopped \
  ouroboros-agent:latest
```

### 1.3 健康检查

容器内置 `HEALTHCHECK`：

```bash
docker inspect --format='{{.State.Health.Status}}' ouroboros-agent
```

---

## 2. Docker Compose 部署（推荐）

生产环境推荐使用 `docker-compose.yml`，自带 PostgreSQL 和持久化卷。

### 2.1 启动

```bash
# 1. 准备环境变量
cp .env.example .env
# 编辑 .env，配置 DATABASE_URL、WEB_API_TOKEN、LLM_API_KEY 等

# 2. 启动
docker compose up -d

# 3. 查看日志
docker compose logs -f ouroboros

# 4. 验证健康
curl http://localhost:8080/health
```

### 2.2 服务构成

| 服务 | 镜像 | 说明 |
|---|---|---|
| `ouroboros` | 本地构建 | 主应用 |
| `postgres` | `postgres:16-alpine` | 数据库（推荐生产使用） |

### 2.3 网络与卷

- `pgdata`：PostgreSQL 数据持久化
- `.ouroboros`：SQLite（如未启用 PG）、备份、截图、上传文件
- `skills`：Skill 目录挂载，支持热更新

### 2.4 横向扩展

如需多实例，需启用：

- `USE_POSTGRES=1` + `DATABASE_URL`
- `REDIS_URL=redis://redis:6379/0`（用于分布式 WS 广播和限流）

然后使用 `docker compose up -d --scale ouroboros=3`，前置 Nginx 或 Traefik 负载均衡。

---

## 3. 裸机 / VPS 部署

### 3.1 前置依赖

```bash
# Ubuntu / Debian
sudo apt update
sudo apt install -y nodejs npm python3 make g++ git

# 确保 Node >= 20
node -v
```

### 3.2 部署步骤

```bash
git clone https://github.com/your-org/ouroboros-agent.git /opt/ouroboros-agent
cd /opt/ouroboros-agent

npm ci
cd web && npm ci && npm run build && cd ..

cp .env.example .env
# 编辑 .env

# 使用 PM2 或 systemd 托管
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 3.3 systemd 示例

```ini
# /etc/systemd/system/ouroboros.service
[Unit]
Description=Ouroboros Agent
After=network.target

[Service]
Type=simple
User=ouroboros
WorkingDirectory=/opt/ouroboros-agent
ExecStart=/usr/bin/npm run web:start
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ouroboros
```

---

## 4. Kubernetes 部署

项目自带 `k8s/` 和 `helm/` 目录：

```bash
# 原生 manifests
kubectl apply -f k8s/

# 或 Helm
helm install ouroboros ./helm \
  --set image.tag=latest \
  --set config.WEB_API_TOKEN=your-token \
  --set config.LLM_API_KEY=your-key
```

K8s 清单包含：

- Deployment + Service
- ConfigMap（非敏感配置）
- Secret（API 密钥、Token）
- PersistentVolumeClaim（数据和 Skill）
- HPA（水平自动扩缩容）

---

## 5. 环境变量配置检查清单

部署前逐项确认：

| 模块 | 必须配置 | 建议配置 |
|---|---|---|
| **安全** | `WEB_API_TOKEN`（生产至少 16 位） | `WEB_ALLOWED_ORIGINS` |
| **LLM** | `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY` | `FALLBACK_LLM_*` |
| **数据库** | `DATABASE_URL`（若 `USE_POSTGRES=1`） | `SLOW_QUERY_THRESHOLD_MS` |
| **日志** | — | `LOG_FORMAT=json` |
| **监控** | — | `SENTRY_DSN`, `OTEL_ENABLED=1` |
| **IM** | `FEISHU_APP_ID` / `SECRET`（若启用） | `FEISHU_VERIFICATION_TOKEN` |

完整变量列表见 [配置参考](./configuration.md)。

---

## 6. 监控和告警

### 6.1 健康探测

| 端点 | 用途 | K8s 探针 |
|---|---|---|
| `GET /health` | 基础健康 | livenessProbe |
| `GET /ready` | DB + 迁移 + LLM 就绪 | readinessProbe |
| `GET /metrics` | Prometheus 指标 | — |

### 6.2 Prometheus 指标

在 `prometheus.yml` 中添加：

```yaml
scrape_configs:
  - job_name: 'ouroboros'
    static_configs:
      - targets: ['ouroboros:8080']
    metrics_path: /metrics
```

关键指标：

| 指标 | 说明 | 告警阈值建议 |
|---|---|---|
| `http_requests_total` | HTTP 请求总量 | — |
| `http_request_duration_seconds` | 请求延迟分布 | P95 > 5s |
| `active_runners` | 活跃 Agent Runner | > 80% max |
| `ws_clients` | WebSocket 连接数 | 异常突增 |
| `llm_latency_ms` | LLM 平均延迟 | > 10s |
| `llm_calls_total` | LLM 调用次数 | — |
| `ouroboros_circuit_breaker_state` | 熔断器状态 | `state=1` (OPEN) |
| `db_connections_waiting` | 等待 DB 连接的客户端 | > 5 |

### 6.3 Grafana 仪表盘

导入 `deploy/grafana-dashboard.json`（如有）或自建面板，数据源选择 Prometheus。

### 6.4 日志聚合

设置 `LOG_FORMAT=json` 后，使用 Loki / ELK / Datadog 收集：

```json
{"level":"info","message":"HTTP request","requestId":"abc123","path":"/api/chat","status":200,"durationMs":1240}
```

### 6.5 告警规则示例（Prometheus Alertmanager）

```yaml
groups:
  - name: ouroboros
    rules:
      - alert: OuroborosHighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 5
        for: 2m
        annotations:
          summary: "Ouroboros P95 latency > 5s"
      - alert: OuroborosCircuitBreakerOpen
        expr: ouroboros_circuit_breaker_state == 1
        for: 1m
        annotations:
          summary: "LLM circuit breaker is OPEN"
```

---

## 7. 备份策略

### 7.1 自动备份

系统内置 `skills/backup/index.ts`，默认每日 03:00 执行：

- SQLite：复制 `.ouroboros/session.db` + WAL 到 `.ouroboros/backups/`。
- PostgreSQL：使用 `pg_dump` 导出 SQL。

### 7.2 备份保留

默认保留最近 7 份自动备份。手动备份不受限制。

### 7.3 手动备份

```bash
# SQLite
cp .ouroboros/session.db .ouroboros/backups/session-manual-$(date +%Y%m%d).db

# PostgreSQL
pg_dump $DATABASE_URL > ouroboros-backup-$(date +%Y%m%d).sql
```

### 7.4 灾难恢复

```bash
# SQLite 恢复
cp .ouroboros/backups/session-20250420.db .ouroboros/session.db

# PostgreSQL 恢复
psql $DATABASE_URL < ouroboros-backup-20250420.sql
```

### 7.5 Skill 版本快照

每次 `self_modify` 或 `write_skill` 会自动创建快照：

```
.ouroboros/skill-versions/<skillName>/<timestamp>/
```

可通过 API 或工具回滚：

- `list_skill_versions`
- `restore_skill_version`
- `prune_skill_versions`

---

## 8. 升级流程

### 8.1 Docker Compose 升级

```bash
cd /opt/ouroboros-agent
git pull
docker compose build
docker compose up -d
```

### 8.2 数据库迁移

Ouroboros 使用 [Umzug](https://github.com/sequelize/umzug) 自动迁移。启动时会自动应用新迁移，无需手动干预。

若迁移失败：

1. 查看日志定位失败迁移
2. 手动修复或回滚 `umzug_migrations` 表
3. 重启服务

### 8.3 回滚

```bash
# Docker Compose
docker compose down
git checkout <previous-tag>
docker compose up -d --build
```

---

## 相关文档

- [配置参考](./configuration.md)
- [PostgreSQL 迁移指南](./postgresql-migration.md)
- [架构文档](./architecture.md)
- [API 文档](./api.md)
