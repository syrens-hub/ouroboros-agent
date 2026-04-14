# system-health-dashboard

> 多维度系统健康状态统一视图
> 来源：自动生成（2026-04-12）— 检测到25次分散执行模式

## 问题

各维度健康检查分散执行，无统一视图：
```
heartbeat检查 → 分散在 HEARTBEAT.md
记忆模块检查 → 分散在 memory-manager.py
Cron检查 → openclaw cron list
Kimi检查 → kimi-quota-checker
备份检查 → ls backups
```

## 解决方案

统一健康仪表盘，一次调用获取所有维度状态。

## 使用方法

```bash
# 一键健康检查
bash ~/.openclaw/workspace/skills/system-health-dashboard/health.sh

# 带颜色输出的简洁版
bash ~/.openclaw/workspace/skills/system-health-dashboard/health.sh --brief

# 查看详细状态
bash ~/.openclaw/workspace/skills/system-health-dashboard/health.sh --detail
```

## 检查维度

| 维度 | 检查项 | 阈值 |
|------|--------|------|
| 记忆 | MEMORY/USER使用率 | >80%警告，>90%严重 |
| Cron | error状态任务数 | >0警告 |
| Kimi | API状态/过载次数 | 过载>0警告 |
| 备份 | 距上次备份时间 | >6h警告 |
| Hermes | Frozen Snapshot状态 | STALE警告 |
| 预测引擎 | 今日触发次数 | >3警告 |

## 输出示例

```
═══════════════════════════════════════
赤犬健康仪表盘 — 2026-04-12 17:55
═══════════════════════════════════════
记忆  MEMORY  48% ✅  USER  41% ✅
Cron  0 error ✅
Kimi  OK ✅
备份  2h前 ✅
Hermes Frozen Snapshot OK ✅
预测  今日触发2次 ✅
═══════════════════════════════════════
总体  ✅ 健康
═══════════════════════════════════════
```
