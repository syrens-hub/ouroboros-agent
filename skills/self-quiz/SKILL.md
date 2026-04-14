---
name: self-quiz
description: 自我评估Quiz闭环。每次重大任务完成后或每周复盘时，通过Quiz自测验证是否真正掌握了新知识/技能，填补认知盲点。
---

# Self-Quiz - 自我评估闭环

> 赤犬不只记录学习，还通过Quiz验证是否真正掌握。发现薄弱点 → 针对性强化 → 再次Quiz验证。

## Quiz 触发机制

| 触发条件 | 时机 | 内容 |
|---------|------|------|
| 重大任务完成 | 任务结束后 | 任务涉及的核心知识点 |
| 每周复盘 | 周日 00:05 | 本周学习的技能验证 |
| 月度复盘 | 每月1日 | 关键能力体系验证 |
| 用户要求 | 随时 | 指定领域 Quiz |

## Quiz 类型

### 1. 概念理解 Quiz（每次3题）
```
[单选] <概念描述>
A. 正确
B. 错误
C. 不确定

答案：B
解释：<概念的真实情况>
关联：<相关已学内容>
```

### 2. 技能实操 Quiz（每次2题）
```
[实操] <具体场景描述>

你的方案是什么？（思考后回答）

参考答案：<最优方案>
差距分析：<你的回答 vs 参考答案>
```

### 3. 知识盲点 Quiz（每次3题）
```
[判断] "<常见误解>"

答案：错误
真相：<事实>
这个误解说明：<我的认知盲点在哪里]
```

## Quiz 结果处理

```
Quiz 完成
    ↓
得分 < 60% → 标记为薄弱项 → 加入下周学习计划
得分 60-80% → 复习即可
得分 > 80% → 标记为已掌握 → 从当前学习计划移除
    ↓
薄弱项 → 写入 learnings/weak-points.md
已掌握 → 写入 learnings/mastered.md
```

## 题目来源

从三个地方自动生成 Quiz 题目：

1. **learnings/weak-points.md** - 历史上的薄弱项定期重测
2. **本周新学的 skills/agent** - 验证是否真正学会
3. **MEMORY.md 的关键决策** - 验证决策是否正确

## Quiz 流程（ cron 驱动）

```
周日 00:05: claw-evolution 跑完周报
        ↓
周日 00:10: 触发 Self-Quiz（读取 learnings/weak-points.md）
        ↓
Quiz 完成 → 输出结果 → 写入 learnings/quiz-results.md
        ↓
薄弱项 → 更新 learnings/weak-points.md
        ↓
周一 04:00: 记忆整合时读到 Quiz 结果 → 针对性强化
```

## 典型 Quiz 会话

```
赤犬：[Quiz时间到] 本周你完成了 agency-agents 导入任务。
      我们来做3道Quiz验证是否真正掌握了这个技能。

Q1. [单选] agency-agents 的多 Agent 协作优势是什么？
A. 手动切换角色
B. 多 Agent 并发，汇总交付
C. 只能单 Agent 执行
答案：B ✓

Q2. [实操] 如果用户说"帮我做一个电商技术方案"，
     赤犬会组建哪些 Agent？
你的回答：[等待回答]
参考：frontend-developer + backend-architect + security-engineer + product-manager
差距：[评估中]
```

## 写入记忆

Quiz 结果自动追加到 `learnings/quiz-results.md`：

```markdown
## Quiz 结果 - YYYY-MM-DD

| 题目 | 类型 | 结果 |
|------|------|------|
| agency-agents 多Agent协作 | 概念 | ✅ 80% |
| 电商方案 Agent组建 | 实操 | ⚠️ 60% |
| 知识盲点测试 | 判断 | ✅ 90% |

薄弱项：电商方案的 frontend-developer 角色定义需要补充
下次 Quiz 重点：分布式系统设计要点
```
