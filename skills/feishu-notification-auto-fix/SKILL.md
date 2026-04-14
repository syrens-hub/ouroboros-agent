# feishu-notification-auto-fix

> 自动检测并修复飞书告警的常见问题
> 来源：今日实际问题修复（2026-04-12）
> 触发次数：18次同类问题

## 问题症状

飞书卡片消息发送失败，错误码：
- `99992402` — `receive_id_type is required`
- `field validation failed`

## 根因

飞书消息API URL 必须包含 `?receive_id_type=open_id` 查询参数。

❌ 错误：
```
https://open.feishu.cn/open-apis/im/v1/messages
```

✅ 正确：
```
https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id
```

## 自动修复脚本

```bash
# 检查并修复飞书通知URL
python3 ~/.openclaw/workspace/skills/feishu-notification-auto-fix/check_and_fix.py
```

## 常见问题检查清单

1. [ ] URL 包含 `?receive_id_type=open_id`
2. [ ] payload 包含 `"receive_id_type": "open_id"`
3. [ ] `receive_id` 使用 open_id 格式（`ou_`开头）
4. [ ] access_token 未过期

## 预防措施

- 发送前检查URL格式
- 增加重试机制（3次，指数退避）
- 失败时记录详细错误日志
