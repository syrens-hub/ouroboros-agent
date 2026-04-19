# Ouroboros Agent — 完整配置参考

> 所有配置通过环境变量注入。生产环境强烈建议使用 `.env` 文件或 secrets 管理系统，**不要将密钥提交到 Git**。

---

## 目录

- [1. 安全与演示模式](#1-安全与演示模式)
- [2. LLM（主模型）](#2-llm主模型)
- [3. LLM Fallback](#3-llm-fallback)
- [4. 辅助 LLM](#4-辅助-llm)
- [5. Web 服务器](#5-web-服务器)
- [6. 数据库](#6-数据库)
- [7. Redis](#7-redis)
- [8. Feishu / Lark](#8-feishu--lark)
- [9. 日志](#9-日志)
- [10. Sentry](#10-sentry)
- [11. OpenTelemetry](#11-opentelemetry)
- [12. MCP](#12-mcp)
- [13. 其他](#13-其他)
- [14. 生产环境配置模板](#14-生产环境配置模板)

---

## 1. 安全与演示模式

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OUROBOROS_DEMO_MODE` | *(空)* | 设为 `1` 开启自我修改演示模式（低/中风险可终端确认） |

---

## 2. LLM（主模型）

| 变量 | 默认值 | 推荐值 | 说明 |
|---|---|---|---|
| `LLM_PROVIDER` | `local` | `openai` / `anthropic` / `gemini` | 主模型提供商 |
| `LLM_MODEL` | `mock` | `gpt-4o-mini` / `claude-3-5-sonnet` | 模型名称 |
| `LLM_API_KEY` | *(空)* | *(你的密钥)* | API 密钥（非 `local` 时必填） |
| `LLM_BASE_URL` | *(空)* | `http://localhost:11434/v1` | 自定义 base URL（本地模型/代理） |
| `LLM_TEMPERATURE` | `0.2` | `0.1` ~ `0.5` | 采样温度 |
| `LLM_MAX_TOKENS` | `4096` | `4096` ~ `8192` | 最大生成 token 数 |

---

## 3. LLM Fallback

当主模型失败时， resilience 层自动切换到 fallback。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `FALLBACK_LLM_PROVIDER` | *(空)* | fallback 提供商 |
| `FALLBACK_LLM_MODEL` | *(空)* | fallback 模型 |
| `FALLBACK_LLM_API_KEY` | *(空)* | fallback 密钥 |
| `FALLBACK_LLM_BASE_URL` | *(空)* | fallback base URL |
| `FALLBACK_LLM_TEMPERATURE` | *(空)* | fallback 温度 |
| `FALLBACK_LLM_MAX_TOKENS` | *(空)* | fallback 最大 token |

---

## 4. 辅助 LLM

系统支持为不同子任务配置独立的 LLM，避免主模型被慢任务阻塞。

| 变量 | 用途 |
|---|---|
| `AUXILIARY_COMPRESSION_PROVIDER` | 上下文压缩 |
| `AUXILIARY_COMPRESSION_MODEL` | 上下文压缩 |
| `AUXILIARY_COMPRESSION_API_KEY` | 上下文压缩 |
| `AUXILIARY_COMPRESSION_BASE_URL` | 上下文压缩 |
| `AUXILIARY_REVIEW_PROVIDER` | 后台审查（Hermes） |
| `AUXILIARY_REVIEW_MODEL` | 后台审查 |
| `AUXILIARY_REVIEW_API_KEY` | 后台审查 |
| `AUXILIARY_REVIEW_BASE_URL` | 后台审查 |
| `AUXILIARY_VISION_PROVIDER` | 视觉模型（computer_use） |
| `AUXILIARY_VISION_MODEL` | 视觉模型 |
| `AUXILIARY_VISION_API_KEY` | 视觉模型 |
| `AUXILIARY_VISION_BASE_URL` | 视觉模型 |
| `AUXILIARY_SUMMARIZATION_PROVIDER` | 记忆总结 |
| `AUXILIARY_SUMMARIZATION_MODEL` | 记忆总结 |
| `AUXILIARY_SUMMARIZATION_API_KEY` | 记忆总结 |
| `AUXILIARY_SUMMARIZATION_BASE_URL` | 记忆总结 |

> 若未配置，辅助任务会回退到主 LLM。

---

## 5. Web 服务器

| 变量 | 默认值 | 推荐值 | 说明 |
|---|---|---|---|
| `OUROBOROS_WEB_PORT` | `8080` | `8080` / `3000` | HTTP 服务端口 |
| `WEB_API_TOKEN` | *(空)* | 32+ 字节随机 hex | API 认证令牌（生产必填） |
| `WEB_ALLOWED_ORIGINS` | *(空)* | `https://mydomain.com` | CORS 白名单，逗号分隔 |

生产环境生成强 token：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 6. 数据库

| 变量 | 默认值 | 推荐值 | 说明 |
|---|---|---|---|
| `OUROBOROS_DB_DIR` | `.ouroboros` | `.ouroboros` | SQLite 数据目录 |
| `USE_POSTGRES` | *(空)* | `1`（生产） | 启用 PostgreSQL |
| `DATABASE_URL` | *(空)* | `postgresql://...` | PostgreSQL 连接字符串 |
| `SLOW_QUERY_THRESHOLD_MS` | `0` | `100` ~ `500` | 慢查询日志阈值（0 表示关闭） |

### SQLite vs PostgreSQL 选择建议

| 场景 | 推荐 |
|---|---|
| 本地开发、单机部署 | SQLite |
| 多实例、K8s、高并发 | PostgreSQL |
| 需要外部 BI 工具 | PostgreSQL |

详见 [PostgreSQL 迁移指南](./postgresql-migration.md)。

---

## 7. Redis

| 变量 | 默认值 | 说明 |
|---|---|---|
| `REDIS_URL` | *(空)* | `redis://localhost:6379/0` |

启用后：
- WebSocket 广播跨实例可达（Redis Pub/Sub）。
- 分布式速率限制生效。

---

## 8. Feishu / Lark

| 变量 | 默认值 | 说明 |
|---|---|---|
| `FEISHU_APP_ID` | *(空)* | 飞书应用 ID |
| `FEISHU_APP_SECRET` | *(空)* | 飞书应用 Secret |
| `FEISHU_VERIFICATION_TOKEN` | *(空)* | 事件订阅验证 Token |
| `FEISHU_ENCRYPT_KEY` | *(空)* | 加密密钥（可选） |
| `FEISHU_WEBHOOK_PORT` | `3000` | 飞书 webhook 监听端口 |
| `FEISHU_WEBHOOK_PATH` | `/feishu/webhook` | webhook 路径 |
| `FEISHU_AUTO_START` | *(未设置则 true)* | 启动时自动启用 webhook |

---

## 9. 日志

| 变量 | 默认值 | 可选值 | 说明 |
|---|---|---|---|
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` | 日志级别 |
| `LOG_FORMAT` | `pretty` | `json` / `pretty` | `json` 适合日志聚合系统 |

---

## 10. Sentry

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SENTRY_DSN` | *(空)* | Sentry 项目 DSN |
| `SENTRY_ENVIRONMENT` | `development` | 环境标识 |

---

## 11. OpenTelemetry

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OTEL_ENABLED` | *(空)* | 设为 `1` 启用 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP 接收端 |
| `OTEL_EXPORTER_OTLP_HEADERS` | *(空)* | 逗号分隔的 `key=value` |
| `OTEL_SERVICE_NAME` | `ouroboros-agent` | 服务名 |
| `OTEL_SERVICE_VERSION` | `0.1.0` | 版本 |
| `OTEL_EXPORTER_OTLP_TIMEOUT` | `10000` | 导出超时（毫秒） |

---

## 12. MCP

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MCP_SERVERS` | `[]` | JSON 数组，配置外部 MCP 服务器 |

示例：

```bash
MCP_SERVERS='[{"name":"filesystem","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/allowed/path"]}]'
```

---

## 13. 其他

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OUROBOROS_SKILL_DIR` | `skills` | Skill 搜索目录 |
| `NODE_ENV` | `development` | `production` 会启用更严格的校验 |

---

## 14. 生产环境配置模板

```bash
# ============================================
# Ouroboros Agent — Production Configuration
# ============================================

NODE_ENV=production

# Security
WEB_API_TOKEN=GENERATE_A_STRONG_64_CHAR_HEX_TOKEN_HERE
WEB_ALLOWED_ORIGINS=https://ouroboros.yourdomain.com

# LLM (Primary)
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o
LLM_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LLM_TEMPERATURE=0.2
LLM_MAX_TOKENS=4096

# LLM Fallback
FALLBACK_LLM_PROVIDER=anthropic
FALLBACK_LLM_MODEL=claude-3-5-sonnet-20241022
FALLBACK_LLM_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Database (PostgreSQL recommended for production)
USE_POSTGRES=1
DATABASE_URL=postgresql://ouroboros:STRONG_DB_PASSWORD@postgres:5432/ouroboros
SLOW_QUERY_THRESHOLD_MS=500

# Redis (required for multi-instance)
REDIS_URL=redis://redis:6379/0

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Observability
SENTRY_DSN=https://xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx@xxxxxx.ingest.sentry.io/xxxxxx
SENTRY_ENVIRONMENT=production

OTEL_ENABLED=1
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=ouroboros-agent
OTEL_SERVICE_VERSION=0.9.0

# Feishu (optional)
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FEISHU_VERIFICATION_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FEISHU_AUTO_START=true
```

---

## 相关文档

- [部署指南](./deployment.md)
- [架构文档](./architecture.md)
- [PostgreSQL 迁移指南](./postgresql-migration.md)
