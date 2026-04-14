---
name: crystallization-debug
description: 当记忆结晶（Crystallization）失败时，快速诊断根因并修复
version: 1.0.0
---

# 记忆结晶失败诊断

## 触发条件
日志中出现 `Crystallization failed` 或 `Hook completed with issues`

## 诊断步骤

### 1. 检查Hook日志
```bash
cat ~/.openclaw/logs/commands.log | grep -A3 "Crystallization failed"
```

### 2. 常见根因 + 对策

| 根因 | 诊断命令 | 修复方法 |
|------|---------|---------|
| memory-consolidator脚本不存在 | `ls ~/.openclaw/workspace/scripts/memory-consolidator.py` | 重新安装 |
| 磁盘空间不足 | `df -h ~/.openclaw` | 清理日志/备份 |
| memory-limiter运行中 | 检查进程 | 等它完成再重试 |
| SKILL.md格式错误 | `python3 -c "import yaml; yaml.safe_load(open('memory/MEMORY.md'))"` | 修复YAML |
| 向量索引损坏 | 重建索引 | `python3 scripts/vector-memory.py rebuild` |

### 3. 快速修复模板
```bash
# 如果是脚本缺失，从备份恢复
cp ~/.openclaw/backups/*/memory-consolidator.py ~/.openclaw/workspace/scripts/ 2>/dev/null

# 如果是格式错误，重新生成
python3 -c "
import re
with open('memory/MEMORY.md') as f:
    content = f.read()
# 移除可能导致YAML错误的字符
content = re.sub(r'[^\x00-\x7F]+', '', content)
with open('memory/MEMORY.md', 'w') as f:
    f.write(content)
"
```

## 预防措施
- 每周一凌晨04:00自动全量重建向量索引
- 记忆文件修改后自动触发增量索引更新
