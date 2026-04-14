---
name: hermes-install
description: Complete Hermes Agent installation and migration guide. Use when user wants to install Hermes Agent, migrate from OpenClaw to Hermes, configure Feishu/Lark channel on Hermes, enable YOLO mode, or learn about Hermes Agent capabilities. Triggers include requests to "install hermes", "migrate from openclaw", "setup feishu on hermes", "hermes yolo mode", or any question about Hermes Agent installation, migration, or configuration.
allowed-tools: Bash(echo), Bash(curl), Bash(git), Bash(source), Bash(hermes), Bash(export), Bash(mkdir), Bash(ln), Bash(grep), Bash(cat), Bash(cp), Bash(mv), Bash(pwd), Bash(ls), Bash(cd)
---

# Hermes Agent 安装与 OpenClaw 迁移指南

## 目录

1. [Hermes Agent 简介](#1-hermes-agent-简介)
2. [快速安装 Hermes](#2-快速安装-hermes)
3. [手动安装步骤](#3-手动安装步骤)
4. [模型配置](#4-模型配置)
5. [飞书/Lark Channel 配置](#5-飞书lark-channel-配置)
6. [从 OpenClaw 迁移](#6-从-openclaw-迁移)
7. [YOLO 模式](#7-yolo-模式)
8. [验证与测试](#8-验证与测试)

---

## 1. Hermes Agent 简介

**Hermes Agent** 是 Nous Research 开发的自改进 AI agent（GitHub 25,000+ Stars）。

### 核心特性

| 特性 | 说明 |
|------|------|
| 自改进能力 | 内置学习循环，从经验中创建和优化 skills |
| 多模型支持 | OpenRouter (200+)、阿里百炼、Kimi、MiniMax 等 |
| 多消息平台 | Telegram、Discord、Slack、飞书、企业微信等 |
| OpenClaw 迁移 | 一键迁移配置 |

### 支持的消息平台

| 平台 | 语音 | 图片 | 文件 | 流式 | 打字状态 |
|------|------|------|------|------|----------|
| **飞书/Lark** | ✅ | ✅ | ✅ | ✅ | ✅ |
| Telegram | ✅ | ✅ | ✅ | ✅ | ✅ |
| Discord | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 2. 快速安装 Hermes

### 2.1 环境要求

- Linux / macOS / WSL2
- Git 已安装

**Windows 用户**: 需要安装 WSL2

### 2.2 一键安装命令

```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
```

### 2.3 安装后配置

```bash
# 重新加载 shell
source ~/.bashrc   # Bash
# 或
source ~/.zshrc    # Zsh

# 验证安装
hermes version

# 运行诊断
hermes doctor

# 开始对话
hermes
```

---

## 3. 手动安装步骤

如果一键安装失败，使用以下手动步骤：

### 3.1 克隆仓库

```bash
git clone --recurse-submodules https://github.com/NousResearch/hermes-agent.git
cd hermes-agent
```

### 3.2 安装 uv 和依赖

```bash
# 安装 uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# 创建虚拟环境
uv venv venv --python 3.11

# 安装依赖
export VIRTUAL_ENV="$(pwd)/venv"
uv pip install -e ".[all]"
```

### 3.3 配置目录

```bash
mkdir -p ~/.hermes/{cron,sessions,logs,memories,skills,pairing,hooks,image_cache,audio_cache}

cp cli-config.yaml.example ~/.hermes/config.yaml
touch ~/.hermes/.env
```

### 3.4 添加到 PATH

```bash
mkdir -p ~/.local/bin
ln -sf "$(pwd)/venv/bin/hermes" ~/.local/bin/hermes
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

---

## 4. 模型配置

### 4.1 支持的模型提供商

| 提供商 | 环境变量 | 说明 |
|--------|----------|------|
| **阿里百炼** | `DASHSCOPE_API_KEY` | 通义千问等 |
| OpenRouter | `OPENROUTER_API_KEY` | 200+ 模型 |
| OpenAI | `OPENAI_API_KEY` | GPT 系列 |
| Kimi | `MOONSHOT_API_KEY` | Moonshot AI |

### 4.2 配置阿里百炼模型

#### 方式一：环境变量

```bash
echo 'DASHSCOPE_API_KEY=your-api-key-here' >> ~/.hermes/.env
```

#### 方式二：命令行

```bash
hermes config set DASHSCOPE_API_KEY your-api-key-here
```

#### 方式三：交互式配置

```bash
hermes model
```

### 4.3 阿里百炼配置示例

```bash
# API 端点
DASHSCOPE_BASE_URL=https://coding.dashscope.aliyuncs.com/v1

# API Key
DASHSCOPE_API_KEY=sk-sp-xxxxxxxxxxxxxxxxxxxxxxxx

# 默认模型
HERMES_MODEL=qwen3.5-plus
```

### 4.4 模型提供商配置

```bash
# 添加阿里百炼提供商
hermes model add bailian \
  --base-url https://coding.dashscope.aliyuncs.com/v1 \
  --api-key your-api-key \
  --model qwen3.5-plus

# 切换模型
hermes config set model.provider bailian
hermes config set model.name qwen3.5-plus
```

---

## 5. 飞书/Lark Channel 配置

### 5.1 创建飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/app)
2. 创建企业自建应用
3. 获取 `App ID` 和 `App Secret`

### 5.2 配置应用权限

添加以下权限：
- `im:message:readonly_v2` - 获取消息
- `im:message` - 发送消息
- `im:group` - 群组管理
- `contact:user.base:readonly` - 用户信息

### 5.3 配置事件订阅

开启长连接模式，添加事件：
- `im.message.receive_v1`

### 5.4 配置飞书 Channel

```bash
# 交互式配置
hermes gateway setup
# 选择 Feishu/Lark

# 或命令行配置
hermes config set channels.feishu.enabled true
hermes config set channels.feishu.app_id cli_xxxxxxxxxxxxxxxx
hermes config set channels.feishu.app_secret xxxxxxxxxxxxxxxx
hermes config set channels.feishu.connection_mode websocket
```

### 5.5 飞书配置完整示例

```bash
# 飞书凭证
FEISHU_APP_ID=cli_a9313c23ceb89cc9
FEISHU_APP_SECRET=QqFPtgoisISbwzZYZnguoXfdrZTcK6D2

# 连接设置
FEISHU_CONNECTION_MODE=websocket
FEISHU_BOT_NAME=Hermes Bot

# 安全策略
FEISHU_DM_POLICY=pairing
FEISHU_GROUP_POLICY=open
FEISHU_REQUIRE_MENTION=true
```

---

## 6. 从 OpenClaw 迁移

### 6.1 自动迁移命令

```bash
# 交互式迁移（完整迁移）
hermes claw migrate

# 预览迁移内容
hermes claw migrate --dry-run

# 迁移但排除密钥
hermes claw migrate --preset user-data

# 覆盖已有冲突
hermes claw migrate --overwrite
```

### 6.2 迁移内容对照

| OpenClaw | Hermes | 说明 |
|----------|--------|------|
| `openclaw.json` | `~/.hermes/.env` | 配置 |
| SOUL.md | `~/.hermes/soul.md` | 人格 |
| MEMORY.md | `~/.hermes/memories/` | 记忆 |
| USER.md | `~/.hermes/memories/` | 用户画像 |
| AGENTS.md | `~/.hermes/context/` | 工作区说明 |
| Skills | `~/.hermes/skills/` | 技能 |
| 飞书配置 | `FEISHU_*` | 环境变量 |

### 6.3 手动迁移步骤

如果自动迁移失败，使用以下手动迁移：

```bash
# 1. 迁移人格文件
cp ~/.openclaw/agents/main/SOUL.md ~/.hermes/soul.md

# 2. 迁移记忆
cp -r ~/.openclaw/agents/main/memories/* ~/.hermes/memories/

# 3. 迁移 Skills
cp -r ~/.openclaw/agents/main/skills/* ~/.hermes/skills/

# 4. 迁移工作区配置
cp ~/.openclaw/agents/main/AGENTS.md ~/.hermes/context/

# 5. 迁移 API Keys
# 从 openclaw.json 提取并添加到 ~/.hermes/.env
```

### 6.4 迁移 API Keys

从 OpenClaw 的 `openclaw.json` 中提取密钥：

```bash
# 模型 API Key
hermes config set DASHSCOPE_API_KEY sk-xxx...

# 飞书凭证
hermes config set FEISHU_APP_ID cli_xxx...
hermes config set FEISHU_APP_SECRET xxx...
```

### 6.5 迁移后验证

```bash
# 检查状态
hermes status

# 验证记忆
hermes memory list

# 验证 skills
hermes skills list

# 测试对话
hermes chat -q "你好"
```

---

## 7. YOLO 模式

### 7.1 什么是 YOLO 模式

YOLO (You Only Live Once) 模式允许 Agent 跳过命令审批流程，自动执行操作，提升自动化效率。

### 7.2 YOLO vs 标准模式

| 特性 | 标准模式 | YOLO 模式 |
|------|----------|-----------|
| 命令审批 | 每次确认 | 自动执行 |
| 执行速度 | 较慢 | 快速 |
| 安全性 | 高 | 需信任 |

### 7.3 适用场景

**适合开启 YOLO：**
- 本地开发环境
- 自动化脚本
- 无人值守任务
- 熟悉 Hermes 后

**不建议开启：**
- 首次使用
- 共享/公共机器
- 执行敏感操作

### 7.4 开启 YOLO 模式

#### 方式一：环境变量

```bash
# 临时开启
export HERMES_YOLO=true

# 永久开启
echo 'HERMES_YOLO=true' >> ~/.hermes/.env
```

#### 方式二：命令行

```bash
# 开启
hermes config set yolo.enabled true

# 关闭
hermes config set yolo.enabled false

# 查看状态
hermes config get yolo.enabled
```

#### 方式三：配置文件

编辑 `~/.hermes/config.yaml`:

```yaml
yolo:
  enabled: true
  allowed_commands:
    - read
    - write
    - search
    - execute
  denied_patterns:
    - "^rm -rf /"
    - "^dd "
    - "^mkfs"
```

### 7.5 YOLO 安全建议

```yaml
yolo:
  enabled: true
  # 限制命令范围
  allowed_commands:
    - read
    - write
    - search
  
  # 命令黑名单
  denied_patterns:
    - "^rm -rf /"
    - "^dd "
    - "^fdisk"
  
  # 目录限制
  allowed_dirs:
    - ~/projects
    - /tmp/hermes
  denied_dirs:
    - /
    - /root
  
  # 审计日志
  audit_log: ~/.hermes/logs/yolo-audit.log
```

### 7.6 YOLO 测试

```bash
# 测试运行
hermes chat -q "帮我创建测试文件" --dry-run

# 限制命令范围
hermes chat -q "帮我创建测试文件" --yolo --allowed-commands read,write
```

---

## 8. 验证与测试

### 8.1 基础验证

```bash
# 检查安装
hermes version

# 运行诊断
hermes doctor

# 检查状态
hermes status
```

### 8.2 模型验证

```bash
# 测试模型
hermes model probe

# 测试对话
hermes chat -q "你好"
```

### 8.3 飞书验证

```bash
# 检查飞书
hermes gateway status feishu

# 测试连接
hermes gateway probe feishu
```

### 8.4 Gateway 管理

```bash
# 启动 Gateway
hermes gateway start

# 查看状态
hermes gateway status

# 查看日志
hermes gateway logs

# 停止
hermes gateway stop
```

### 8.5 常见问题

| 问题 | 解决方案 |
|------|----------|
| `command not found` | `source ~/.bashrc` 或检查 PATH |
| API key 未设置 | `hermes model` 配置 |
| 飞书连接失败 | 检查 App ID/Secret |
| 配置丢失 | `hermes config check` |

### 8.6 更新 Hermes

```bash
# 检查更新
hermes update --check

# 执行更新
hermes update
```

---

## 参考链接

| 资源 | 链接 |
|------|------|
| Hermes 官网 | https://hermes-agent.nousresearch.com |
| GitHub | https://github.com/NousResearch/hermes-agent |
| 官方文档 | https://hermes-agent.nousresearch.com/docs/ |
| Discord | https://discord.gg/NousResearch |
| Skills 市场 | https://agentskills.io |

---

## 快速参考命令

```bash
# 安装
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

# 配置模型
hermes model

# 配置飞书
hermes gateway setup

# 迁移 OpenClaw
hermes claw migrate

# 开启 YOLO
hermes config set yolo.enabled true

# 验证
hermes doctor

# 开始对话
hermes
```
