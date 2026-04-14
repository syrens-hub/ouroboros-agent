# tree-of-thoughts.py
# 思维树(ToT)动态规划系统 - Tree of Thoughts (arXiv:2305.10601)
# 为赤犬实现：规划节点划分、多路径探索、自我评估、回溯机制

import json
import time
import uuid
from enum import Enum
from typing import Any, Callable, Optional
from dataclasses import dataclass, field
from datetime import datetime


class SearchStrategy(Enum):
    DFS = "dfs"           # 深度优先
    BFS = "bfs"           # 广度优先
    BEAM = "beam"         # 集束搜索


class NodeStatus(Enum):
    PENDING = "pending"
    ACTIVE = "active"
    EVALUATED = "evaluated"
    PRUNED = "pruned"
    FAILED = "failed"
    SUCCESS = "success"


@dataclass
class ThoughtNode:
    """思维树中的一个思考节点"""
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    depth: int = 0
    content: str = ""
    parent_id: Optional[str] = None
    children_ids: list = field(default=list)
    status: NodeStatus = NodeStatus.PENDING
    
    # 评估结果
    pros: list = field(default=list)
    cons: list = field(default=list)
    score: float = 0.0
    
    # 元数据
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    evaluated_at: Optional[str] = None
    visit_count: int = 0
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "depth": self.depth,
            "content": self.content,
            "parent_id": self.parent_id,
            "children": self.children_ids,
            "status": self.status.value,
            "pros": self.pros,
            "cons": self.cons,
            "score": self.score,
            "created_at": self.created_at,
            "evaluated_at": self.evaluated_at,
            "visit_count": self.visit_count,
        }


@dataclass
class ToTConfig:
    """ToT系统配置"""
    # 搜索策略
    strategy: SearchStrategy = SearchStrategy.BEAM
    
    # 探索参数
    branching_width: int = 3          # 每个节点生成多少个候选方案
    max_depth: int = 5                # 最大探索深度
    beam_width: int = 3               # 集束搜索宽度（保留top-k）
    
    # 回溯参数
    backtrack_threshold: float = 0.3  # 分数低于此值时触发回溯
    max_retries_per_node: int = 2     # 每个节点最大重试次数
    retry_count: dict = field(default_factory=dict)  # 节点重试计数
    
    # 评估参数
    evaluation_model: str = "default" # 评估用模型
    score_threshold: float = 0.5      # 通过评估的最低分数
    
    # LLM回调（外部注入）
    llm_evaluator: Optional[Callable] = None  # (content, prompt_template) -> dict
    
    def to_dict(self) -> dict:
        return {
            "strategy": self.strategy.value,
            "branching_width": self.branching_width,
            "max_depth": self.max_depth,
            "beam_width": self.beam_width,
            "backtrack_threshold": self.backtrack_threshold,
            "max_retries_per_node": self.max_retries_per_node,
            "score_threshold": self.score_threshold,
        }


