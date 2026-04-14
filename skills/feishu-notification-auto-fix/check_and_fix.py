#!/usr/bin/env python3
"""
飞书通知自动检查和修复工具
检测飞书API调用中的常见问题
"""
import re
import sys

def check_url(url):
    """检查URL是否包含正确的receive_id_type参数"""
    if "?receive_id_type=open_id" in url:
        print("✅ URL格式正确")
        return True
    else:
        print(f"❌ URL缺少 receive_id_type 参数: {url}")
        fixed = url.rstrip("/") + "?receive_id_type=open_id"
        print(f"✅ 应改为: {fixed}")
        return False

def check_payload(payload_str):
    """检查payload是否包含receive_id_type"""
    try:
        import json
        payload = json.loads(payload_str)
    except:
        print("⚠️ 无法解析payload JSON")
        return False

    if payload.get("receive_id_type") == "open_id":
        print("✅ payload.receive_id_type = open_id")
        return True
    else:
        print(f"❌ payload缺少 receive_id_type，当前: {payload.get('receive_id_type')}")
        return False

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if "http" in sys.argv[1]:
            check_url(sys.argv[1])
        else:
            check_payload(sys.argv[1])
    else:
        print("用法: check_and_fix.py <url或payload>")
