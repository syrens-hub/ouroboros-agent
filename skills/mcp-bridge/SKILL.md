---
name: MCP Bridge
version: 1.0.0
description: 统一MCP工具桥接器 - 5分钟接入任何MCP Server
---

## 功能
- 发现并调用MCP服务器工具
- 支持stdio和HTTP两种传输
- 动态热重载工具列表
- 线程安全工具调用

## 工具
- `mcp_list_servers` - 列出已配置的MCP服务器
- `mcp_discover_tools` - 发现指定服务器的工具
- `mcp_call_tool` - 调用MCP工具
- `mcp_add_server` - 添加新MCP服务器

## 配置
编辑 `~/.openclaw/mcp_servers.yaml` 添加服务器

## 使用示例
```
发现filesystem服务器工具
→ mcp_discover_tools(server="filesystem")

调用fs_read读取文件
→ mcp_call_tool(server="filesystem", tool="fs_read", args={"path": "/tmp/test.txt"})
```
