# OpenClaw Enhanced Plugin

OpenClaw 增强插件，为你的 AI 助手添加 Claude Code 风格的智能能力。

## 功能特性

### 🛠️ 自我修复系统

- **异常检测与分类**：自动识别 Rate Limit、Timeout、Context Length、Network 等错误类型
- **自动快照管理**：在关键操作前自动创建状态快照
- **智能回滚机制**：当检测到连续失败时自动回滚到稳定状态
- **错误恢复策略**：根据错误类型自动应用最佳恢复策略

### 🧠 人格发展系统

- **10 维人格特征**：好奇心、创造力、稳定性、适应性、幽默感、正式度、直接性、乐观度、谨慎度、社交能力
- **8 维价值观体系**：诚实、公平、隐私、效率、质量、安全、创新、协作
- **交互学习**：从用户反馈中持续学习和改进
- **阶段进化**：根据交互次数自动提升进化阶段

### ⚡ 动态终止机制

- **智能 preventContinuation**：类似 Claude Code 的动态终止判断
- **复杂度评估**：自动评估任务复杂度并调整策略
- **Token 优化**：监控 Token 使用情况，优化上下文管理

## 安装

插件已安装在 `~/.openclaw/skills/openclaw-enhanced/`

## 配置

在 `~/.openclaw/openclaw.json` 中添加：

```json
{
  "plugins": {
    "openclaw-enhanced": {
      "enabled": true,
      "selfHealing": {
        "enabled": true,
        "rollbackThreshold": 5
      },
      "personality": {
        "enabled": true,
        "learningRate": 0.1
      }
    }
  }
}
```

## 使用命令

### 自我修复

```
/enhanced repair on      # 启用自我修复
/enhanced repair off     # 禁用自我修复
/enhanced repair status  # 查看修复状态
```

### 快照管理

```
/enhanced snapshot create        # 创建快照
/enhanced snapshot list          # 列出所有快照
/enhanced snapshot rollback <id> # 回滚到指定快照
```

### 人格状态

```
/enhanced personality show      # 显示当前人格状态
/enhanced personality reset      # 重置人格到默认
/enhanced personality traits     # 显示人格特征详情
```

### 复杂度评估

```
/enhanced complexity <task>      # 评估任务复杂度
```

## 数据存储

插件数据存储在 `~/.openclaw/enhanced-data/` 目录：

- `personality.json` - 人格状态数据
- `snapshots.json` - 快照历史记录

## 架构设计

```
┌─────────────────────────────────────────┐
│           OpenClaw Gateway               │
│  ┌─────────────────────────────────┐   │
│  │    OpenClaw Enhanced Plugin       │   │
│  │  ┌─────────┐  ┌─────────────┐   │   │
│  │  │ Self-   │  │ Personality │   │   │
│  │  │ Healing │  │ Evolution   │   │   │
│  │  └─────────┘  └─────────────┘   │   │
│  │  ┌─────────────────────────┐   │   │
│  │  │  Dynamic Termination    │   │   │
│  │  └─────────────────────────┘   │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

## 版本历史

- **v1.0.0** - 初始版本，包含自我修复、人格发展、动态终止功能

## 许可证

MIT License
