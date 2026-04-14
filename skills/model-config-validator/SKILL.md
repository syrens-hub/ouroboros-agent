---
name: model-config-validator
description: 当模型配置报错"unknown option"时快速诊断——模型名格式错误或不支持
version: 1.0.0
---

# 模型配置诊断

## 触发条件
日志/CLI中出现：
```
[ERROR] 未知选项: minimax/MiniMax-M2
unknown option: xxx
```

## 诊断步骤

### Step 1: 检查当前模型配置
```bash
openclaw config get 2>/dev/null | grep -i model
cat ~/.openclaw/openclaw.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('model', d.get('agents',{})), indent=2))"
```

### Step 2: 验证模型格式
正确格式：`provider/model-name`（小写/中划线）
```
✅ minimax/MiniMax-M2.7
✅ kimi/kimi-k2.5
✅ ollama/gemma
❌ minimax/MiniMax-M2（非完整版本号）
❌ Ollama/Gemma（大写）
```

### Step 3: 测试模型是否可用
```bash
# 测试Kimi
curl -s -X POST "https://api.moonshot.cn/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KIMI_API_KEY" \
  -d '{"model":"kimi-k2.5","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'

# 测试MiniMax
curl -s -X POST "https://api.minimax.chat/v1/chat_completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MINIMAX_API_KEY" \
  -d '{"model":"MiniMax-Text-01","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'
```

### Step 4: 修复配置
```bash
openclaw config set agents.defaults.model "minimax/MiniMax-M2.7"
openclaw config set agents.defaults.fallback "kimi/kimi-k2.5"
openclaw gateway restart
```

## 常见错误模式

| 错误 | 原因 | 修复 |
|------|------|------|
| MiniMax-M2 | 缺少完整版本号 | 改为 MiniMax-M2.7 |
| gemma | Ollama模型名需查 | ollama list 确认实际名称 |
| GPT-4 | 大小写错误 | openai/gpt-4o |
| claude-3 | 版本过旧 | anthropic/claude-sonnet-4 |

## 预防
- 配置后立即测试：`echo "test" | openclaw chat`
- 模型别名优先使用，少用完整版本号
