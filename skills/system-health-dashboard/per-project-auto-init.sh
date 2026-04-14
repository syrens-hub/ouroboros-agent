#!/bin/bash
# per-project-auto-init — 自动检测并初始化Per-Project Memory
# 原理：扫描项目目录中的CLAUDE.md，发现未初始化的项目则自动注册

WORKSPACE="${HOME}/.openclaw/workspace"
PROJECTS_DIR="${HOME}/Desktop"  # 可配置为其他项目目录

echo "=== Per-Project Memory 自动初始化 ==="
echo ""

FOUND=0
INITIALIZED=0

# 扫描桌面项目目录
for dir in "$PROJECTS_DIR"/*/; do
    [[ ! -d "$dir" ]] && continue
    CLAUDE="$dir/CLAUDE.md"
    if [[ -f "$CLAUDE" ]]; then
        FOUND=$((FOUND + 1))
        PROJECT_ID=$(basename "$dir")

        # 检查是否已初始化
        INITIALIZED_COUNT=$(python3 "$WORKSPACE/scripts/project-memory.py" list 2>/dev/null | grep -c "$PROJECT_ID" || echo 0)
        if [[ "$INITIALIZED_COUNT" -eq 0 ]]; then
            echo "🆕 发现未初始化项目: $PROJECT_ID"
            echo "   路径: $dir"
            echo "   → 建议运行: project-memory.py init '$PROJECT_ID' --root '$dir'"
            INITIALIZED=$((INITIALIZED + 1))
        fi
    fi
done

echo ""
if [[ "$FOUND" -eq 0 ]]; then
    echo "✅ 未发现新的Per-Project Memory"
elif [[ "$INITIALIZED" -gt 0 ]]; then
    echo "发现 $FOUND 个项目（$INITIALIZED 个未初始化）"
    echo "运行 'project-memory.py init <id>' 完成初始化"
else
    echo "✅ 所有 $FOUND 个项目均已初始化"
fi
