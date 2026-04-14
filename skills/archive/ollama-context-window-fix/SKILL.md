---
name: ollama-context-window-fix
description: Ollama本地模型context window太小导致Agent调用失败——自动修复或切换模型
version: 1.0.0
---

# Ollama Context Window 修复

## 触发错误
```
FallbackSummaryError: All models failed
ollama/gemma: Model context window too small (8192 tokens). Minimum is 16000.
```

## 诊断
```bash
# 查看Ollama当前模型列表及context大小
ollama list

# 查看具体模型的信息
ollama show gemma
```

## 修复方案（按优先级）

### 方案A：换用更大的模型
```bash
# Gemma 9B context只有8K，换用Mistral/Qwen
ollama pull mistral
# 或换用支持更大context的版本
ollama pull llama3.3:70b-instruct-q4_K_M
```

### 方案B：如果必须用Gemma，调小context窗口
在openclaw配置中设置max_tokens上限：
```json
{
  "agents": {
    "defaults": {
      "model": "ollama/gemma",
      "max_tokens": 4000
    }
  }
}
```

### 方案C：使用Kimi/MiniMax作为Ollama的备选
当Ollama context不够时自动fallback：
```bash
openclaw config set agents.defaults.model "minimax/MiniMax-M2.7"
openclaw config set agents.defaults.fallback "kimi/kimi-k2.5"
openclaw config set agents.defaults.fallback2 "ollama/gemma"
```

## 预防规则
- Ollama模型永远不要作为唯一选项
- context window < 32K的模型 → 只能作为最后兜底
- 生产环境：优先云端API（H100/GPU），本地Ollama只做开发测试

## 快速检测（心跳自动运行）
```bash
# 检查Ollama是否可用且context够大
ollama list 2>/dev/null | grep -q "gemma" && echo "⚠️ gemma context=8K only" || echo "✅ Ollama OK"
```
