# Hermes Integration Skill

将 Hermes Agent 的6个核心组件集成到 OpenClaw。

## 组件

| 组件 | 文件 | 功能 |
|------|------|------|
| ToolRegistry | `openclaw_tool_registry.py` | 单例工具注册表 |
| SafeWriter | `safe_writer.py` | Daemon防崩溃stdout |
| PersistentAsync | `persistent_async.py` | 持久化事件循环 |
| IterationBudget | `iteration_budget.py` | 迭代预算控制 |
| ContextCompressor | `context_compressor.py` | 上下文压缩 |
| PromptSecurityScanner | `prompt_security_scanner.py` | 安全扫描 |

## 使用方法

### 1. 初始化集成

```python
from scripts.hermes_integration import OpenClawHermesIntegration

integration = OpenClawHermesIntegration(
    max_iterations=90,
    context_threshold=0.50,
    model="kimi/kimi-k2.5",
)
integration.install()
```

### 2. 在 Agent 循环中使用

```python
# 检查上下文压缩
if integration.should_compress(messages):
    messages = integration.compress(messages)

# 迭代预算控制
if not integration.consume_iteration():
    raise RuntimeError("Iteration budget exceeded")

# 安全扫描
if not integration.check_context_security(content):
    raise ValueError("Security violation detected")
```

### 3. 直接使用单个组件

```python
# ToolRegistry
from scripts.openclaw_tool_registry import ToolRegistry, registry_tool

@registry_tool(toolset="my_tools", schema={...})
def my_tool(args):
    return '{"result": "ok"}'

# SafeWriter
from scripts.safe_writer import install_safe_stdio, install_safe_logging
install_safe_stdio()
install_safe_logging()

# PersistentAsync
from scripts.persistent_async import run_async, async_tool

@async_tool
async def my_async_tool(args):
    await do_something()
    return result

# IterationBudget
from scripts.iteration_budget import IterationBudget, budgeted

@budgeted(max_iterations=10)
def my_function():
    pass

# ContextCompressor
from scripts.context_compressor import ContextCompressor
cc = ContextCompressor(model="kimi/kimi-k2.5")
if cc.should_compress_by_tokens(token_count):
    messages = cc.compress(messages)

# PromptSecurityScanner
from scripts.prompt_security_scanner import scan_content, is_safe
if not is_safe(user_input):
    raise ValueError("Prompt injection detected")
```

## 验证

```bash
python3 -c "from scripts.hermes_integration import OpenClawHermesIntegration; i=OpenClawHermesIntegration(); i.install(); print('OK')"
```

## 状态

- **优先级**: P0
- **状态**: ✅ 已集成
- **文件**: `scripts/hermes_integration.py`
- **HEARTBEAT**: 安全扫描已加入每10次心跳
