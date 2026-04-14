#!/bin/bash
# cron-safe-wrapper.sh — 带超时保护的cron任务wrapper
# 用法: cron-safe-wrapper.sh <timeout秒> <命令>
# 原理: 超时后强制kill，避免cron任务卡死导致连续error

TIMEOUT="${1:-30}"
shift
CMD="$@"

# 执行命令，带超时保护
timeout "$TIMEOUT" bash -c "$CMD"
EXIT=$?

if [[ $EXIT -eq 124 ]]; then
    echo "[cron-safe-wrapper] ⚠️ 命令超时（${TIMEOUT}s）"
    exit 1
elif [[ $EXIT -ne 0 ]]; then
    echo "[cron-safe-wrapper] ⚠️ 命令失败，exit=$EXIT"
    exit 1
else
    echo "[cron-safe-wrapper] ✅ 完成"
    exit 0
fi
