# Ouroboros Agent — API 文档

> 本文档描述 Ouroboros Agent 的 HTTP API 与 WebSocket 协议。所有时间戳均为毫秒级 Unix Epoch，除非另有说明。

---

## 目录

- [1. 认证](#1-认证)
- [2. 速率限制](#2-速率限制)
- [3. WebSocket 聊天](#3-websocket-聊天)
- [4. Session 管理](#4-session-管理)
- [5. Skill 管理](#5-skill-管理)
- [6. 监控指标](#6-监控指标)
- [7. 审计日志](#7-审计日志)
- [8. 其他核心端点](#8-其他核心端点)
- [9. 错误响应格式](#9-错误响应格式)

---

## 1. 认证

除健康探测端点（`/health`、`/ready`、`/metrics`）外，所有 `/api/*` 端点在 `WEB_API_TOKEN` 配置后启用 Bearer Token 认证。

```bash
curl -H "Authorization: Bearer $WEB_API_TOKEN" http://localhost:8080/api/sessions
```

前端 SPA 通过注入的 script tag 自动获取 token，无需手动处理。

---

## 2. 速率限制

系统实施两层速率限制：

| 层级 | 范围 | 阈值 | 窗口 |
|---|---|---|---|
| HTTP 层 | `/api/*` + `/webhooks/*` | 100 req/min | 60s |
| API 层 | `/api/*`（非本机 IP） | 60 req/min | 60s |
| 上传 | `/api/upload/*` | 10 req/min | 60s |

本机 IP（`127.0.0.1`、`::1`）在开发/测试环境下绕过 API 层限流，但生产环境建议通过反向统一控制。

超限响应：

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 45
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
```

```json
{
  "success": false,
  "error": {
    "message": "Too many requests",
    "retryAfter": 45000
  }
}
```

---

## 3. WebSocket 聊天

实时聊天不通过 HTTP，而是通过 WebSocket。服务器启动后，前端自动连接到同一主机的 WebSocket。

### 3.1 连接

```js
const ws = new WebSocket(`wss://${location.host}`);
```

### 3.2 客户端发送消息

```json
{
  "type": "chat",
  "message": "Hello Ouroboros",
  "sessionId": "web_1713600000000"
}
```

### 3.3 服务器推送消息

| 类型 | 说明 | 示例字段 |
|---|---|---|
| `assistant` | LLM 回复 | `{ role: "assistant", content: "..." }` |
| `tool_result` | 工具执行结果 | `{ type: "tool_result", toolUseId: "...", content: "..." }` |
| `progress` | 工具进度（如 browser/computer_use） | `{ step, totalSteps, message, detail: { screenshotUrl } }` |
| `error` | 错误通知 | `{ message: "..." }` |
| `notification` | 系统通知 | `{ title, message, timestamp }` |

### 3.4 确认权限（交互式工具）

当工具需要人工确认时，服务器发送：

```json
{
  "type": "confirm_request",
  "sessionId": "...",
  "toolName": "self_modify",
  "message": "Allow modifying skills/agent-loop/index.ts?"
}
```

客户端回复：

```json
{
  "type": "confirm_response",
  "sessionId": "...",
  "allowed": true
}
```

---

## 4. Session 管理

### 4.1 列出所有 Session

```http
GET /api/sessions
Authorization: Bearer <token>
```

**响应：**

```json
{
  "success": true,
  "data": [
    {
      "sessionId": "web_1713600000000",
      "title": "Web Session 2024/4/20 10:00:00",
      "createdAt": 1713600000000,
      "updatedAt": 1713601000000
    }
  ]
}
```

### 4.2 创建 Session

```http
POST /api/sessions
Authorization: Bearer <token>
```

**响应：**

```json
{
  "success": true,
  "data": {
    "sessionId": "web_1713600123456"
  }
}
```

### 4.3 删除 Session

```http
DELETE /api/sessions/:sessionId
Authorization: Bearer <token>
```

删除后，对应的 `AgentLoopRunner` 会被移除，释放内存。

### 4.4 获取 Session 消息

```http
GET /api/sessions/:sessionId/messages?limit=50&offset=0&beforeId=123
Authorization: Bearer <token>
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `limit` | number | 最大返回条数 |
| `offset` | number | 偏移量 |
| `beforeId` | number | 只返回小于此 ID 的消息（分页） |

### 4.5 获取 Session 轨迹

```http
GET /api/sessions/:sessionId/traces?turn=3
Authorization: Bearer <token>
```

用于调试和训练数据导出。

### 4.6 权限确认（HTTP 降级）

```http
POST /api/sessions/:sessionId/confirm
Authorization: Bearer <token>
Content-Type: application/json

{
  "allowed": true
}
```

当 WebSocket 不可用时，可通过此端点响应权限确认。

---

## 5. Skill 管理

### 5.1 列出所有 Skill

```http
GET /api/skills
Authorization: Bearer <token>
```

**响应：**

```json
{
  "success": true,
  "data": [
    {
      "name": "browser",
      "description": "Playwright-based browser automation",
      "version": "2.0.0",
      "tags": ["automation", "vision"],
      "hasCode": true
    }
  ]
}
```

> 此接口带 10 秒本地缓存。

### 5.2 生成 Skill 代码

```http
POST /api/skills/generate
Authorization: Bearer <token>
Content-Type: application/json

{
  "skill_name": "csv-processor",
  "description": "Parse and analyze CSV files",
  "problem_statement": "Auto-generate executable code for skill csv-processor",
  "example_usage": "Parse a CSV and return column statistics",
  "force": false
}
```

**响应：**

```json
{
  "success": true,
  "data": {
    "skillName": "csv-processor",
    "files": ["SKILL.md", "index.ts"]
  }
}
```

### 5.3 安装 Skill

```http
POST /api/skills/install
Authorization: Bearer <token>
Content-Type: application/json

{
  "source": "https://github.com/owner/ouroboros-skill-example"
}
```

---

## 6. 监控指标

### 6.1 Prometheus 格式指标

```http
GET /api/metrics
```

无需认证（常用于 Prometheus scraper 或 K8s probe）。

**返回示例（text/plain）：**

```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",path="/api/status",status="200"} 42

# HELP http_request_duration_seconds HTTP request duration
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.1",method="GET",path="/api/status"} 38

# HELP active_runners Active agent runners
# TYPE active_runners gauge
active_runners 3

# HELP ws_clients Active WebSocket clients
# TYPE ws_clients gauge
ws_clients 5

# HELP llm_latency_ms Average LLM latency in milliseconds
# TYPE llm_latency_ms gauge
llm_latency_ms 1240

# HELP ouroboros_circuit_breaker_state Circuit breaker state
# TYPE ouroboros_circuit_breaker_state gauge
ouroboros_circuit_breaker_state{provider="openai"} 0
```

### 6.2 JSON 应用指标

```http
GET /api/app-metrics
Authorization: Bearer <token>
```

供前端仪表盘使用：

```json
{
  "success": true,
  "data": {
    "runnerPool": { "size": 3, "max": 50 },
    "wsClients": 5,
    "wsConnectionsTotal": 120,
    "tasksPending": 0,
    "tasksRunning": 1,
    "memoryUsageMB": 142,
    "uptimeSeconds": 3600,
    "llmLatencyMs": 1240,
    "llmP95LatencyMs": 3200,
    "llmCalls": 156,
    "llmTotalTokens": 450000,
    "tokenUsage24h": 120000,
    "tokenAlertThreshold": 100000
  }
}
```

### 6.3 监控面板子接口

```http
GET /api/monitoring/status
GET /api/monitoring/event-bus
GET /api/monitoring/safety
GET /api/monitoring/approvals
GET /api/monitoring/versions
GET /api/monitoring/test-runs
```

分别返回系统状态、EventBus 健康、安全状态、审批队列、进化版本和测试运行状态。

---

## 7. 审计日志

> 当前版本下，审计日志以结构化形式写入数据库，主要通过内部监控和直接 DB 查询访问。以下说明数据模型和存储位置。

### 7.1 API 审计日志

**表**：`api_audit_log`

| 字段 | 说明 |
|---|---|
| `timestamp` | 请求时间 |
| `request_id` | 唯一请求 ID |
| `client_ip` | 客户端 IP |
| `method` | HTTP 方法 |
| `path` | 请求路径 |
| `status_code` | 响应状态码 |
| `duration_ms` | 处理耗时 |
| `user_agent` | User-Agent |
| `token_prefix` | Token 前 8 位（用于溯源） |
| `origin` | 请求 Origin |

可通过以下方式查询：

```sql
SELECT * FROM api_audit_log
WHERE path LIKE '/api/sessions%'
  AND timestamp > strftime('%s', 'now', '-1 day') * 1000
ORDER BY timestamp DESC
LIMIT 100;
```

### 7.2 安全审计日志

**表**：`security_audit_log`（位于 `security.db`）

记录工具权限决策：

| 字段 | 说明 |
|---|---|
| `session_id` | 会话 ID |
| `tool_name` | 工具名 |
| `input_json` | 工具输入 |
| `decision` | `allow` / `deny` / `ask` |
| `timestamp` | 决策时间 |
| `reason` | 决策原因 |

### 7.3 日志保留策略

默认保留 **30 天**。每日凌晨 cron 任务自动清理过期记录。可通过环境变量调整（见 [配置参考](./configuration.md)）。

---

## 8. 其他核心端点

### 8.1 健康探测

```http
GET /health
GET /api/health
```

```json
{
  "healthy": true,
  "checks": { "db": true, "llm": true }
}
```

### 8.2 就绪探测

```http
GET /ready
GET /api/ready
```

检查数据库连接、迁移完整性和 LLM 配置。

### 8.3 系统状态

```http
GET /api/status
```

返回会话数、Skill 数、IM 插件状态、守护进程状态等。

### 8.4 OpenAPI 规范

```http
GET /api/openapi.json
```

自动生成 OpenAPI 3.0.3 规范，包含所有已注册工具（Zod 派生 JSON Schema）和核心 HTTP 端点。

---

## 9. 错误响应格式

所有 API 错误采用统一结构：

```json
{
  "success": false,
  "error": {
    "message": "人类可读的错误描述"
  }
}
```

常见状态码：

| 状态码 | 场景 |
|---|---|
| `400` | 请求体格式错误、Zod 校验失败 |
| `401` | 缺少或无效的 Bearer Token |
| `403` | CORS Origin 不在白名单 |
| `404` | 端点或资源不存在 |
| `413` | 请求体超过大小限制 |
| `429` | 速率限制 |
| `500` | 服务器内部错误 |
| `503` | 健康/就绪检查未通过 |

---

## 相关文档

- [架构文档](./architecture.md)
- [配置参考](./configuration.md)
- [部署指南](./deployment.md)
