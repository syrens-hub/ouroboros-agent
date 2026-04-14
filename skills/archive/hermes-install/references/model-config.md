# 模型配置详细参考

## 支持的模型提供商

### 国内推荐

| 提供商 | 模型 | API Key 环境变量 | Base URL |
|--------|------|------------------|----------|
| **阿里百炼** | qwen3.5-plus, qwen-plus, qwen-coder | `DASHSCOPE_API_KEY` | `https://coding.dashscope.aliyuncs.com/v1` |
| **Kimi** | moonshot-v1-8k, moonshot-v1-32k | `MOONSHOT_API_KEY` | `https://api.moonshot.cn/v1` |
| **智谱 GLM** | glm-4, glm-4-flash | `ZHIPU_API_KEY` | `https://open.bigmodel.cn/api/paas/v4` |
| **DeepSeek** | deepseek-chat, deepseek-coder | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/v1` |

### 国际推荐

| 提供商 | 模型 | API Key 环境变量 | Base URL |
|--------|------|------------------|----------|
| **OpenRouter** | 200+ 模型 | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` |
| **OpenAI** | GPT-4o, GPT-4-turbo | `OPENAI_API_KEY` | `https://api.openai.com/v1` |
| **Anthropic** | Claude 3.5 Sonnet | `ANTHROPIC_API_KEY` | `https://api.anthropic.com/v1` |

---

## 阿里百炼配置

### 1. 获取 API Key

