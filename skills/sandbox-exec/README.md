# Sandbox Exec Tool - Usage Guide

## Quick Start

### CLI Usage
```bash
python3 ~/.openclaw/workspace/skills/sandbox-exec/tool.py <task_id> <command> [args...]

# Examples
python3 ~/.openclaw/workspace/skills/sandbox-exec/tool.py session-123 ls -la
python3 ~/.openclaw/workspace/skills/sandbox-exec/tool.py task-456 grep pattern file.txt
```

### Python API
```python
import sys
sys.path.insert(0, '~/.openclaw/workspace/scripts')

from sandbox_manager import (
    get_or_create_sandbox,
    refresh_activity,
    interpret_exit_code
)

# Get sandbox
sandbox, created = get_or_create_sandbox(
    task_id="my-task",
    create_fn=lambda: {"type": "exec"},
    metadata={"persistent": False}
)

# Execute with interpretation
import subprocess
result = subprocess.run(["grep", "pattern", "file"], capture_output=True)
exit_interp = interpret_exit_code(result.returncode, "grep")
# exit_interp = "No matches found (not an error)"
```

## Integration with OpenClaw

### Option 1: Direct exec wrapper
Call via exec tool in your prompts:
```
Use sandbox_exec for any file operations:
    python3 ~/.openclaw/workspace/skills/sandbox-exec/tool.py <task_id> <command>
```

### Option 2: Skill-based tool
Import in a custom skill that wraps your frequently-used commands.

## Output Format

```json
{
  "success": true,
  "output": "...",
  "error": null,
  "exit_code": 0,
  "exit_interpretation": "Success",
  "duration_ms": 5,
  "task_id": "session-123"
}
```

## Exit Code Meanings

| Command | Exit | Meaning |
|---------|------|---------|
| grep/find | 1 | No matches (normal) |
| diff | 1 | Files differ (normal) |
| test | 1 | Condition false (normal) |
| curl | 22 | HTTP error |
| curl | 28 | Timeout |
| git | 1 | Changes/conflicts |
| * | 0 | Success |
