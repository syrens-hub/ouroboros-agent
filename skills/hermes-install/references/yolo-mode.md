# YOLO 模式详细配置指南

## 什么是 YOLO 模式

YOLO (You Only Live Once) 模式是 Hermes Agent 的高级配置，允许 Agent 在执行操作时绕过命令审批流程，自动执行操作，显著提升自动化效率。

---

## 标准模式 vs YOLO 模式

| 特性 | 标准模式 | YOLO 模式 |
|------|----------|-----------|
| 命令审批 | 每次操作需确认 | 自动执行 |
| 交互式确认 | 频繁弹出确认框 | 完全跳过 |
| 执行速度 | 较慢 | 快速 |
| 安全性 | 高（每次确认） | 需信任 Agent |
| 适用场景 | 首次使用、敏感操作 | 熟悉后、自动化任务 |

---

## 何时使用 YOLO 模式

### 推荐使用

| 场景 | 说明 |
|------|------|
| 本地开发环境 | 安全可控的机器 |
| 自动化脚本 | 预先定义好的工作流 |
| 定时任务 | 无人值守的后台任务 |
| 测试环境 | 不影响生产 |
| 熟悉 Hermes 后 | 了解 Agent 行为模式 |

### 不建议使用

| 场景 | 说明 |
|------|------|
| 首次使用 Hermes | 不了解 Agent 能力 |
| 共享/公共机器 | 其他用户可能误操作 |
| 生产环境 | 风险较高 |
| 不确定操作内容 | 应先确认再执行 |

---

## 开启 YOLO 模式

### 方式一：环境变量

```bash
# 临时开启（当前会话）
export HERMES_YOLO=true

# 永久开启
echo 'HERMES_YOLO=true' >> ~/.hermes/.env
```

### 方式二：命令行

```bash
# 开启 YOLO
hermes config set yolo.enabled true

# 关闭 YOLO
hermes config set yolo.enabled false

# 查看状态
hermes config get yolo.enabled
```

### 方式三：配置文件

编辑 `~/.hermes/config.yaml`:

```yaml
yolo:
  enabled: true
```

---

## 安全配置

### 限制允许的命令

```yaml
yolo:
  enabled: true
  allowed_commands:
    - read
    - write
    - search
    - execute
    - edit
```

### 设置命令黑名单

```yaml
yolo:
  enabled: true
  denied_patterns:
    # 危险命令
    - "^rm -rf /"
    - "^rm -rf /home"
    - "^rm -rf /root"
    - "^dd "
    - "^fdisk"
    - "^mkfs"
    - "^umount"
    
    # 系统修改
    - "^chmod 777"
    - "^chown "
    - "^passwd"
    
    # 网络危险操作
    - "^iptables -F"
    - "^ufw disable"
```

### 目录限制

```yaml
yolo:
  enabled: true
  allowed_dirs:
    - ~/projects
    - ~/documents
    - /tmp/hermes
    - ~/workspace
  
  denied_dirs:
    - /
    - /home
    - /root
    - /etc
    - /var
    - /usr
```

### 文件类型限制

```yaml
yolo:
  enabled: true
  allowed_extensions:
    - .txt
    - .md
    - .json
    - .yaml
    - .yml
    - .py
    - .js
    - .ts
    - .sh
  
  denied_extensions:
    - .exe
    - .sh
    - .bat
    - .dll
```

---

## 审计配置

### 启用审计日志

```yaml
yolo:
  enabled: true
  audit_log: ~/.hermes/logs/yolo-audit.log
  audit_level: verbose
```

### 审计日志格式

```
[2024-01-15 10:30:45] EXECUTE | user_id | /workspace/create_file.py | success
[2024-01-15 10:31:12] DENY | user_id | rm -rf / | pattern_match: "^rm -rf /"
[2024-01-15 10:32:00] EXECUTE | user_id | git commit -m "update" | success
```

---

## 渐进式启用策略

### 第一阶段：限制模式

```yaml
yolo:
  enabled: true
  allowed_commands:
    - read
    - search
  denied_patterns:
    - "^rm "
    - "^dd "
    - "^fdisk"
```

