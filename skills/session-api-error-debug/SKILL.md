---
name: session-api-error-debug
description: OpenClaw API报错"INVALID_REQUEST"时的诊断——idempotencyKey缺失/subagentControlScope错误/主session禁止删除
version: 1.0.0
---

# OpenClaw Session/API 错误诊断

## 触发条件
日志中出现：`INVALID_REQUEST` 或 `invalid.*params`

---

## 常见错误 + 修复

### 错误1：Cannot delete the main session
```
Error: Cannot delete the main session (agent:main:main)
```
**根因**：主会话是系统保护对象，不能被删除

**修复**：
```bash
# 不要删除主session，删除其他subagent session
openclaw sessions list | grep "agent=main"
# 只删除 agent=main:subagent-xxx 这样的子会话
openclaw sessions kill <session-id>
```

---

### 错误2：idempotencyKey missing
```
invalid agent params: must have required property 'idempotencyKey'
```
**根因**：API调用时缺少幂等性key

**修复**：这是OpenClaw内部问题，不影响功能。可以忽略，或重启gateway：
```bash
openclaw gateway restart
```

---

### 错误3：subagentControlScope validation
```
invalid sessions.patch params: at /subagentControlScope: must be equal to constant
```
**根因**：subagent的作用域参数值不符合预期

**诊断**：
```bash
# 查看subagent配置
openclaw config get 2>/dev/null | grep -i subagent

# 查看具体session的scope
openclaw sessions list | grep subagent
```

**修复**：通常需要检查subagent的配置是否正确注册

---

## 诊断流程图

```
INVALID_REQUEST
  ├─ "Cannot delete main session" → 忽略（保护机制）
  ├─ "idempotencyKey" → 重启gateway
  └─ "subagentControlScope" → 检查subagent配置
```

## 新发现错误（2026-04-12）
```
Error: attachment image: exceeds size limit (8918437 > 5000000 bytes)
```
**根因**：飞书附件图片超过5MB限制

**修复**：压缩图片后再发送
```bash
# 使用convert压缩
convert large.jpg -resize 1920x1080 -quality 85 small.jpg

# 或使用python
python3 -c "from PIL import Image; Image.open('a.jpg').save('b.jpg', quality=85, optimize=True)"
```

## 预防
- 飞书附件图片先压缩再发送
- 不要尝试通过API删除主会话
- idempotencyKey错误通常是并发问题，重启gateway可临时解决
