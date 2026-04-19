# ADR 002: Permission Engine v2 — 多源规则引擎

| 属性 | 值 |
|---|---|
| **标题** | Permission Engine v2 — 多源规则引擎 |
| **状态** | Accepted |
| **日期** | 2026-04-19 |
| **作者** | Ouroboros Maintainers |

---

## 上下文（Context）

Ouroboros Agent 作为一个自修改 AI Agent 系统，其安全性核心在于**精细控制 AI 可调用的工具（tools）权限**。随着系统演进，权限规则的来源日益复杂：

- **CLI 启动参数**：`--allow-tool=read:* --deny-tool=exec:*`
- **项目级配置**：`.ouroboros/permissions.json`（随仓库共享，定义项目边界）
- **会话级覆盖**：用户或管理员在运行时的临时权限调整
- **全局设置文件**：`~/.ouroboros/settings.json` 中的个人默认偏好

早期版本采用单一配置文件模型，导致：
1. 无法区分"临时会话限制"与"项目硬性约束"
2. 规则冲突时行为不可预测
3. 缺乏对工具名称的通配符/模式匹配支持

我们需要一个明确的优先级模型和可扩展的规则匹配机制。

---

## 决策（Decision）

我们决定实现 **Permission Engine v2**，一个 4 源层级规则引擎：

```
优先级（高 → 低）：
  CLI 参数  →  项目配置 (.ouroboros/permissions.json)  →  会话覆盖  →  全局设置
```

**核心机制**：

1. **4 源合并策略**：按固定顺序评估，**首个匹配的规则生效**（first match wins）。
2. **Glob 模式匹配**：工具标识符支持 `*` 和 `**` 通配符，例如 `file:read:*` 匹配所有文件读取工具。
3. **显式 Deny 优先**：若同一层级同时存在 allow 与 deny，deny 规则优先于 allow。
4. **不可降级原则**：高层级的 deny 无法被低层级的 allow 覆盖（安全底线）。

**数据结构示例**（`.ouroboros/permissions.json`）：

```json
{
  "version": 2,
  "rules": [
    { "pattern": "core:**", "action": "deny", "reason": "immutable core" },
    { "pattern": "file:read:*", "action": "allow" },
    { "pattern": "network:**", "action": "deny" }
  ]
}
```

**实现位置**：`core/permission-engine.ts`，被 `HookRegistry` 在工具调用前拦截检查。

---

## 权衡（Trade-offs）

### First Match Wins 的优势

- **确定性**：规则评估顺序明确，调试和审计可复现。
- **性能**：无需复杂的最长匹配算法，线性扫描即可（规则总量通常 < 50 条）。
- **直觉性**：与 CSS 层叠、防火墙规则等常见模型一致，降低学习成本。

### First Match Wins 的劣势

- **顺序敏感**：规则排列错误可能导致意外放行或拒绝。
- **无自动冲突检测**：工程层面无法静态发现"互相覆盖"的规则对。

---

## 后果（Consequences）

### 积极后果

1. **灵活的权限模型**：同一仓库可在不同环境（CI / 个人开发 / 生产）施加不同的约束，无需修改代码。
2. **安全与便利的平衡**：CLI 可临时收紧权限进行危险操作；项目配置可保护核心文件。
3. **审计友好**：每次工具调用前，Permission Engine 输出匹配到的规则来源与原因，便于追溯。
4. **向后兼容**：v1 配置文件自动升级至 v2 schema，无需用户手动迁移。

### 消极后果与缓解措施

| 风险 | 缓解措施 |
|---|---|
| 优先级规则可能令用户困惑 | 提供 `npx ouroboros permissions --explain` 命令，可视化当前有效规则及来源 |
| Glob 模式性能（`**` 递归） | 限制模式深度（最大 3 级）；缓存编译后的 RegExp |
| 会话覆盖被恶意利用 | 会话级规则仅对当前进程生效；敏感 deny 需二次确认（TUI 提示） |
| 规则过多导致评估变慢 | 引入规则索引（按 prefix hash）；实测 100 条规则评估 < 0.1ms |

### 中立后果

- 文档和维护成本上升：需要在用户手册中专门解释 4 源优先级和 Glob 语法。
- 测试矩阵扩大：需覆盖 4 种来源 × 2 种动作 × 多种模式组合的交叉场景。

---

## 替代方案（Alternatives Considered）

### 替代 A：纯代码白名单（硬编码 allow list）

- **拒绝原因**：过于僵化，无法适应不同部署场景；每次新增工具需改源码并重发版本，违背自修改系统的灵活性目标。

### 替代 B：最后匹配 wins（last match overrides）

- **拒绝原因**：与大多数开发者直觉相反（CSS、iptables 均为 first match 或 specificity 模型），易引入安全漏洞。

### 替代 C：基于角色的访问控制（RBAC）

- **拒绝原因**：引入 Role、Group 等概念对单用户 Agent 系统过度设计；当前阶段 Pattern-based ACL 足够表达力且更简单。

---

## 相关文档

- [权限配置参考](../permissions.md)
- [安全模型总览](../security-model.md)
- `core/permission-engine.ts`
- `core/types/permissions.ts`
- `.ouroboros/permissions.schema.json`

---

## 修订历史

| 日期 | 修订人 | 说明 |
|---|---|---|
| 2026-04-19 | Maintainers | 初始版本，Accepted |