### 第二阶段：扩展模式

```yaml
yolo:
  enabled: true
  allowed_commands:
    - read
    - write
    - search
    - execute
  denied_patterns:
    - "^rm -rf /"
    - "^dd "
    - "^fdisk"
  allowed_dirs:
    - ~/projects
    - /tmp
```

### 第三阶段：完全模式

```yaml
yolo:
  enabled: true
  denied_patterns:
    - "^rm -rf /"
    - "^dd "
    - "^fdisk"
```

---

## 测试 YOLO 模式

### 干运行模式

```bash
# 不实际执行，只显示将要执行的操作
hermes chat -q "帮我创建一个测试文件" --dry-run
```

### 限制命令范围

```bash
# 只允许读和写操作
hermes chat -q "帮我创建测试文件" --yolo --allowed-commands read,write
```

### 查看执行日志

```bash
# 查看 YOLO 操作日志
hermes logs --level yolo

# 实时查看
tail -f ~/.hermes/logs/yolo-audit.log
```

---

## 常见问题

### Q: 如何临时开启 YOLO？

```bash
# 当前会话有效
export HERMES_YOLO=true
hermes
```

### Q: 如何只为特定对话开启 YOLO？

在对话中使用：

```
/yolo on
# 执行操作
/yolo off
```

### Q: 如何恢复被 YOLO 误删的文件？

1. 检查审计日志
2. 使用版本控制（git）
3. 从备份恢复

### Q: YOLO 模式下如何防止误删？

```yaml
yolo:
  enabled: true
  # 删除前确认（即使在 YOLO 模式）
  confirm_delete: true
  # 限制删除范围
  denied_patterns:
    - "^rm -rf /"
    - "^rm -rf ~"
```

---

## 完整配置示例

```yaml
# ~/.hermes/config.yaml

yolo:
  enabled: false  # 默认关闭
  
  # 命令控制
  allowed_commands:
    - read
    - write
    - search
    - execute
    - edit
    - delete
    - move
    - copy
  
  # 命令黑名单（正则表达式）
  denied_patterns:
    # 危险删除
    - "^rm -rf /"
    - "^rm -rf /home"
    - "^rm -rf /root"
    - "^rm -rf /etc"
    
    # 磁盘操作
    - "^dd "
    - "^fdisk"
    - "^mkfs"
    - "^umount"
    
    # 系统修改
    - "^chmod 777"
    - "^passwd"
    - "^useradd"
    
    # 网络安全
    - "^iptables -F"
    - "^ufw disable"
  
  # 目录限制
  allowed_dirs:
    - ~/projects
    - ~/documents
    - ~/workspace
    - /tmp/hermes
    - /workspace
  
  denied_dirs:
    - /
    - /home
    - /root
    - /etc
    - /var
    - /usr
    - /bin
    - /sbin
  
  # 文件限制
  allowed_extensions:
    - .txt
    - .md
    - .json
    - .yaml
    - .yml
    - .py
    - .js
    - .ts
    - .html
    - .css
    - .sh
    - .log
    - .csv
    - .xml
  
  denied_extensions:
    - .exe
    - .dll
    - .so
    - .bin
  
  # 审计
  audit_log: ~/.hermes/logs/yolo-audit.log
  audit_level: info
  
  # 安全选项
  confirm_delete: false
  confirm_system: true
  max_file_size: 104857600  # 100MB
```

---

## 最佳实践

1. **渐进式启用**
   - 从限制模式开始
   - 逐步放宽限制
   - 定期审查日志

2. **日志审查**
   - 定期检查审计日志
   - 关注异常操作
   - 及时调整规则

3. **备份策略**
   - 启用版本控制
   - 定期备份重要文件
   - 使用只读挂载（可选）

4. **监控告警**
   ```yaml
   # 配置异常操作告警
   yolo:
     alert_patterns:
       - "^rm -rf"
       - "^dd "
     alert_webhook: https://your-webhook.com/alert
   ```
