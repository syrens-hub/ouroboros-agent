---
name: kimi-quota-checker
description: |
  Kimi API Quota 监控与告警 Skill。
  检查 Kimi API key 是否还有 quota，如果 quota < 20% 或耗尽，自动发送飞书告警给谢总。
  触发场景：心跳检查（第0步）、每30分钟 cron 巡检。
---

# Kimi-Quick-Health-Checker

## 功能

- 🔍 检查 Kimi API key 是否还有可用 quota
- 🚨 quota < 20% → 发送"低 quota 告警"到飞书
- 🚨 quota = 0 / 已耗尽 → 发送"紧急告警"到飞书
- ✅ quota 充足 → 静默（仅记录到当日 memory）

## 阈值

| 状态 | 条件 | 动作 |
|------|------|------|
| 紧急 | quota = 0（请求被拒） | 🚨 立即告警 |
| 警告 | quota < 20% | ⚠️ 低 quota 告警 |
| 正常 | 请求成功 | ✅ 静默记录 |

## 实现原理

Kimi API 不暴露 `/balance` 或 `/usage` 端点，通过以下方式判断：

1. 向 `/v1/chat/completions` 发送最小请求（1 token）
2. 根据 HTTP 状态码和 error body 判断：
   - `200` → quota 充足
   - `429` + rate_limit/quota 关键词 → quota 耗尽或受限
   - `403` + permission/quota 关键词 → quota 耗尽
   - 其他错误 → 记录但不确定

## 集成方式

### 方式1：心跳检查（推荐，第0步）

在 `HEARTBEAT.md` 的检查清单最前面加入：

```bash
# 0. Kimi API Quota 检查（第0步，最优先）
python3 ~/.openclaw/workspace/skills/kimi-quota-checker/check.py
```

### 方式2：Cron 任务（每30分钟）

```bash
openclaw cron add "KimiQuotaChecker" "*/30 * * * *" \
  --agent-id=main \
  --kind=isolated \
  "python3 ~/.openclaw/workspace/skills/kimi-quota-checker/check.py"
```

## 输出格式

- 告警消息格式：飞书富文本卡片（Card）
- 日志格式：追加到 `memory/YYYY-MM-DD.md`

## 依赖

- `curl`
- `python3`
- 飞书 bot（已在 openclaw 配置中）