1. 访问 [阿里云百炼](https://bailian.console.aliyun.com/)
2. 登录阿里云账号
3. 进入「API-KEY 管理」
4. 创建或查看 API Key

### 2. 配置环境变量

```bash
# 添加到 ~/.hermes/.env
echo 'DASHSCOPE_API_KEY=sk-sp-xxxxxxxxxxxxxxxxxxxxxxxx' >> ~/.hermes/.env

# 或设置 Base URL（可选）
echo 'DASHSCOPE_BASE_URL=https://coding.dashscope.aliyuncs.com/v1' >> ~/.hermes/.env
```

### 3. 命令行配置

```bash
# 设置 API Key
hermes config set DASHSCOPE_API_KEY sk-sp-xxxxxxxxxxxxxxxxxxxxxxxx

# 设置 Base URL
hermes config set DASHSCOPE_BASE_URL https://coding.dashscope.aliyuncs.com/v1
```

### 4. 添加提供商

```bash
hermes model add bailian \
  --base-url https://coding.dashscope.aliyuncs.com/v1 \
  --api-key your-api-key \
  --model qwen3.5-plus \
  --name "Qwen 3.5 Plus"
```

### 5. 切换模型

```bash
# 使用命令行
hermes config set model.provider bailian
hermes config set model.name qwen3.5-plus

# 或在对话中使用命令
/model bailian:qwen3.5-plus
```

### 6. 阿里百炼可用模型

| 模型 ID | 名称 | 上下文 | 最大输出 | 支持功能 |
|---------|------|--------|----------|----------|
| `qwen3.5-plus` | Qwen 3.5 Plus | 1M | 65K | 文本、图片、推理 |
| `qwen-plus` | Qwen Plus | 128K | 8K | 文本、图片 |
| `qwen-coder-plus` | Qwen Coder Plus | 128K | 8K | 代码 |
| `qwen-turbo` | Qwen Turbo | 32K | 8K | 快速响应 |

---

## OpenRouter 配置

### 1. 获取 API Key

1. 访问 [OpenRouter](https://openrouter.ai/)
2. 注册并登录
3. 在「Keys」中创建 API Key

### 2. 配置

```bash
# 环境变量
echo 'OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx' >> ~/.hermes/.env

# 命令行
hermes config set OPENROUTER_API_KEY sk-or-v1-xxx...
```

### 3. 推荐模型

| 模型 | 用途 | 价格 |
|------|------|------|
| `anthropic/claude-3.5-sonnet` | 通用对话 | 中 |
| `google/gemini-2.0-flash-thinking-exp` | 推理 | 低 |
| `anthropic/claude-sonnet-4` | 编程 | 中 |
| `deepseek/deepseek-chat-v3` | 性价比 | 低 |

---

## Kimi 配置

### 1. 获取 API Key

1. 访问 [Moonshot 控制台](https://platform.moonshot.cn/)
2. 注册并登录
3. 在「API Keys」中创建

### 2. 配置

```bash
# 环境变量
echo 'MOONSHOT_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx' >> ~/.hermes/.env

# 命令行
hermes config set MOONSHOT_API_KEY sk-xxx...
```

### 3. 可用模型

| 模型 | 上下文 | 最大输出 |
|------|--------|----------|
| `moonshot-v1-8k` | 8K | 8K |
| `moonshot-v1-32k` | 32K | 32K |
| `moonshot-v1-128k` | 128K | 32K |

---

## 多提供商配置

可以同时配置多个提供商，Hermes 会按优先级选择：

```bash
# ~/.hermes/.env

# 主提供商
DASHSCOPE_API_KEY=sk-sp-xxx...

# 备用提供商
OPENROUTER_API_KEY=sk-or-xxx...
MOONSHOT_API_KEY=sk-xxx...
```

或在 config.yaml 中配置优先级：

```yaml
model:
  provider: bailian
  fallback:
    - openrouter
    - moonshot
  temperature: 0.7
  max_tokens: 8192
```

---

## 模型参数配置

### 全局参数

```yaml
model:
  temperature: 0.7      # 创造性 (0-2)
  max_tokens: 8192       # 最大输出
  top_p: 1.0            # 核采样
  frequency_penalty: 0   # 频率惩罚
  presence_penalty: 0   # 存在惩罚
```

### 按提供商参数

```yaml
providers:
  bailian:
    temperature: 0.8
    max_tokens: 16384
  openrouter:
    temperature: 0.7
    max_tokens: 8192
```

---

## 图像理解配置

启用图像理解：

```bash
hermes config set model.vision true
```

或使用支持视觉的模型：

```bash
hermes model add bailian \
  --model qwen-vl-plus \
  --vision
```

---

## 完整配置示例

### 环境变量

```bash
# 阿里百炼（推荐国内）
DASHSCOPE_API_KEY=sk-sp-xxxxxxxxxxxxxxxxxxxxxxxx
DASHSCOPE_BASE_URL=https://coding.dashscope.aliyuncs.com/v1

# OpenRouter（国际）
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx

# 默认模型
HERMES_MODEL=qwen3.5-plus
HERMES_TEMPERATURE=0.7
HERMES_MAX_TOKENS=8192
```

### YAML 配置

```yaml
model:
  provider: bailian
  name: qwen3.5-plus
  temperature: 0.7
  max_tokens: 8192
  top_p: 1.0
  frequency_penalty: 0
  presence_penalty: 0
  vision: true
  
  fallback:
    - provider: openrouter
      model: anthropic/claude-3.5-sonnet
    - provider: moonshot
      model: moonshot-v1-32k

providers:
  bailian:
    api_key: ${DASHSCOPE_API_KEY}
    base_url: https://coding.dashscope.aliyuncs.com/v1
    models:
      - qwen3.5-plus
      - qwen-plus
      - qwen-coder-plus
      
  openrouter:
    api_key: ${OPENROUTER_API_KEY}
    base_url: https://openrouter.ai/api/v1
    
  moonshot:
    api_key: ${MOONSHOT_API_KEY}
    base_url: https://api.moonshot.cn/v1
```

---

## 测试模型

```bash
# 测试当前模型
hermes chat -q "你好，请介绍自己"

# 测试特定模型
hermes model probe --provider bailian --model qwen3.5-plus

# 查看模型列表
hermes model list

# 查看提供商状态
hermes provider status
```

---

## 故障排除

### API Key 无效

```
Error: Invalid API key
```

解决方案：
1. 检查 API Key 是否正确
2. 确认 API Key 未过期
3. 检查 API Key 是否有权限

### 网络连接问题

```
Error: Connection timeout
```

解决方案：
1. 检查网络连接
2. 确认 API 端点可访问
3. 配置代理（如需要）

### 额度不足

```
Error: Insufficient quota
```

解决方案：
1. 检查账户余额/配额
2. 升级账户套餐
3. 切换到其他提供商