class TreeOfThoughts:
    """
    思维树动态规划系统
    
    核心流程：
    1. 规划节点划分器 - 将任务拆分为思考节点
    2. 多路径探索器 - 每个节点生成多个候选方案
    3. 自我评估器 - LLM评估各路径pros/cons/score
    4. 回溯机制 - 路径失败时自动回溯
    5. 搜索策略 - DFS/BFS/Beam可选
    """
    
    def __init__(self, config: Optional[ToTConfig] = None):
        self.config = config or ToTConfig()
        self.nodes: dict[str, ThoughtNode] = {}
        self.root_id: Optional[str] = None
        self.current_id: Optional[str] = None
        self.best_path: list[str] = []
        self.best_score: float = 0.0
        
        # 统计
        self.stats = {
            "nodes_created": 0,
            "nodes_evaluated": 0,
            "backtracks": 0,
            "pruned": 0,
        }
    
    # ===================== 核心API =====================
    
    def solve(self, task: str, 
              generator_fn: Callable[[str, int], list[str]],
              context: Optional[dict] = None) -> dict:
        """
        主入口：解决复杂任务
        
        Args:
            task: 任务描述
            generator_fn: 方案生成函数，输入(当前状态,深度)，输出候选方案列表
            context: 额外上下文
        
        Returns:
            包含 best_solution, path, score, stats
        """
        # 初始化根节点
        self._init_root(task)
        
        # 根据策略执行
        if self.config.strategy == SearchStrategy.DFS:
            self._search_dfs()
        elif self.config.strategy == SearchStrategy.BFS:
            self._search_bfs()
        else:
            self._search_beam()
        
        return self._format_result()
    
    def step(self, task: str) -> ThoughtNode:
        """
        单步执行：用于交互式探索
        创建新节点并评估
        """
        if not self.root_id:
            self._init_root(task)
        
        # 选择要扩展的节点
        node = self._select_node_to_expand()
        
        if not node:
            raise StopIteration("No more nodes to expand")
        
        # 扩展节点
        return self._expand_node(node)
    
    # ===================== 节点管理 =====================
    
    def _init_root(self, task: str):
        """初始化根节点"""
        root = ThoughtNode(
            content=task,
            depth=0,
            status=NodeStatus.ACTIVE,
        )
        self.root_id = root.id
        self.current_id = root.id
        self.nodes[root.id] = root
        self.stats["nodes_created"] += 1
    
    def _add_node(self, content: str, parent_id: str, depth: int) -> ThoughtNode:
        """添加新节点"""
        node = ThoughtNode(
            content=content,
            parent_id=parent_id,
            depth=depth,
            status=NodeStatus.ACTIVE,
        )
        self.nodes[node.id] = node
        self.nodes[parent_id].children_ids.append(node.id)
        self.stats["nodes_created"] += 1
        return node
    
    def _get_node(self, node_id: str) -> ThoughtNode:
        return self.nodes[node_id]
    
    def _get_path_to_root(self, node_id: str) -> list[str]:
        """获取从根到某节点的路径"""
        path = []
        current = node_id
        while current:
            path.append(current)
            current = self.nodes[current].parent_id
        return list(reversed(path))
    
    # ===================== 搜索策略 =====================
    
    def _select_node_to_expand(self) -> Optional[ThoughtNode]:
        """选择下一个要扩展的节点"""
        candidates = [
            n for n in self.nodes.values()
            if n.status in (NodeStatus.PENDING, NodeStatus.ACTIVE)
            and n.depth < self.config.max_depth
        ]
        
        if not candidates:
            return None
        
        # 按策略选择
        if self.config.strategy == SearchStrategy.DFS:
            # 深度优先：选最深节点
            return max(candidates, key=lambda n: n.depth)
        elif self.config.strategy == SearchStrategy.BFS:
            # 广度优先：选最浅节点
            return min(candidates, key=lambda n: n.depth)
        else:
            # 集束搜索：按分数排序
            return sorted(candidates, key=lambda n: n.score, reverse=True)[0]
    
    def _search_dfs(self):
        """深度优先搜索"""
        stack = [self.root_id]
        
        while stack and len(self.nodes) < 100:  # 安全限制
            current_id = stack.pop()
            node = self.nodes[current_id]
            
            if node.depth >= self.config.max_depth:
                self._evaluate_node(node)
                continue
            
            # 生成候选方案
            candidates = self._generate_candidates(node)
            
            if not candidates:
                self._handle_dead_end(node)
                continue
            
            # DFS：逆序入栈保证原顺序处理
            for i, cand in enumerate(reversed(candidates)):
                child = self._add_node(cand, node.id, node.depth + 1)
                stack.append(child.id)
    
    def _search_bfs(self):
        """广度优先搜索"""
        queue = [self.root_id]
        
        while queue and len(self.nodes) < 100:
            current_id = queue.pop(0)
            node = self.nodes[current_id]
            
            if node.depth >= self.config.max_depth:
                self._evaluate_node(node)
                continue
            
            # 生成候选方案
            candidates = self._generate_candidates(node)
            
            if not candidates:
                self._handle_dead_end(node)
                continue
            
            # BFS：全部入队
            for cand in candidates:
                child = self._add_node(cand, node.id, node.depth + 1)
                queue.append(child.id)
    
    def _search_beam(self):
        """集束搜索"""
        active_set = {self.root_id}
        evaluated_count = 0
        
        while active_set and evaluated_count < 20:
            all_candidates = []
            
            # 扩展当前所有活跃节点
            for node_id in list(active_set):
                node = self.nodes[node_id]
                
                if node.depth >= self.config.max_depth:
                    self._evaluate_node(node)
                    evaluated_count += 1
                    active_set.discard(node_id)
                    continue
                
                # 生成候选
                candidates = self._generate_candidates(node)
                
                for cand in candidates:
                    child = self._add_node(cand, node.id, node.depth + 1)
                    all_candidates.append(child)
            
            # 评估所有候选
            if all_candidates:
                for child in all_candidates:
                    self._evaluate_node(child)
                
                # 只保留top-k
                sorted_candidates = sorted(
                    all_candidates,
                    key=lambda n: n.score,
                    reverse=True
                )[:self.config.beam_width]
                
                active_set = {n.id for n in sorted_candidates}
                
                # 其余剪枝
                for child in all_candidates:
                    if child.id not in active_set:
                        child.status = NodeStatus.PRUNED
                        self.stats["pruned"] += 1
    
    # ===================== 候选生成 =====================
    
    def _generate_candidates(self, node: ThoughtNode) -> list[str]:
        """生成候选方案（调用外部generator或使用默认实现）"""
        # 这里可以注入自定义生成器
        # 格式：(parent_content, depth) -> [candidate1, candidate2, ...]
        # 默认实现返回占位符
        
        base_prompt = node.content
        
        # 生成多个不同角度的思考方向
        angles = [
            f"{base_prompt} - 从【可行性】角度分析",
            f"{base_prompt} - 从【效率】角度分析", 
            f"{base_prompt} - 从【风险控制】角度分析",
        ]
        
        return angles[:self.config.branching_width]
    
    # ===================== 评估机制 =====================
    
    def _evaluate_node(self, node: ThoughtNode):
        """评估单个节点"""
        if node.status == NodeStatus.EVALUATED:
            return
        
        node.status = NodeStatus.ACTIVE
        node.visit_count += 1
        
        # 调用LLM评估器（如果有）
        if self.config.llm_evaluator:
            result = self.config.llm_evaluator(
                node.content,
                EVALUATION_PROMPT
            )
            node.pros = result.get("pros", [])
            node.cons = result.get("cons", [])
            node.score = result.get("score", 0.5)
        else:
            # 默认评估逻辑
            self._default_evaluate(node)
        
        node.status = NodeStatus.EVALUATED
        node.evaluated_at = datetime.now().isoformat()
        self.stats["nodes_evaluated"] += 1
        
        # 更新最优解
        if node.score > self.best_score:
            self.best_score = node.score
            self.best_path = self._get_path_to_root(node.id)
    
    def _default_evaluate(self, node: ThoughtNode):
        """默认评估逻辑（无LLM时的fallback）"""
        content = node.content.lower()
        
        # 简单启发式评分
        score = 0.5
        pros = []
        cons = []
        
        # 关键词加分
        positive_kw = ["可行", "高效", "稳妥", "清晰", "完整"]
        negative_kw = ["复杂", "风险", "模糊", "冗余"]
        
        for kw in positive_kw:
            if kw in content:
                score += 0.1
                pros.append(f"包含{kw}要素")
        
        for kw in negative_kw:
            if kw in content:
                score -= 0.1
                cons.append(f"存在{kw}风险")
        
        node.score = max(0.0, min(1.0, score))
        node.pros = pros or ["初步可行"]
        node.cons = cons or []
    
    # ===================== 回溯机制 =====================
    
    def _handle_dead_end(self, node: ThoughtNode):
        """处理死胡同（所有候选都失败）"""
        node.status = NodeStatus.FAILED
        
        # 检查是否需要回溯
        if node.parent_id and node.score < self.config.backtrack_threshold:
            self._backtrack(node.parent_id)
    
    def _backtrack(self, node_id: str):
        """回溯到指定节点"""
        parent = self.nodes.get(node_id)
        if not parent:
            return
        
        self.stats["backtracks"] += 1
        
        # 增加重试计数
        retries = self.config.retry_count.get(node_id, 0) + 1
        self.config.retry_count[node_id] = retries
        
        if retries >= self.config.max_retries_per_node:
            # 重试次数耗尽，剪枝
            parent.status = NodeStatus.PRUNED
            self.stats["pruned"] += 1
            
            # 继续向上回溯
            if parent.parent_id:
                self._backtrack(parent.parent_id)
        else:
            # 重置状态，允许重新探索
            parent.status = NodeStatus.PENDING
            parent.children_ids = [
                c for c in parent.children_ids 
                if self.nodes.get(c, ThoughtNode()).status != NodeStatus.FAILED
            ]
    
    # ===================== 节点扩展（step模式） =====================
    
    def _expand_node(self, node: ThoughtNode) -> ThoughtNode:
        """扩展单个节点"""
        candidates = self._generate_candidates(node)
        
        # 取第一个候选
        child = self._add_node(candidates[0], node.id, node.depth + 1)
        
        # 评估
        self._evaluate_node(child)
        
        self.current_id = child.id
        return child
    
    # ===================== 结果输出 =====================
    
    def _format_result(self) -> dict:
        """格式化最终结果"""
        best_nodes = [self.nodes[nid] for nid in self.best_path]
        
        return {
            "best_solution": best_nodes[-1].content if best_nodes else None,
            "best_path": self.best_path,
            "best_path_contents": [n.content for n in best_nodes],
            "best_score": self.best_score,
            "total_nodes": len(self.nodes),
            "stats": self.stats.copy(),
            "config": self.config.to_dict(),
            "tree": self._export_tree(),
        }
    
    def _export_tree(self) -> dict:
        """导出完整思维树"""
        return {
            "root": self.root_id,
            "nodes": {nid: n.to_dict() for nid, n in self.nodes.items()},
        }
    
    def print_tree(self, node_id: Optional[str] = None, indent: int = 0):
        """打印思维树（调试用）"""
        if node_id is None:
            node_id = self.root_id
        
        if not node_id:
            return
        
        node = self.nodes[node_id]
        prefix = "  " * indent
        
        score_str = f"[{node.score:.2f}]" if node.status == NodeStatus.EVALUATED else "[--]"
        status_icon = {
            NodeStatus.PENDING: "○",
            NodeStatus.ACTIVE: "◐",
            NodeStatus.EVALUATED: "●",
            NodeStatus.PRUNED: "✗",
            NodeStatus.FAILED: "✗",
            NodeStatus.SUCCESS: "✓",
        }.get(node.status, "?")
        
        print(f"{prefix}{status_icon} {score_str} {node.content[:60]}...")
        
        for child_id in node.children_ids:
            self.print_tree(child_id, indent + 1)


