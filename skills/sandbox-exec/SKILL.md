---
name: sandbox-exec
description: Executes commands with task_id isolation, exit code interpretation, and idle cleanup. Based on Hermes Agent's terminal_tool task isolation pattern.
version: 1.0.0
author: wuzheng
tags: [exec, sandbox, isolation, task-id]
requires_tools: []
---

# Sandbox Exec

A secure exec wrapper that adds **task_id isolation** and **exit code semantic interpretation** to command execution.

## Features

1. **task_id Isolation**: Same task_id reuses the same sandbox environment
2. **Activity Tracking**: Background processes prevent premature idle cleanup
3. **Exit Code Interpretation**: Semantic understanding of common command exit codes
4. **Idle Cleanup**: 300 second timeout for inactive sandboxes

## Usage

### Python API

```python
from scripts.sandbox_manager import (
    get_or_create_sandbox,
    refresh_activity,
    cleanup_sandbox,
    interpret_exit_code
)

# Get or create sandbox for task
sandbox, created = get_or_create_sandbox(
    task_id="session-123",
    create_fn=lambda: {"type": "exec"},
    metadata={"persistent": False}
)

# Execute command with interpretation
import subprocess
result = subprocess.run(["ls", "-la"], capture_output=True)
exit_interp = interpret_exit_code(result.returncode, "ls")
print(f"Exit: {exit_interp}")  # "Success"

# Refresh activity for long-running processes
refresh_activity("session-123")

# Cleanup when done
cleanup_sandbox("session-123")
```

### CLI

```bash
python3 ~/.openclaw/workspace/scripts/sandbox_exec.py <task_id> <command> [args...]

# Example
python3 ~/.openclaw/workspace/scripts/sandbox_exec.py session-123 ls -la
```

## Exit Code Interpretations

| Command | Exit Code | Interpretation |
|---------|-----------|----------------|
| grep/find/rg | 1 | No matches found (not an error) |
| diff | 1 | Files differ (expected, not an error) |
| test/[ | 1 | Condition evaluated to false (not an error) |
| curl | 22 | HTTP error (404, etc.) |
| curl | 28 | Operation timeout |
| git | 1 | Changes or conflicts |
| Any | 0 | Success |

## task_id Best Practices

- Use session key as task_id for session-level isolation
- Use unique task_id per logical operation
- Call `refresh_activity()` for long-running processes
- Set `persistent=True` for background services

## Files

- `scripts/sandbox_manager.py` - Core module
- `scripts/sandbox_exec.py` - CLI wrapper
