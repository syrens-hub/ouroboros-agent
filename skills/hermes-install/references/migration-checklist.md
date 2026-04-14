# OpenClaw 到 Hermes 迁移检查清单

## 迁移前准备

### 1. 备份 OpenClaw 配置

```bash
# 备份配置目录
cp -r ~/.openclaw ~/.openclaw.backup.$(date +%Y%m%d)

# 备份关键文件
cp ~/.openclaw/openclaw.json ~/openclaw.json.backup
cp ~/.openclaw/agents/main/SOUL.md ~/SOUL.md.backup
cp ~/.openclaw/agents/main/AGENTS.md ~/AGENTS.md.backup
```

### 2. 收集需要迁移的信息

- [ ] **模型配置**
  - [ ] Provider 名称
  - [ ] API Key
  - [ ] Base URL
  - [ ] 默认模型

- [ ] **飞书配置**
  - [ ] App ID
  - [ ] App Secret
  - [ ] 连接模式
  - [ ] 安全策略

- [ ] **工作区文件**
  - [ ] SOUL.md
  - [ ] AGENTS.md
  - [ ] TOOLS.md
  - [ ] MEMORY.md
  - [ ] USER.md

- [ ] **Skills**
  - [ ] 用户自定义 Skills
  - [ ] Skill 配置

---

## 自动迁移

### 使用 hermes claw migrate

```bash
# 1. 安装/更新 Hermes（如果尚未安装）
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

# 2. 启动迁移
hermes claw migrate

# 3. 预览迁移内容（可选）
hermes claw migrate --dry-run

# 4. 迁移但排除密钥
hermes claw migrate --preset user-data

# 5. 覆盖已有冲突
hermes claw migrate --overwrite
```

---

## 手动迁移

### Step 1: 迁移人格文件 (SOUL.md)

```bash
# 迁移 SOUL.md
cp ~/.openclaw/agents/main/SOUL.md ~/.hermes/soul.md

# 验证
cat ~/.hermes/soul.md
```

### Step 2: 迁移记忆文件

```bash
# 创建记忆目录
mkdir -p ~/.hermes/memories

# 迁移 MEMORY.md（通用记忆）
cp ~/.openclaw/agents/main/memories/MEMORY.md ~/.hermes/memories/

# 迁移 USER.md（用户画像）
cp ~/.openclaw/agents/main/memories/USER.md ~/.hermes/memories/

# 验证
ls -la ~/.hermes/memories/
```

### Step 3: 迁移工作区配置

```bash
# 创建上下文目录
mkdir -p ~/.hermes/context

# 迁移 AGENTS.md
cp ~/.openclaw/agents/main/AGENTS.md ~/.hermes/context/

# 迁移 TOOLS.md
cp ~/.openclaw/agents/main/TOOLS.md ~/.hermes/context/

# 验证
ls -la ~/.hermes/context/
```

### Step 4: 迁移 Skills

```bash
# 检查 OpenClaw skills
ls -la ~/.openclaw/agents/main/skills/

# 创建 Hermes skills 目录
mkdir -p ~/.hermes/skills

# 复制 skills
cp -r ~/.openclaw/agents/main/skills/* ~/.hermes/skills/

# 验证
hermes skills list
```

### Step 5: 迁移模型配置

从 `openclaw.json` 提取模型配置：

```bash
# 读取 OpenClaw 模型配置
cat ~/.openclaw/openclaw.json | grep -A 20 '"models"'
```

常见模型配置迁移：

| OpenClaw | Hermes | 说明 |
|----------|--------|------|
| `models.providers.coze` | `DASHSCOPE_API_KEY` | 百炼 |
| `models.providers.openai` | `OPENAI_API_KEY` | OpenAI |
| `models.providers.anthropic` | `ANTHROPIC_API_KEY` | Anthropic |

配置示例：

```bash
# 阿里百炼
hermes config set DASHSCOPE_API_KEY sk-sp-xxx...

# OpenRouter
hermes config set OPENROUTER_API_KEY sk-or-xxx...

# 设置默认模型
hermes config set model.provider bailian
hermes config set model.name qwen3.5-plus
```

### Step 6: 迁移飞书配置

从 `openclaw.json` 提取飞书配置：

