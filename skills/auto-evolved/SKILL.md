---
name: skill-self-evolution
description: 技能自进化系统 - 当子Agent任务完成后自动将成功执行路径固化为可复用Skill。用于需要从成功执行中学习并自动创建技能的场景。
---

# Skill Self-Evolution System

技能自进化系统 - 从成功执行中自动学习。

## 核心组件

### 1. skill-crystallizer.sh
将成功执行路径结晶化为Skill文件。

```bash
# 基本用法
bash scripts/skill-crystallizer.sh "<任务描述>" '<执行轨迹JSON>'

# 指定领域
bash scripts/skill-crystallizer.sh "Git修复" '[{"tool":"git"}]' -d git-operations

# 指定模型
bash scripts/skill-crystallizer.sh "任务" '[]' -m anthropic/claude-3
```

### 2. skill-retriever.sh
检索匹配的auto-evolved Skills。

```bash
# 搜索Skills
bash scripts/skill-retriever.sh search "Git冲突"

# 列出所有Skills
bash scripts/skill-retriever.sh list

# 获取特定Skill内容
bash scripts/skill-retriever.sh get <skill_file>
```

### 3. skill-evolution-hook.py
子Agent完成事件钩子，自动触发结晶化。

```bash
# 手动触发
echo '{"event":"subagent_complete","data":{"task":"任务","trajectory":[],"success":true}}' \
  | python3 scripts/skill-evolution-hook.py
```

## 工作流程

```
子Agent任务完成
    ↓
触发 skill-evolution-hook.py
    ↓
解析执行轨迹和上下文
    ↓
调用 skill-crystallizer.sh
    ↓
生成 Skill.md 文件
    ↓
写入 ~/.openclaw/skills/auto-evolved/
    ↓
更新 _index.json 索引
    ↓
下次任务分配前，调用 skill-retriever.sh 检索匹配Skill
```

## Skill.md 标准格式

```markdown
# Auto-Evolved Skill: {领域}

## 触发条件
{什么任务会触发这个Skill}

## 执行路径
{成功的工具调用序列}

## Token 成本估算
{预估消耗}

## 创建时间
{ISO 8601时间戳}

## 成功率
{评估}

## 适用场景
{详细场景}

## 注意事项
{关键注意点}
```

## 目录结构

```
~/.openclaw/skills/auto-evolved/
├── _index.json          # Skill索引
├── git-operations-*.md  # 各类Skill文件
├── code-fix-*.md
├── feishu-integration-*.md
└── ...
```

## 集成到任务分配

在分配任务给子Agent前，先调用检索：

```bash
MATCHED_SKILLS=$(bash scripts/skill-retriever.sh search "$TASK_DESC" 3)
if [[ -n "$MATCHED_SKILLS" ]] && [[ "$MATCHED_SKILLS" != "[]" ]]; then
    echo "找到匹配的Auto-Evolved Skill: $MATCHED_SKILLS"
    # 可以将Skill内容附加到任务提示中
fi
```

## 测试

```bash
bash scripts/test-skill-evolution.sh
```

## 状态

- ✅ 目录创建
- ✅ Skill文件生成
- ✅ 索引维护
- ✅ 检索功能
- ✅ Hook集成
- 🔄 LLM API集成（使用模板 fallback）
