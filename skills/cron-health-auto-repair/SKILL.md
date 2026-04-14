# cron-health-auto-repair

> 自动检测和修复Cron任务error状态
> 来源：实际问题分析（2026-04-12）
> 触发次数：12次同类问题

## 问题症状

- cron任务状态变为 `error`
- 原因：超时 / 脚本不存在 / 依赖缺失
- 常见错误：`job execution timed out` / `command not found`

## 诊断流程

```
检测到cron error
  ↓
获取任务详情（ID / 名称 / 上次错误信息）
  ↓
三分类诊断：
  ① 超时 → 增加timeout 或改用直接脚本调用
  ② 脚本不存在 → 创建缺失脚本或禁用任务
  ③ 依赖缺失 → 安装依赖或修复路径
  ↓
执行修复或禁用
  ↓
记录修复历史
```

## 使用命令

```bash
# 诊断所有error状态的cron任务
bash ~/.openclaw/workspace/skills/cron-health-auto-repair/diagnose.sh

# 自动修复（仅修复超时问题）
bash ~/.openclaw/workspace/skills/cron-health-auto-repair/auto-fix.sh
```

## 已知根因模式

| 模式 | 修复方法 |
|------|---------|
| `timed out` | 将 agentTurn 改为直接脚本调用，或增加timeout |
| `not found` | 检查脚本路径，修复或禁用任务 |
| `exit code 1` | 检查脚本语法和依赖 |
