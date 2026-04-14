#!/usr/bin/env python3
"""
sandbox_exec_tool.py - OpenClaw Tool Wrapper for Sandbox Exec

This script provides a CLI interface to sandbox_manager for use as an OpenClaw tool.

Usage via exec tool:
    python3 ~/.openclaw/workspace/skills/sandbox-exec/tool.py <task_id> <command> [args...]

Output: JSON with success, output, error, exit_code, exit_interpretation, duration_ms
"""

import sys
import json
import subprocess
import time
import os
from pathlib import Path

# Add scripts to path
WORKSPACE = Path(__file__).parent.parent.parent / "scripts"
sys.path.insert(0, str(WORKSPACE))

from sandbox_manager import (
    SandboxManager,
    get_or_create_sandbox,
    refresh_activity,
    cleanup_sandbox,
    interpret_exit_code,
    get_sandbox_manager
)


def main():
    if len(sys.argv) < 3:
        print(json.dumps({
            "error": "Usage: tool.py <task_id> <command> [args...]"
        }))
        sys.exit(1)
    
    task_id = sys.argv[1]
    command = sys.argv[2]
    args = sys.argv[3:] if len(sys.argv) > 3 else []
    
    full_command = [command] + args
    
    # Get or create sandbox (exec environment)
    mgr = get_sandbox_manager()
    sandbox, created = get_or_create_sandbox(
        task_id,
        create_fn=lambda: {"type": "exec"},
        metadata={
            "persistent": os.getenv("SANDBOX_PERSISTENT", "").lower() == "true"
        }
    )
    
    # Refresh activity before execution
    refresh_activity(task_id)
    
    start_time = time.time()
    
    try:
        # Execute command
        result = subprocess.run(
            full_command,
            capture_output=True,
            text=True,
            timeout=600  # 10 min hard limit
        )
        
        duration = time.time() - start_time
        
        # Refresh activity after successful execution
        refresh_activity(task_id)
        
        # Interpret exit code
        exit_interpretation = interpret_exit_code(result.returncode, command)
        
        response = {
            "success": result.returncode == 0,
            "output": result.stdout,
            "error": result.stderr if result.stderr else None,
            "exit_code": result.returncode,
            "exit_interpretation": exit_interpretation,
            "duration_ms": int(duration * 1000),
            "task_id": task_id
        }
        
        print(json.dumps(response, ensure_ascii=False))
        
    except subprocess.TimeoutExpired:
        duration = time.time() - start_time
        print(json.dumps({
            "success": False,
            "error": f"Command timed out after {duration:.1f}s",
            "exit_code": 124,
            "exit_interpretation": "Operation timeout",
            "duration_ms": int(duration * 1000),
            "task_id": task_id,
            "killed": True
        }, ensure_ascii=False))
        
    except Exception as e:
        duration = time.time() - start_time
        print(json.dumps({
            "success": False,
            "error": str(e),
            "exit_code": -1,
            "exit_interpretation": f"Error: {str(e)}",
            "duration_ms": int(duration * 1000),
            "task_id": task_id
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
