# Ouroboros Agent 生产部署指南

本文档描述如何将 Ouroboros Agent 部署到 Kubernetes 环境（含 Helm  chart 示例），并覆盖 SQLite 单机模式与 PostgreSQL 高可用模式的配置要点。

---

## 1. 快速开始（Helm）

### 1.1 构建镜像

```bash
docker build -t ouroboros-agent:latest .
```

> 若使用私有镜像仓库，请推送到可访问的 registry，并在 `values.yaml` 中修改 `image.repository` 与 `image.tag`。

### 1.2 安装 Helm Chart

```bash
helm upgrade --install ouroboros-agent ./deploy/helm/ouroboros-agent \
  --namespace ouroboros \
  --create-namespace \
  --set secrets.llmApiKey="$LLM_API_KEY" \
  --set secrets.webApiToken="$WEB_API_TOKEN"
```

---

## 2. 部署模式选择

### 2.1 SQLite 单机模式（默认）

适用于测试环境或低并发场景。

- `replicaCount: 1`（**严禁多副本共享同一个 SQLite 文件**）
- `persistence.enabled: true`，为 `.ouroboros` 目录挂载 PVC
- 无需设置 `DATABASE_URL`

```yaml
config:
  db:
    usePostgres: false
    dir: "/app/.ouroboros"

persistence:
  enabled: true
  size: 10Gi
```

### 2.2 PostgreSQL 高可用模式

适用于生产环境或需要水平扩展的场景。

- `config.db.usePostgres: true`
- 提供 `DATABASE_URL`（PostgreSQL 连接字符串）
- 可以设置 `replicaCount > 1`
- 建议保留 `persistence.enabled: true` 用于文件上传与自动备份

```yaml
replicaCount: 2

config:
  db:
    usePostgres: true

secrets:
  databaseUrl: "postgres://user:pass@pg-host:5432/ouroboros"
```

> **数据库迁移**：Ouroboros Agent 内置 `umzug` 迁移框架，首次启动时会自动执行 schema 迁移。请确保数据库用户具备 `CREATE TABLE` 与 `ALTER TABLE` 权限。

---

## 3. 健康探针与优雅关闭

部署清单已配置以下探针：

| 探针 | 路径 | 用途 |
|------|------|------|
| Liveness | `/health` | 进程存活检查 |
| Readiness | `/ready` | 包含数据库真实查询与迁移状态校验，用于流量准入 |

Pod 接收到 `SIGTERM` 后，应用会执行 `gracefulShutdown`：
- 停止接收新 HTTP / WebSocket 连接
- 等待现有 Agent Loop 运行结束（最长 10 秒）
- 关闭数据库连接池
- 退出进程

---

## 4. 配置参考

### 4.1 环境变量对照表

| Helm values 路径 | 环境变量 | 说明 |
|------------------|----------|------|
| `config.llm.provider` | `LLM_PROVIDER` | `openai` / `anthropic` / `qwen` / `gemini` / `minimax` / `local` |
| `config.llm.model` | `LLM_MODEL` | 模型名称，如 `gpt-4o` |
| `secrets.llmApiKey` | `LLM_API_KEY` | LLM API 密钥（Secret） |
| `config.web.port` | `OUROBOROS_WEB_PORT` | 服务端口，默认 `8080` |
| `secrets.webApiToken` | `WEB_API_TOKEN` | Web API 鉴权 Token（Secret） |
| `config.web.allowedOrigins` | `WEB_ALLOWED_ORIGINS` | CORS 白名单，逗号分隔 |
| `config.db.usePostgres` | `USE_POSTGRES` | `true` / `false` |
| `secrets.databaseUrl` | `DATABASE_URL` | PostgreSQL 连接字符串（Secret） |
| `config.redis.url` | `REDIS_URL` | 可选，用于分布式任务队列 |
| `config.sentry.dsn` | `SENTRY_DSN` | 可选，错误监控 |

### 4.2 使用已有的 Secret

若已在集群中创建好 Secret，可通过 `secrets.existingSecret` 引用：

```yaml
secrets:
  existingSecret: "my-ouroboros-secrets"
```

请确保该 Secret 包含以下 key：
- `LLM_API_KEY`
- `FALLBACK_LLM_API_KEY`（可选）
- `WEB_API_TOKEN`
- `DATABASE_URL`（PostgreSQL 模式下必填）

---

## 5. Ingress 示例

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
  hosts:
    - host: agent.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: ouroboros-agent-tls
      hosts:
        - agent.example.com
```

---

## 6. 水平自动扩缩容 (HPA)

> **注意**：HPA 仅在 PostgreSQL 模式下可安全开启。SQLite 模式多副本会导致数据库锁冲突。

在 `values.yaml` 中启用：

```yaml
config:
  db:
    usePostgres: true

replicaCount: 2

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70
  targetMemoryUtilizationPercentage: 80
```

安装后可通过以下命令观察扩缩容状态：

```bash
kubectl get hpa -n ouroboros
```

---

## 7. 监控与告警

### 7.1 日志与 Metrics

- **日志格式**：生产环境建议设置 `config.log.format: json`，便于 Loki / ELK 收集。
- **Metrics**：访问 `/metrics` 可获取 Prometheus 格式的 HTTP 请求延迟、状态码统计、任务队列深度与熔断器状态。
- **Sentry**：配置 `SENTRY_DSN` 即可自动上报未捕获异常。

### 7.2 Prometheus 告警规则示例

```yaml
groups:
  - name: ouroboros-agent
    rules:
      - alert: OuroborosTaskQueueBacklog
        expr: ouroboros_task_queue_pending > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Ouroboros task queue backlog high"

      - alert: OuroborosTaskQueueFailed
        expr: ouroboros_task_queue_failed > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Ouroboros task queue has failed tasks"

      - alert: OuroborosCircuitBreakerOpen
        expr: ouroboros_circuit_breaker_state == 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "LLM circuit breaker is OPEN for {{ $labels.provider }}"

      - alert: OuroborosHighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Ouroboros P95 latency > 5s"
```

### 7.3 PodDisruptionBudget（可选）

在 PostgreSQL 高可用模式下，建议配置 PDB 以保证滚动更新或节点驱逐时最少可用副本：

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ouroboros-agent-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ouroboros-agent
```

---

## 8. 常见问题

**Q: 为什么 SQLite 模式不能设置 `replicaCount > 1`？**
A: better-sqlite3 不支持多进程并发写入同一个数据库文件。若需多副本，请切换至 PostgreSQL 模式。

**Q: 如何升级数据库 schema？**
A: 应用启动时会自动执行 `umzug` 迁移。升级镜像后滚动重启即可，无需手动操作。

**Q: 备份策略如何配置？**
A: SQLite 模式下，建议对 PVC 做快照备份，或利用应用内置的 `maybeAutoBackup` 功能（在 `config.db.dir/backups` 中生成 `.db` 备份）。PostgreSQL 模式下请使用数据库原生备份方案（如 `pg_dump` / WAL archiving）。
