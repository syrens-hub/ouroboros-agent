#!/bin/bash
# system-health-dashboard — 多维度健康状态统一视图

WORKSPACE="${HOME}/.openclaw/workspace"

# 颜色
RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

timestamp=$(date "+%Y-%m-%d %H:%M")
MODE="${1:-normal}"

if [[ "$MODE" == "--brief" ]]; then
    echo -e "${CYAN}赤犬健康检查${NC} — $timestamp"
    echo "---"

    # Memory
    MEM=$(bash "$WORKSPACE/scripts/memory-limiter.sh" status 2>/dev/null | grep MEMORY | grep -v "===")
    echo "记忆  $MEM"

    # Cron
    CRON_ERR=$(openclaw cron list 2>/dev/null | grep -c "error" || true)
    if [[ "$CRON_ERR" -gt 0 ]]; then
        echo -e "${YELLOW}Cron  $CRON_ERR error ⚠️${NC}"
    else
        echo -e "${GREEN}Cron  0 error ✅${NC}"
    fi

    # Kimi
    KIMI=$(python3 "$WORKSPACE/skills/kimi-quota-checker/check.py" 2>&1 | grep -E "正常|警告|过载" | tail -1)
    echo -e "Kimi  $KIMI"

    # Backup
    LATEST=$(ls -t "$WORKSPACE/../backups/" 2>/dev/null | head -1)
    if [[ -n "$LATEST" ]]; then
        BACKUP_DIR="$WORKSPACE/../backups/$LATEST"
        if [[ -d "$BACKUP_DIR" ]]; then
            AGE_MINS=$(python3 -c "import os,time;print((time.time()-os.path.getmtime('$BACKUP_DIR'))/60)" 2>/dev/null)
            if [[ -n "$AGE_MINS" && "$(echo "$AGE_MINS > 360" | bc 2>/dev/null)" == "1" ]]; then
                echo -e "${YELLOW}备份  $(printf '%.0f' $AGE_MINS)m old ⚠️${NC}"
            else
                echo -e "${GREEN}备份  OK ✅${NC}"
            fi
        fi
    fi

    exit 0
fi

# 正常模式
echo "═══════════════════════════════════════"
echo -e "${CYAN}赤犬健康仪表盘${NC} — $timestamp"
echo "═══════════════════════════════════════"
echo ""

# 1. 记忆
echo -e "${CYAN}[1] 记忆模块${NC}"
bash "$WORKSPACE/scripts/memory-limiter.sh" status 2>/dev/null
echo ""

# 2. Cron
echo -e "${CYAN}[2] Cron任务${NC}"
CRON_LIST=$(openclaw cron list 2>/dev/null)
CRON_ERR=$(echo "$CRON_LIST" | grep -c "error" || true)
CRON_OK=$(echo "$CRON_LIST" | grep -c "ok" || true)
if [[ "$CRON_ERR" -gt 0 ]]; then
    echo -e "${YELLOW}  error: $CRON_ERR  ok: $CRON_OK ⚠️${NC}"
    echo "$CRON_LIST" | grep "error" | head -3
else
    echo -e "${GREEN}  error: 0  ok: $CRON_OK ✅${NC}"
fi
echo ""

# 3. Kimi
echo -e "${CYAN}[3] Kimi API${NC}"
KIMI_OUT=$(python3 "$WORKSPACE/skills/kimi-quota-checker/check.py" 2>&1 | grep -E "Kimi.*正常|Kimi.*警告|engine_overloaded" | tail -1)
if [[ -n "$KIMI_OUT" ]]; then
    if echo "$KIMI_OUT" | grep -q "正常"; then
        echo -e "  $KIMI_OUT ✅"
    else
        echo -e "  $KIMI_OUT ⚠️"
    fi
else
    echo "  检查跳过"
fi
echo ""

# 4. 备份
echo -e "${CYAN}[4] 备份状态${NC}"
LATEST=$(ls -t "$WORKSPACE/../backups/" 2>/dev/null | head -1)
if [[ -n "$LATEST" ]]; then
    BACKUP_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$WORKSPACE/../backups/$LATEST" 2>/dev/null || echo "未知")
    echo "  最新: $LATEST ($BACKUP_TIME)"
else
    echo -e "  ${YELLOW}未找到备份 ⚠️${NC}"
fi
echo ""

# 5. Hermes
echo -e "${CYAN}[5] Hermes模式${NC}"
SNAPSHOT=$(bash "$WORKSPACE/scripts/frozen-snapshot.sh" check 2>/dev/null)
if echo "$SNAPSHOT" | grep -q "STALE"; then
    echo -e "  Snapshot: $SNAPSHOT ⚠️"
else
    echo -e "  Snapshot: $SNAPSHOT ✅"
fi
echo ""

# 6. 预测引擎
echo -e "${CYAN}[6] 预测引擎${NC}"
PRED=$(bash "$WORKSPACE/scripts/predictive-intervention.sh" status 2>/dev/null | grep "今日触发" | awk '{print $4}' || echo "0")
if [[ -z "$PRED" || "$PRED" == "次" ]]; then
    PRED=0
fi
if [[ "$PRED" -gt 3 ]]; then
    echo -e "  今日触发: $PRED 次 ⚠️"
else
    echo -e "  今日触发: $PRED 次 ✅"
fi
echo ""

# 总结
TOTAL_ISSUES=0
[[ "$CRON_ERR" -gt 0 ]] && TOTAL_ISSUES=$((TOTAL_ISSUES + CRON_ERR))
[[ "$PRED" -gt 3 ]] && TOTAL_ISSUES=$((TOTAL_ISSUES + 1))

echo "═══════════════════════════════════════"
if [[ "$TOTAL_ISSUES" -eq 0 ]]; then
    echo -e "${GREEN}总体  ✅ 健康${NC}"
else
    echo -e "${YELLOW}总体  ⚠️ $TOTAL_ISSUES 项需关注${NC}"
fi
echo "═══════════════════════════════════════"
