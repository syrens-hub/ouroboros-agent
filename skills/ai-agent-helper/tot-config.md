# ToT动态规划系统 - 配置指南

## 快速开始

```python
from tree-of-thoughts import TreeOfThoughts, ToTConfig, SearchStrategy

config = ToTConfig(
    strategy=SearchStrategy.BEAM,  # 搜索策略
    branching_width=3,              # 每个节点候选数
    max_depth=5,                    # 最大深度
    beam_width=3,                   # 集束宽度
    backtrack_threshold=0.3,         # 回溯阈值
)

tot = TreeOfThoughts(config)
result = tot.solve(
    task="你的复杂任务",
    generator_fn=your_generator,  # (content, depth) -> [candidates]
)
```

## 配置项详解

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `strategy` | SearchStrategy | BEAM | DFS/BFS/BEAM |
| `branching_width` | int | 3 | 每个节点生成候选数(3-5) |
| `max_depth` | int | 5 | 最大探索深度 |
| `beam_width` | int | 3 | 集束搜索保留数 |
| `backtrack_threshold` | float | 0.3 | 触发回溯的最低分数 |
| `max_retries_per_node` | int | 2 | 节点最大重试次数 |
| `score_threshold` | float | 0.5 | 方案通过评估的最低分 |

## 搜索策略选择

| 策略 | 适用场景 |
|------|---------|
| **DFS深度优先** | 只需找到一个解，资源有限 |
| **BFS广度优先** | 需要探索所有可能性，保证最优性 |
| **BEAM集束搜索** | 平衡探索与利用，推荐作为默认 |

## 注入LLM评估器

```python
config = ToTConfig()
config.llm_evaluator = lambda content, prompt: your_llm_call(content, prompt)
```

评估prompt见 `EVALUATION_PROMPT` 常量。