```bash
# 读取 OpenClaw 飞书配置
cat ~/.openclaw/openclaw.json | grep -A 15 '"feishu"'
```

配置示例：

```bash
# 飞书凭证
hermes config set channels.feishu.enabled true
hermes config set channels.feishu.app_id cli_xxx...
hermes config set channels.feishu.app_secret xxx...

# 连接模式
hermes config set channels.feishu.connection_mode websocket

# 安全策略
hermes config set channels.feishu.dm_policy pairing
hermes config set channels.feishu.group_policy open
hermes config set channels.feishu.require_mention true
```

### Step 7: 迁移其他渠道

| OpenClaw | Hermes |
|----------|--------|
| `channels.wecom` | `channels.wecom` |
| `channels.slack` | `channels.slack` |
| `channels.dingtalk` | `channels.dingtalk` |

---

## 配置对照表

### OpenClaw → Hermes 配置映射

| OpenClaw 路径 | Hermes 配置 | 说明 |
|---------------|-------------|------|
| `models.providers.*.apiKey` | `{PROVIDER}_API_KEY` | API 密钥 |
| `models.providers.*.baseUrl` | `{PROVIDER}_BASE_URL` | API 端点 |
| `agents.defaults.model.primary` | `model.provider` + `model.name` | 默认模型 |
| `channels.feishu.appId` | `channels.feishu.app_id` | 飞书 App ID |
| `channels.feishu.appSecret` | `channels.feishu.app_secret` | 飞书 App Secret |
| `channels.feishu.enabled` | `channels.feishu.enabled` | 启用状态 |
| `gateway.port` | `gateway.port` | 端口 |
| `gateway.auth.token` | `gateway.auth.token` | 认证令牌 |

---

## 迁移后验证

### 1. 验证文件迁移

```bash
# 检查关键文件
ls -la ~/.hermes/soul.md
ls -la ~/.hermes/memories/
ls -la ~/.hermes/context/
ls -la ~/.hermes/skills/
```

### 2. 验证配置

```bash
# 检查 Hermes 状态
hermes status

# 检查模型配置
hermes model list

# 检查飞书配置
hermes gateway status feishu
```

### 3. 测试对话

```bash
# 测试基本对话
hermes chat -q "你好，请介绍一下你自己"

# 测试记忆
hermes chat -q "我上次说过什么？"

# 测试飞书（如果有）
hermes gateway probe feishu
```

### 4. 验证 Skills

```bash
# 列出迁移的 skills
hermes skills list

# 测试某个 skill
/hermes help
```

---

## 常见问题处理

### 1. 迁移后 Skills 不工作

```bash
# 重新索引 skills
hermes skills reindex

# 检查 skill 格式
hermes skills check
```

### 2. 模型调用失败

```bash
# 重新配置模型
hermes model

# 测试模型
hermes model probe
```

### 3. 飞书连接失败

```bash
# 重新配置飞书
hermes gateway setup

# 测试连接
hermes gateway probe feishu
```

### 4. 记忆丢失

```bash
# 检查记忆文件
ls -la ~/.hermes/memories/

# 重新导入记忆
cp ~/openclaw-backup/memories/* ~/.hermes/memories/
```

---

## 迁移完成清单

- [ ] Hermse 安装成功
- [ ] `hermes version` 显示版本号
- [ ] `hermes doctor` 无错误
- [ ] SOUL.md 迁移完成
- [ ] 记忆文件迁移完成
- [ ] 工作区配置迁移完成
- [ ] Skills 迁移完成
- [ ] 模型配置完成
- [ ] 飞书配置完成
- [ ] 基本对话测试通过
- [ ] 渠道连接测试通过

---

## 回滚指南

如果迁移出现问题：

```bash
# 1. 停止 Hermes
hermes gateway stop

# 2. 恢复 OpenClaw 备份
cp -r ~/.openclaw.backup.* ~/.openclaw

# 3. 删除 Hermes 配置
rm -rf ~/.hermes

# 4. 重新安装 Hermes（可选）
# curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
```

---

## 参考资源

- [Hermes 官方文档](https://hermes-agent.nousresearch.com/docs/)
- [OpenClaw 迁移指南](https://hermes-agent.nousresearch.com/docs/getting-started/migrating-from-openclaw)
- [Hermes Discord](https://discord.gg/NousResearch)
