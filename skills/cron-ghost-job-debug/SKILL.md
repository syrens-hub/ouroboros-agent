---
name: cron-ghost-job-debug
description: Cron任务报错"unknown cron job id"时的根因诊断——任务被删但引用仍在
version: 1.0.0
---

# Cron幽灵任务调试

## 症状
```
Error: unknown cron job id: xxxxxxxx
cron.run/cron.update/cron.edit 失败
```

## 根因
任务被删除（rm/disable）后，监控系统或编排脚本仍在引用旧ID

## 诊断流程

### Step 1: 列出当前所有有效任务
```bash
openclaw cron list
```
记住有效任务的ID列表

### Step 2: 找到谁在引用"幽灵ID"
```bash
# 在所有脚本中搜索这个ID
grep -r "xxxxxxxx" ~/.openclaw/workspace/scripts/ 2>/dev/null

# 在cron日志中查找引用
grep "xxxxxxxx" ~/.openclaw/logs/gateway.log 2>/dev/null | tail -5
```

### Step 3: 确认任务是否真的不存在
```bash
openclaw cron list | grep "xxxxxxxx"
# 无输出 = 任务确实不存在
```

## 修复方案

### 方案A：任务需要重建
```bash
# 1. 从日志中找到这个任务最后一次成功的配置
# 2. 用 cron edit 的正确ID重建（如果只是ID变了但任务是同一个）
```

### 方案B：引用方需要更新
```bash
# 如果是health.sh/diagnose.sh等监控脚本引用了旧ID
# 更新脚本中的任务ID
```

### 方案C：完全禁用该检查
如果任务已废弃，相关监控脚本也要同步清理

## 预防规则
- 删除cron任务前，先检查是否有脚本在引用
- 用 `cron disable` 替代 `cron rm`（可逆）
- 监控脚本使用任务名称而非硬编码ID
