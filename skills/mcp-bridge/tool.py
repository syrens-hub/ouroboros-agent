#!/usr/bin/env python3
"""
MCP Bridge Tool - OpenClaw Integration
调用 ~/.openclaw/workspace/scripts/mcp_bridge.py
"""

import json
import subprocess
import sys
import os

def mcp_list_servers() -> str:
    """列出所有配置的MCP服务器"""
    config_path = os.path.expanduser("~/.openclaw/mcp_servers.yaml")
    try:
        with open(config_path) as f:
            import yaml
            config = yaml.safe_load(f)
            servers = config.get('servers', {})
            if not servers:
                return "❌ 没有配置任何MCP服务器\n编辑 ~/.openclaw/mcp_servers.yaml 添加"
            
            result = ["## 已配置的MCP服务器\n"]
            for name, cfg in servers.items():
                result.append(f"• **{name}** ({cfg.get('type', 'stdio')})")
            return "\n".join(result)
    except Exception as e:
        return f"❌ 读取配置失败: {e}"

def mcp_discover_tools(server: str) -> str:
    """发现指定服务器的可用工具"""
    script = os.path.expanduser("~/.openclaw/workspace/scripts/mcp_bridge.py")
    try:
        result = subprocess.run(
            [sys.executable, script, "discover", server],
            capture_output=True, text=True, timeout=30
        )
        return result.stdout or result.stderr
    except Exception as e:
        return f"❌ 发现工具失败: {e}"

def mcp_call_tool(server: str, tool: str, args_json: str = "{}") -> str:
    """调用MCP工具"""
    script = os.path.expanduser("~/.openclaw/workspace/scripts/mcp_bridge.py")
    try:
        args = json.loads(args_json)
        result = subprocess.run(
            [sys.executable, script, "call", server, tool],
            input=json.dumps(args),
            capture_output=True, text=True, timeout=60
        )
        return result.stdout or result.stderr
    except Exception as e:
        return f"❌ 调用失败: {e}"

def mcp_add_server(name: str, server_type: str, command: str, args: str = "[]", url: str = "") -> str:
    """添加新MCP服务器到配置"""
    config_path = os.path.expanduser("~/.openclaw/mcp_servers.yaml")
    try:
        import yaml
        with open(config_path) as f:
            config = yaml.safe_load(f) or {'servers': {}}
        
        new_server = {
            'type': server_type,
            'command': command,
            'args': json.loads(args) if args != "[]" else [],
        }
        if url:
            new_server['url'] = url
        
        config['servers'][name] = new_server
        
        with open(config_path, 'w') as f:
            yaml.dump(config, f, allow_unicode=True)
        
        return f"✅ 已添加MCP服务器: {name}"
    except Exception as e:
        return f"❌ 添加失败: {e}"

if __name__ == "__main__":
    import yaml
    # CLI interface
    if len(sys.argv) < 2:
        print("Usage: mcp_bridge.py [discover|call|add] <args...>")
        sys.exit(1)
    
    cmd = sys.argv[1]
    
    if cmd == "discover":
        if len(sys.argv) < 3:
            print("Usage: mcp_bridge.py discover <server_name>")
            sys.exit(1)
        # For now just list what's in config
        config_path = os.path.expanduser("~/.openclaw/mcp_servers.yaml")
        with open(config_path) as f:
            config = yaml.safe_load(f)
        print(f"可用服务器: {', '.join(config.get('servers', {}).keys())}")
    
    elif cmd == "call":
        if len(sys.argv) < 4:
            print("Usage: mcp_bridge.py call <server> <tool>")
            sys.exit(1)
        print(f"调用 {sys.argv[2]}.{sys.argv[3]}")
        print("(需要完整MCP Bridge运行)")
    
    else:
        print(f"Unknown command: {cmd}")