# ===================== 评估Prompt模板 =====================

EVALUATION_PROMPT = """
## 角色
你是一位严格的方案评估专家。你的任务是客观评估每个方案的优劣。

## 输入
方案内容：{content}

## 评估标准
请从以下维度评估（每个维度1-10分）：
1. **可行性** - 方案是否实际可执行
2. **效率** - 方案的时间/资源消耗
3. **风险控制** - 方案的潜在风险
4. **完整性** - 方案是否覆盖所有关键点

## 输出格式
请以JSON格式输出：
{
    "pros": ["优点1", "优点2", ...],
    "cons": ["缺点1", "缺点2", ...],
    "scores": {
        "feasibility": X,
        "efficiency": X,
        "risk_control": X,
        "completeness": X
    },
    "overall_score": X.X,  // 0-1之间的综合分数
    "reasoning": "简要推理过程"
}

## 注意事项
- overall_score = (feasibility + efficiency + risk_control + completeness) / 40
- cons应该具体指出问题所在，不要泛泛而谈
- 如果方案有明显漏洞，overall_score不应高于0.5
"""


# ===================== 快速使用示例 =====================

def example_usage():
    """使用示例"""
    
    def custom_generator(parent_content: str, depth: int) -> list[str]:
        """自定义候选生成器"""
        return [
            f"{parent_content} → 方案A（稳健推进）",
            f"{parent_content} → 方案B（快速验证）",
            f"{parent_content} → 方案C（创新尝试）",
        ]
    
    config = ToTConfig(
        strategy=SearchStrategy.BEAM,
        branching_width=3,
        max_depth=3,
        beam_width=2,
        backtrack_threshold=0.3,
    )
    
    tot = TreeOfThoughts(config)
    
    result = tot.solve(
        task="如何提升系统响应速度",
        generator_fn=custom_generator,
    )
    
    print("=" * 50)
    print("最佳方案:", result["best_solution"])
    print("得分:", result["best_score"])
    print("路径:", " → ".join(result["best_path"]))
    print("=" * 50)
    
    tot.print_tree()


if __name__ == "__main__":
    example_usage()
