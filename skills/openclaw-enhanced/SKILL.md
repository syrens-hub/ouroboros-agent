---
name: openclaw-enhanced
description: OpenClaw 增强插件 - 融合 Claude Code 架构的自我修复与人格发展能力。当用户需要错误处理、人格进化、智能终止或快照管理时使用。
---

# OpenClaw Enhanced

为 OpenClaw 添加 Claude Code 风格的增强能力。

## 功能模块

### 1. 自我修复系统

**错误分类与处理：**
- `rate_limit` - Rate Limit 错误，自动退避重试
- `timeout` - 超时错误，增加超时时间重试
- `context_length` - 上下文过长，创建快照后进行上下文压缩
- `network` - 网络错误，检查连接状态

**快照管理：**
- 自动在关键操作前创建快照
- 支持回滚到任意历史快照
- 保留最近 20 个快照

### 2. 人格发展系统

**10 维人格特征：**
| 特征 | 描述 | 默认值 |
|------|------|--------|
| curiosity | 好奇心 | 0.8 |
| creativity | 创造力 | 0.7 |
| stability | 稳定性 | 0.85 |
| adaptability | 适应性 | 0.75 |
| humor | 幽默感 | 0.5 |
| formality | 正式度 | 0.4 |
| directness | 直接性 | 0.6 |
| optimism | 乐观度 | 0.7 |
| caution | 谨慎度 | 0.6 |
| sociability | 社交能力 | 0.7 |

**8 维价值观：**
| 价值观 | 描述 | 默认值 |
|--------|------|--------|
| honesty | 诚实 | 0.95 |
| fairness | 公平 | 0.9 |
| privacy | 隐私保护 | 0.95 |
| efficiency | 效率 | 0.8 |
| quality | 质量 | 0.9 |
| safety | 安全 | 0.85 |
| innovation | 创新 | 0.75 |
| collaboration | 协作 | 0.8 |

**进化阶段：**
- 阶段 1: 初始阶段 (0-99 次交互)
- 阶段 2: 成长阶段 (100-499 次交互)
- 阶段 3: 成熟阶段 (500+ 次交互)

### 3. 动态终止机制

**复杂度评估等级：**
- `HIGHEST` - 重构、优化、深度思考等复杂任务
- `MIDDLE` - 分析、比较、深入研究
- `BASIC` - 简单分析任务
- `NONE` - 默认配置

**终止条件：**
- 达到最大迭代次数
- 无工具调用且无状态变化
- 检测到停滞

## 使用命令

### 自我修复
```
/enhanced repair on      # 启用自我修复
/enhanced repair off     # 禁用自我修复
/enhanced repair status  # 查看修复状态
```

### 快照管理
```
/enhanced snapshot create          # 创建快照
/enhanced snapshot list            # 列出所有快照
/enhanced snapshot rollback <id>   # 回滚到指定快照
```

### 人格状态
```
/enhanced personality show   # 显示当前人格状态
/enhanced personality reset  # 重置人格到默认
/enhanced personality traits # 显示人格特征详情
```

### 复杂度评估
```
/enhanced complexity <任务描述>  # 评估任务复杂度
```

## 数据存储

- `~/.openclaw/enhanced-data/personality.json` - 人格状态
- `~/.openclaw/enhanced-data/snapshots.json` - 快照历史

## 架构

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

- **v1.0.0** - 初始版本
  - 自我修复与回滚系统
  - 人格发展与进化
  - 动态终止机制
