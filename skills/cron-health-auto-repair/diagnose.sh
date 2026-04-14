#!/bin/bash
# cron-health-auto-repair — Cron任务自动诊断（读取真实错误）
# 来源：实际问题（2026-04-12）

WORKSPACE="${HOME}/.openclaw/workspace"
JOBS_FILE="${HOME}/.openclaw/cron/jobs.json"

echo "=== Cron任务健康诊断 ==="
echo ""

get_job_error() {
    local id="$1"
    python3 -c "
import json
with open('${JOBS_FILE}') as f:
    data = json.load(f)
for job in data.get('jobs', []):
    if job.get('id') == '${id}':
        state = job.get('state', {})
        print(state.get('lastError', 'unknown'))
        print(state.get('lastErrorReason', ''))
        print(state.get('lastDurationMs', 0))
        print(job.get('payload', {}).get('timeoutSeconds', 0))
        break
" 2>/dev/null
}

# 获取error状态的任务
ERROR_JOBS=$(openclaw cron list 2>/dev/null | grep "error" | awk '{print $1}')

if [[ -z "$ERROR_JOBS" ]]; then
    echo "✅ 无error状态任务"
    exit 0
fi

TOTAL=0
for ID in $ERROR_JOBS; do
    TOTAL=$((TOTAL + 1))
    NAME=$(openclaw cron list 2>/dev/null | grep "$ID" | awk '{for(i=2;i<=NF-6;i++) printf "%s ", $i; print ""}')
    LAST_ERR=$(openclaw cron list 2>/dev/null | grep "$ID" | awk '{print $(NF-2)}')
    LAST_RUN=$(openclaw cron list 2>/dev/null | grep "$ID" | awk '{print $(NF-4)}')

    echo "---"
    echo "ID:    $ID"
    echo "任务:  $NAME"
    echo "上次:  $LAST_RUN 前"
    echo "错误:  $LAST_ERR"

    # 深度读取jobs.json
    ERR_DETAIL=$(get_job_error "$ID" 2>/dev/null)
    if [[ -n "$ERR_DETAIL" ]]; then
        ERR_MSG=$(echo "$ERR_DETAIL" | sed -n '1p')
        ERR_REASON=$(echo "$ERR_DETAIL" | sed -n '2p')
        ERR_DURATION=$(echo "$ERR_DETAIL" | sed -n '3p')
        ERR_TIMEOUT=$(echo "$ERR_DETAIL" | sed -n '4p')

        echo "根因:  $ERR_MSG"
        echo "原因:  $ERR_REASON"
        echo "耗时:  ${ERR_DURATION}ms（timeout=${ERR_TIMEOUT}s）"

        # 自动判断
        if [[ "$ERR_REASON" == "timeout" ]]; then
            echo "诊断:  超时 → 命令执行时间>${ERR_TIMEOUT}s"
            echo "修复:  方案A: 改用极简命令 / 方案B: 增加timeout / 方案C: 加wrapper"
        elif [[ "$ERR_MSG" == *"not found"* ]]; then
            echo "诊断:  脚本不存在 → 检查路径"
        else
            echo "诊断:  需进一步分析"
        fi
    fi
done

echo ""
echo "共 $TOTAL 个error任务"
echo ""
echo "=== 诊断完成 ==="
