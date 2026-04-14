#!/bin/bash
# agency-evolution.sh - Agency 自我进化触发器
# 当任务交付质量差或用户修正时，触发进化记录

set -e

ACTION="${1:-status}"
SKILL_DIR="$HOME/.openclaw/workspace/skills/agency"
LEARNINGS_DIR="$SKILL_DIR/.learnings"

case "$ACTION" in
    learn)
        # 记录新经验
        echo "📝 记录新经验..."
        echo ""
        read -p "场景: " SCENE
        read -p "问题: " PROBLEM
        read -p "做法: " SOLUTION
        read -p "效果: " EFFECT
        
        ID="LRN-$(date '+%Y%m%d')-$(printf '%03d' $((RANDOM % 1000)))"
        cat >> "$LEARNINGS_DIR/LEARNINGS.md" << EOF

### [$ID]
- **场景**: $SCENE
- **问题**: $PROBLEM
- **做法**: $SOLUTION
- **效果**: $EFFECT
- **教训**: （待填写）
EOF
        echo "✅ 经验已记录: $ID"
        ;;
        
    error)
        # 记录错误
        echo "⚠️  记录错误..."
        echo ""
        read -p "错误: " ERROR
        read -p "原因: " CAUSE
        read -p "后果: " CONSEQUENCE
        read -p "修复: " FIX
        read -p "预防: " PREVENTION
        
        ID="ERR-$(date '+%Y%m%d')-$(printf '%03d' $((RANDOM % 1000)))"
        cat >> "$LEARNINGS_DIR/ERRORS.md" << EOF

### [$ID]
- **错误**: $ERROR
- **原因**: $CAUSE
- **后果**: $CONSEQUENCE
- **修复**: $FIX
- **预防**: $PREVENTION
EOF
        echo "✅ 错误已记录: $ID"
        ;;
        
    analyze)
        # 分析进化状态
        echo "🔍 Agency 进化状态分析"
        echo "================================"
        
        echo ""
        echo "📊 经验统计："
        grep -c "^### \[" "$LEARNINGS_DIR/LEARNINGS.md" 2>/dev/null || echo "0"
        
        echo ""
        echo "📊 错误统计："
        grep -c "^### \[" "$LEARNINGS_DIR/ERRORS.md" 2>/dev/null || echo "0"
        
        echo ""
        echo "📊 功能需求："
        grep -c "^### \[" "$LEARNINGS_DIR/FEATURE_REQUESTS.md" 2>/dev/null || echo "0"
        
        echo ""
        echo "💡 最近的经验："
        tail -10 "$LEARNINGS_DIR/LEARNINGS.md" 2>/dev/null | grep "场景\|问题\|做法"
        
        echo ""
        echo "💡 最近的错误："
        tail -10 "$LEARNINGS_DIR/ERRORS.md" 2>/dev/null | grep "错误\|原因\|预防"
        
        echo "================================"
        ;;
        
    report)
        # 生成进化报告
        echo "📄 生成进化报告..."
        
        cat > "$SKILL_DIR/EVOLUTION-REPORT.md" << EOF
# Agency 进化报告 - $(date '+%Y-%m-%d')

## 统计

| 类型 | 数量 |
|------|------|
| 经验记录 | $(grep -c "^### \[" "$LEARNINGS_DIR/LEARNINGS.md" 2>/dev/null || echo 0) |
| 错误记录 | $(grep -c "^### \[" "$LEARNINGS_DIR/ERRORS.md" 2>/dev/null || echo 0) |
| 功能需求 | $(grep -c "^### \[" "$LEARNINGS_DIR/FEATURE_REQUESTS.md" 2>/dev/null || echo 0) |

## 待处理

### 高优先级错误
$(grep -P "^### \[ERR.*\n.*预防: " "$LEARNINGS_DIR/ERRORS.md" 2>/dev/null | head -3 || echo "无")

### 待晋升规则
$(grep -P "^### \[LRN.*\n.*教训: " "$LEARNINGS_DIR/LEARNINGS.md" 2>/dev/null | head -3 || echo "无")

## 下一步行动
1. 分析最近错误，制定预防规则
2. 将有效经验晋升到 best-practices
3. 评估功能需求实现可行性
EOF
        echo "✅ 报告已生成: $SKILL_DIR/EVOLUTION-REPORT.md"
        ;;
        
    *)
        echo "用法："
        echo "  $0 learn    # 记录新经验"
        echo "  $0 error   # 记录错误"
        echo "  $0 analyze # 分析进化状态"
        echo "  $0 report  # 生成进化报告"
        exit 1
        ;;
esac
