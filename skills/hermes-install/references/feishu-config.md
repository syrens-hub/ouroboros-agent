# 飞书/Lark Channel 详细配置参考

## 飞书应用配置步骤

### 1. 创建飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/app)
2. 点击「创建企业自建应用」
3. 填写应用信息：
   - 应用名称：Hermes Bot
   - 应用描述：Hermes AI Agent
   - 应用图标：可选

### 2. 获取凭证

在「凭证与基础信息」中获取：
- **App ID**: `cli_xxxxxxxxxxxxxxxx`
- **App Secret**: `xxxxxxxxxxxxxxxxxxxxxxxx`

### 3. 配置权限

在「权限管理」中添加以下权限：

| 权限名称 | 权限标识 | 用途 |
|----------|----------|------|
| 获取用户发给机器人的单聊消息 | `im:message:readonly_v2` | 接收消息 |
| 获取群组中所有消息 | `im:message:readonly` | 群消息 |
| 发送消息 | `im:message` | 发送回复 |
| 获取与更新群信息 | `im:group` | 群组管理 |
| 使用机器人 | `im:chat:bot` | 机器人功能 |
| 获取用户基础信息 | `contact:user.base:readonly` | 用户识别 |

### 4. 配置事件订阅

1. 在「事件订阅」中
2. 选择「长连接」模式（推荐）
3. 添加事件：
   - `im.message.receive_v1` - 接收消息

### 5. 发布应用

1. 在「版本管理与发布」中
2. 创建版本
3. 申请发布
4. 管理员审核通过

---

## Hermes 飞书配置

### 环境变量配置

```bash
# 飞书凭证（必填）
FEISHU_APP_ID=cli_a9313c23ceb89cc9
FEISHU_APP_SECRET=QqFPtgoisISbwzZYZnguoXfdrZTcK6D2

# 连接模式
FEISHU_CONNECTION_MODE=websocket  # 或 webhook

# 机器人名称
FEISHU_BOT_NAME=Hermes Bot

# 安全策略
FEISHU_DM_POLICY=pairing  # pairing | allow | deny
FEISHU_GROUP_POLICY=open   # open | allow | deny

# @ 提及要求
FEISHU_REQUIRE_MENTION=true  # 群聊是否需要 @ 机器人
```

### 命令行配置

```bash
# 启用飞书
hermes config set channels.feishu.enabled true

# 设置凭证
hermes config set channels.feishu.app_id cli_xxxxxxxxxxxxxxxx
hermes config set channels.feishu.app_secret xxxxxxxxxxxxxxxx

# 设置连接模式
hermes config set channels.feishu.connection_mode websocket

# 设置安全策略
hermes config set channels.feishu.dm_policy pairing
hermes config set channels.feishu.group_policy open
hermes config set channels.feishu.require_mention true
```

### Webhook 模式配置

如果使用 Webhook 而非长连接：

```bash
# 获取 Webhook URL
hermes gateway webhook-url feishu

# 配置 Webhook URL
hermes config set channels.feishu.webhook_url https://your-domain.com/feishu/webhook

# 设置签名密钥
hermes config set channels.feishu.verification_token your-token
hermes config set channels.feishu.encrypt_key your-encrypt-key
```

---

## 安全配置

### 用户白名单

```bash
# 允许特定用户
hermes config set channels.feishu.allowed_users user_id_1,user_id_2

# 或使用环境变量
FEISHU_ALLOWED_USERS=ou_xxx,ou_yyy
```

### 群组白名单

```bash
# 允许特定群组
hermes config set channels.feishu.group_allow_from group_id_1,group_id_2

# 或使用环境变量
FEISHU_GROUP_ALLOW_FROM=oc_xxx,oc_yyy
```

### DM 策略

| 策略 | 说明 |
|------|------|
| `pairing` | 用户需要先配对才能使用（推荐） |
| `allow` | 允许所有用户 |
| `deny` | 拒绝所有 DM |

### 群组策略

| 策略 | 说明 |
|------|------|
| `open` | 允许所有群组 |
| `allow` | 仅允许白名单群组 |
| `deny` | 拒绝所有群组 |

---

## 流式响应配置

```bash
# 启用流式响应
hermes config set channels.feishu.streaming true

# 流式打字指示器
hermes config set channels.feishu.typing_indicator true
```

---

## 错误处理

### 常见错误

| 错误代码 | 说明 | 解决方案 |
|----------|------|----------|
| 99991663 | App ID/Secret 错误 | 检查凭证 |
| 99991668 | 权限不足 | 添加所需权限 |
| 99991400 | 请求频率超限 | 降低请求频率 |

### 日志查看

```bash
# 查看飞书相关日志
hermes logs --channel feishu

# 调试模式
hermes gateway logs --level debug
```

---

## 完整配置示例

### 环境变量 (.env)

```bash
# 飞书应用凭证
FEISHU_APP_ID=cli_a9313c23ceb89cc9
FEISHU_APP_SECRET=QqFPtgoisISbwzZYZnguoXfdrZTcK6D2

# 连接设置
FEISHU_CONNECTION_MODE=websocket
FEISHU_BOT_NAME=Hermes Bot

# 安全设置
FEISHU_DM_POLICY=pairing
FEISHU_GROUP_POLICY=open
FEISHU_REQUIRE_MENTION=true

# 用户白名单
FEISHU_ALLOWED_USERS=

# 群组白名单
FEISHU_GROUP_ALLOW_FROM=

# 流式响应
FEISHU_STREAMING=true
FEISHU_TYPING_INDICATOR=true
```

### YAML 配置 (config.yaml)

```yaml
channels:
  feishu:
    enabled: true
    app_id: cli_a9313c23ceb89cc9
    app_secret: QqFPtgoisISbwzZYZnguoXfdrZTcK6D2
    connection_mode: websocket
    bot_name: Hermes Bot
    
    # 安全策略
    dm_policy: pairing
    group_policy: open
    require_mention: true
    
    # 白名单
    allowed_users: []
    group_allow_from: []
    
    # 响应设置
    streaming: true
    typing_indicator: true
    
    # 高级设置
    message_format: markdown
    max_message_length: 4000
    retry_attempts: 3
    retry_delay: 1000
```
