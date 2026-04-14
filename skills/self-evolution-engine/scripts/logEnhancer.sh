#!/bin/bash
# 日志增强模块 - Shell实现
# 学习自 Claude Code 的日志系统

LOG_DIR="${HOME}/.openclaw/workspace/logs"
CONFIG_FILE="${LOG_DIR}/config.json"
EVENTS_FILE="${LOG_DIR}/events.json"

# 初始化目录
init() {
    mkdir -p "$LOG_DIR"
    if [ ! -f "$CONFIG_FILE" ]; then
        cat > "$CONFIG_FILE" << 'EOF'
{
  "version": 1,
  "enabled": true,
  "level": "info",
  "categories": {
    "startup": true,
    "error": true,
    "tool_use": true,
    "session": true,
    "api": true,
    "performance": true
  },
  "maxLogs": 1000,
  "output": "both"
}
EOF
    fi
    if [ ! -f "$EVENTS_FILE" ]; then
        echo "[]" > "$EVENTS_FILE"
    fi
}

# 获取当前时间戳
get_timestamp() {
    date '+%Y-%m-%dT%H:%M:%S.%3N'
}

# 日志函数
log_event() {
    local level="$1"
    local category="$2"
    local event="$3"
    local metadata="${4:-{}}"
    
    # 检查是否启用
    if [ "$(cat "$CONFIG_FILE" 2>/dev/null | grep -o "\"enabled\":[^,]*" | cut -d':' -f2)" != "true" ]; then
        return
    fi
    
    # 检查类别是否启用
    local cat_enabled=$(cat "$CONFIG_FILE" 2>/dev/null | grep -A10 "categories" | grep "\"${category}\":" | cut -d':' -f2 | tr -d ' ')
    if [ "$cat_enabled" != "true" ]; then
        return
    fi
    
    # 构建日志条目
    local entry=$(cat << EOF
{
  "timestamp": "$(get_timestamp)",
  "level": "${level}",
  "category": "${category}",
  "event": "${event}",
  "metadata": ${metadata}
}
EOF
)
    
    # 输出到控制台
    case "$level" in
        error)
            echo "[${category^^}] $(get_timestamp) ERROR: $event" >&2
            ;;
        warn)
            echo "[${category^^}] $(get_timestamp) WARN: $event"
            ;;
        *)
            echo "[${category^^}] $(get_timestamp) INFO: $event"
            ;;
    esac
    
    # 保存到文件
    save_event "$entry"
}

# 保存事件
save_event() {
    local entry="$1"
    local temp=$(mktemp)
    local events=$(cat "$EVENTS_FILE" 2>/dev/null || echo "[]")
    
    # 限制日志数量
    local count=$(echo "$events" | grep -o '"timestamp"' | wc -l)
    if [ "$count" -gt 1000 ]; then
        # 保留最后1000条
        echo "$events" | tail -1000 | head -999 > "$temp"
        echo "["$(cat "$temp")",$entry]" > "$EVENTS_FILE"
    else
        # 追加
        if [ "$events" = "[]" ]; then
            echo "[$entry]" > "$EVENTS_FILE"
        else
            echo "${events%]},$entry]" > "$EVENTS_FILE"
        fi
    fi
    rm -f "$temp"
}

# 便捷函数
log_startup() {
    log_event "info" "startup" "$1" "${2:-{}}"
}

log_error() {
    log_event "error" "error" "$1" "${2:-{}}"
}

log_tool_use() {
    log_event "info" "tool_use" "$1" "${2:-{}}"
}

log_session() {
    log_event "info" "session" "$1" "${2:-{}}"
}

log_api() {
    log_event "info" "api" "$1" "${2:-{}}"
}

log_performance() {
    log_event "info" "performance" "$1" "${2:-{}}"
}

# 查询日志
query_logs() {
    local category="${1:-all}"
    local limit="${2:-100}"
    
    if [ "$category" = "all" ]; then
        cat "$EVENTS_FILE" 2>/dev/null | tail -$limit
    else
        cat "$EVENTS_FILE" 2>/dev/null | grep "\"${category}\":" | tail -$limit
    fi
}

# 获取统计
get_stats() {
    echo "=== 日志统计 ==="
    for cat in startup error tool_use session api performance; do
        count=$(grep -c "\"${cat}\":" "$EVENTS_FILE" 2>/dev/null || echo "0")
        echo "  $cat: $count"
    done
}

# 导出日志
export_logs() {
    local output="${1:-${LOG_DIR}/export_$(date '+%Y%m%d_%H%M%S').json}"
    cat "$EVENTS_FILE" > "$output"
    echo "日志已导出到: $output"
}

# 清理旧日志
cleanup() {
    local keep="${1:-100}"
    local events=$(cat "$EVENTS_FILE" 2>/dev/null || echo "[]")
    if [ "$(echo "$events" | grep -o '"timestamp"' | wc -l)" -gt "$keep" ]; then
        echo "$events" | tail -$keep > "${EVENTS_FILE}.tmp"
        mv "${EVENTS_FILE}.tmp" "$EVENTS_FILE"
        echo "已清理日志，保留最近 $keep 条"
    fi
}

# 初始化
init

# 如果直接运行此脚本，显示帮助
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    echo "日志增强模块"
    echo "================"
    echo "用法:"
    echo "  source logEnhancer.sh           # 加载函数"
    echo "  log_startup \"事件描述\"          # 记录启动事件"
    echo "  log_error \"错误描述\"             # 记录错误"
    echo "  log_tool_use \"工具名称\"          # 记录工具使用"
    echo "  query_logs [类别] [数量]        # 查询日志"
    echo "  get_stats                       # 获取统计"
    echo "  export_logs [输出文件]          # 导出日志"
    echo "  cleanup [保留数量]              # 清理旧日志"
fi
