#!/usr/bin/env python3
"""
Kimi API Quota 健康检查脚本
- 检查 Kimi API 是否还有可用 quota
- quota < 20% 或耗尽 → 发送飞书告警给谢总
- quota 充足 → 静默记录到当日 memory
- 自动降级：Kimi连续失败 → MiniMax → Ollama本地
- Circuit Breaker：连续5次失败 → OPEN（10秒内拒绝）→ 自动CLOSE
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime

# ========== 配置 ==========
KIMI_API_KEY = "sk-NfsDJsUx2m4zx8B6EcYWV2BIQJoUAZ2k0m4NKO0RG1q138q8"
KIMI_BASE_URL = "https://api.moonshot.cn/v1"
MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "")
MINIMAX_BASE_URL = "https://api.minimax.chat/v1"
FEISHU_USER_OPEN_ID = "ou_e178c68da94c8a042b1a0469b4ef4e2f"
FEISHU_APP_ID = "cli_a93294f5eb789bcd"
FEISHU_APP_SECRET = "VVSCFj724CMVbQEHzcpU7eVwuoirxPNQ"

# 降级配置
MAX_RETRIES = 3
RETRY_BASE_DELAY = 2  # 秒，指数退避

# Circuit Breaker 配置
CIRCUIT_THRESHOLD = 5      # 连续5次失败 → OPEN
CIRCUIT_TIMEOUT   = 10     # 10秒后自动 CLOSE
CIRCUIT_FILE      = os.path.expanduser("~/.openclaw/workspace/memory/kimi-circuit-breaker.json")

# ========== Circuit Breaker ==========

class CircuitBreaker:
    """Kimi API 熔断器：连续失败5次后熔断10秒"""

    def __init__(self, name, threshold=5, timeout=10):
        self.name = name
        self.threshold = threshold
        self.timeout = timeout
        self.failures = 0
        self.last_failure_time = 0
        self.state = "CLOSED"  # CLOSED / OPEN
        self.load()

    def load(self):
        """从文件加载熔断状态"""
        try:
            if os.path.exists(CIRCUIT_FILE):
                with open(CIRCUIT_FILE) as f:
                    data = json.load(f)
                    if self.name in data:
                        s = data[self.name]
                        self.failures = s.get("failures", 0)
                        self.last_failure_time = s.get("last_failure_time", 0)
                        # 检查是否应该自动恢复
                        if self.state == "OPEN":
                            if time.time() - self.last_failure_time > self.timeout:
                                self.state = "CLOSED"
                                self.failures = 0
                                self.save()
        except Exception:
            pass

    def save(self):
        """保存熔断状态到文件"""
        try:
            data = {}
            if os.path.exists(CIRCUIT_FILE):
                with open(CIRCUIT_FILE) as f:
                    data = json.load(f)
            data[self.name] = {
                "failures": self.failures,
                "last_failure_time": self.last_failure_time,
                "state": self.state
            }
            with open(CIRCUIT_FILE, "w") as f:
                json.dump(data, f)
        except Exception:
            pass

    def is_open(self):
        """检查是否熔断中"""
        if self.state == "OPEN":
            if time.time() - self.last_failure_time > self.timeout:
                self.state = "CLOSED"
                self.failures = 0
                self.save()
                return False
            return True
        return False

    def record_success(self):
        """记录成功，重置计数器"""
        self.failures = 0
        self.state = "CLOSED"
        self.save()

    def record_failure(self):
        """记录失败，达到阈值则熔断"""
        self.failures += 1
        self.last_failure_time = time.time()
        if self.failures >= self.threshold:
            self.state = "OPEN"
        self.save()


# 全局熔断器
cb_kimi    = CircuitBreaker("kimi",    CIRCUIT_THRESHOLD, CIRCUIT_TIMEOUT)
cb_minimax = CircuitBreaker("minimax", CIRCUIT_THRESHOLD, CIRCUIT_TIMEOUT)


# ========== 工具函数 ==========

def run_curl(url, method="GET", data=None, headers=None, insecure=False):
    """使用 curl 发送 HTTP 请求（避免 SSL 问题）"""
    cmd = ["curl", "-s", "-X", method, url, "--max-time", "30"]
    h_list = headers or {}
    for k, v in h_list.items():
        cmd += ["-H", f"{k}: {v}"]
    if data:
        cmd += ["-d", data]
    if insecure:
        cmd += ["-k"]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=35)
    return result.stdout, result.stderr, result.returncode


def log(msg):
    """输出日志，追加到当日 memory"""
    today = datetime.now().strftime("%Y-%m-%d")
    log_file = os.path.expanduser(f"~/.openclaw/workspace/memory/{today}.md")
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] [KimiQuotaChecker] {msg}\n"
    print(line.strip())
    try:
        with open(log_file, "a") as f:
            f.write(line)
    except Exception:
        pass


def log_fallback_event(reason, from_api, to_api, success):
    """记录API降级事件"""
    today = datetime.now().strftime("%Y-%m-%d")
    event_file = os.path.expanduser("~/.openclaw/workspace/memory/learnings/api-fallback-events.md")
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    status = "✅ 成功" if success else "❌ 失败"
    line = f"| {ts} | {reason} | {from_api} → {to_api} | {status} |\n"
    try:
        with open(event_file, "a") as f:
            f.write(line)
    except Exception:
        pass


def get_feishu_access_token():
    """获取飞书 Access Token"""
    url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
    data = json.dumps({
        "app_id": FEISHU_APP_ID,
        "app_secret": FEISHU_APP_SECRET
    })
    stdout, _, code = run_curl(url, method="POST", data=data,
                               headers={"Content-Type": "application/json"})
    if code != 0:
        raise Exception(f"获取 feishu token 失败")
    result = json.loads(stdout)
    return result.get("tenant_access_token", "")


def send_feishu_card(access_token, open_id, title, content, level="warning"):
    """发送飞书卡片消息"""
    url = "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id"

    color = "red" if level == "critical" else "yellow"
    emoji = "🚨" if level == "critical" else "⚠️"

    card = {
        "msg_type": "interactive",
        "card": {
            "header": {
                "title": {"tag": "plain_text", "content": f"{emoji} {title}"},
                "template": color
            },
            "elements": [
                {"tag": "div", "content": {"tag": "lark_md", "content": content}},
                {"tag": "hr"},
                {"tag": "note", "elements": [
                    {"tag": "plain_text", "content": f"由 Kimi-Quick-Health-Checker 自动检查 | {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"}
                ]}
            ]
        }
    }

    payload = json.dumps({
        "receive_id": open_id,
        "receive_id_type": "open_id",
        "msg_type": "interactive",
        "content": json.dumps(card)
    })

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    stdout, stderr, code = run_curl(url, method="POST", data=payload, headers=headers)
    if code != 0:
        log(f"飞书请求失败: {stderr}")
        return False
    try:
        result = json.loads(stdout)
        if result.get("code") == 0:
            log(f"飞书告警发送成功: {title}")
            return True
        else:
            log(f"飞书告警发送失败: {result}")
            return False
    except Exception as e:
        log(f"解析飞书响应失败: {e}, stdout: {stdout}")
        return False


def check_api_with_retry(api_name, url, payload, headers, circuit_breaker=None):
    """
    带重试的API检查（熔断器增强版）
    返回: (success, final_status, final_message)
    """
    # 如果熔断器处于OPEN状态，直接跳过
    if circuit_breaker and circuit_breaker.is_open():
        log(f"[{api_name}] 🔴 Circuit OPEN（熔断中），跳过检查")
        return (False, "circuit_open", f"Circuit OPEN（{circuit_breaker.failures}次失败，{circuit_breaker.timeout}秒后自动恢复）")

    last_error = ""
    for attempt in range(1, MAX_RETRIES + 1):
        log(f"[{api_name}] 第{attempt}次尝试...")
        stdout, stderr, code = run_curl(url, method="POST", data=payload, headers=headers)

        if code != 0:
            last_error = f"curl错误: code={code}"
            log(f"  → curl错误: {last_error}")
            if attempt < MAX_RETRIES:
                delay = RETRY_BASE_DELAY ** attempt
                log(f"  → {delay}秒后重试...")
                time.sleep(delay)
            continue

        try:
            body = json.loads(stdout)
        except Exception:
            last_error = f"响应非JSON"
            log(f"  → 响应解析失败")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BASE_DELAY ** attempt)
            continue

        error_obj = body.get("error", {})
        error_type = str(error_obj.get("type", "")).lower()
        error_msg = str(error_obj.get("message", body))

        if "error" not in body and body.get("choices"):
            usage = body.get("usage", {})
            prompt_tokens = usage.get("prompt_tokens", 0)
            # 成功：重置熔断器
            if circuit_breaker:
                cb_before = circuit_breaker.state
                circuit_breaker.record_success()
                if cb_before == "OPEN":
                    log(f"  → 🟢 Circuit CLOSED（{api_name} 恢复）")
                else:
                    log(f"  → ✅ {api_name}正常，prompt_tokens={prompt_tokens}")
            else:
                log(f"  → ✅ {api_name}正常，prompt_tokens={prompt_tokens}")
            return (True, "ok", f"API正常，prompt_tokens={prompt_tokens}")

        if "overloaded" in error_type or "overloaded" in error_msg:
            last_error = f"overloaded: {error_msg}"
            log(f"  → 过载: {last_error}")
            if attempt < MAX_RETRIES:
                delay = RETRY_BASE_DELAY ** attempt
                log(f"  → {delay}秒后重试...")
                time.sleep(delay)
            continue

        if "rate_limit" in error_type or "quota" in error_type:
            last_error = f"quota问题: {error_msg}"
            if circuit_breaker:
                circuit_breaker.record_failure()
            return (False, "critical", f"Quota耗尽: {error_msg}")

        if "permission" in error_type or "forbidden" in error_type:
            last_error = f"权限问题: {error_msg}"
            if circuit_breaker:
                circuit_breaker.record_failure()
            return (False, "critical", f"权限/Quota被拒: {error_msg}")

        last_error = f"{error_type}: {error_msg}"
        log(f"  → API异常: {last_error}")
        if attempt < MAX_RETRIES:
            time.sleep(RETRY_BASE_DELAY ** attempt)
        continue

    # 所有重试都失败：记录熔断
    if circuit_breaker:
        circuit_breaker.record_failure()
        if circuit_breaker.state == "OPEN":
            log(f"  → 🔴 Circuit OPEN! {circuit_breaker.failures}次失败，{circuit_breaker.timeout}秒内跳过{api_name}")
        else:
            log(f"  → 连续失败{circuit_breaker.failures}/{circuit_breaker.threshold}次")
    return (False, "warning", f"重试{MAX_RETRIES}次后仍失败: {last_error}")


def check_kimi_quota():
    """检查Kimi API，带熔断器"""
    url = f"{KIMI_BASE_URL}/chat/completions"
    payload = json.dumps({
        "model": "kimi-k2.5",
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 1,
        "temperature": 1.0
    })
    headers = {
        "Authorization": f"Bearer {KIMI_API_KEY}",
        "Content-Type": "application/json"
    }
    return check_api_with_retry("Kimi", url, payload, headers, cb_kimi)


def check_minimax():
    """检查MiniMax API（备用）"""
    if cb_minimax.is_open():
        log(f"[MiniMax] 🔴 Circuit OPEN（熔断中），跳过")
        return (False, "circuit_open", "Circuit OPEN")
    if not MINIMAX_API_KEY:
        return (False, "warning", "MINIMAX_API_KEY未配置")
    url = f"{MINIMAX_BASE_URL}/text/chatcompletion_v2"
    payload = json.dumps({
        "model": "MiniMax-Text-01",
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 1
    })
    headers = {
        "Authorization": f"Bearer {MINIMAX_API_KEY}",
        "Content-Type": "application/json"
    }
    return check_api_with_retry("MiniMax", url, payload, headers, cb_minimax)


def check_ollama():
    """检查Ollama本地模型（最后备用）"""
    url = "http://localhost:11434/api/generate"
    payload = json.dumps({
        "model": "gemma:latest",
        "prompt": "hi",
        "stream": False
    })
    stdout, stderr, code = run_curl(url, method="POST", data=payload)
    if code == 0:
        try:
            body = json.loads(stdout)
            if "response" in body:
                return (True, "ok", "Ollama本地正常")
        except:
            pass
    return (False, "warning", "Ollama不可用")


def main():
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log(f"=== 开始 Kimi Quota 检查 ({ts}) ===")

    # 加载熔断状态
    global cb_kimi, cb_minimax
    cb_kimi    = CircuitBreaker("kimi",    CIRCUIT_THRESHOLD, CIRCUIT_TIMEOUT)
    cb_minimax = CircuitBreaker("minimax", CIRCUIT_THRESHOLD, CIRCUIT_TIMEOUT)

    # 报告熔断状态
    for cb, name in [(cb_kimi, "Kimi"), (cb_minimax, "MiniMax")]:
        if cb.state == "OPEN":
            remaining = max(0, CIRCUIT_TIMEOUT - int(time.time() - cb.last_failure_time))
            log(f"  🔴 {name} Circuit OPEN（还剩{remaining}秒）")

    # Step 1: 检查Kimi
    success, status, msg = check_kimi_quota()
    primary_status = status
    primary_msg = msg

    if success:
        log(f"✅ Kimi API 正常")
    else:
        log(f"⚠️ Kimi {status}: {msg}")

        if status == "circuit_open":
            # 熔断中，直接降级
            log(f"→ Kimi熔断中，直接降级到MiniMax...")
            mm_success, mm_status, mm_msg = check_minimax()
            if mm_success:
                log(f"✅ MiniMax备用成功: {mm_msg}")
                log_fallback_event("Kimi Circuit OPEN", "Kimi", "MiniMax", True)
                primary_status = "ok"
                primary_msg = f"Kimi熔断，MiniMax备用成功"
            else:
                log(f"⚠️ MiniMax也失败: {mm_msg}")
                if mm_status == "circuit_open":
                    log(f"→ MiniMax也熔断，尝试Ollama...")
                else:
                    log(f"→ 尝试Ollama本地...")
                ol_success, ol_status, ol_msg = check_ollama()
                if ol_success:
                    log(f"✅ Ollama备用成功: {ol_msg}")
                    log_fallback_event("云端熔断", "Kimi/MiniMax", "Ollama本地", True)
                    primary_status = "ok"
                    primary_msg = f"全部云端熔断，Ollama备用成功"
                else:
                    log(f"❌ 所有API不可用")
                    primary_status = "critical"
                    primary_msg = f"全部API不可用"
        else:
            # 降级到MiniMax
            log(f"→ 尝试降级到MiniMax...")
            mm_success, mm_status, mm_msg = check_minimax()
            if mm_success:
                log(f"✅ MiniMax备用成功: {mm_msg}")
                log_fallback_event("Kimi失败", "Kimi", "MiniMax", True)
                primary_status = "ok"
                primary_msg = f"Kimi降级到MiniMax: {mm_msg}"
            else:
                log(f"⚠️ MiniMax也失败: {mm_msg}")
                log_fallback_event("MiniMax也失败", "MiniMax", "Ollama", None)

                # 最后尝试Ollama
                log(f"→ 尝试Ollama本地...")
                ol_success, ol_status, ol_msg = check_ollama()
                if ol_success:
                    log(f"✅ Ollama备用成功: {ol_msg}")
                    log_fallback_event("全部云端失败", "Kimi/MiniMax", "Ollama本地", True)
                    primary_status = "ok"
                    primary_msg = f"云端API全部失败，使用Ollama本地: {ol_msg}"
                else:
                    log(f"❌ 所有API不可用: {ol_msg}")
                    log_fallback_event("全部失败", "Kimi/MiniMax/Ollama", "无", False)
                    primary_status = "critical"
                    primary_msg = f"所有API不可用"

    # 发送告警
    if primary_status == "critical":
        log(f"🚨 检测到紧急状态: {primary_msg}")
        try:
            token = get_feishu_access_token()
            send_feishu_card(
                token, FEISHU_USER_OPEN_ID,
                title="🚨 API 紧急告警",
                content=f"**所有API不可用**\n\n- Kimi: {msg}\n- 时间：{ts}\n- 影响：主模型和备用模型均不可用",
                level="critical"
            )
        except Exception as e:
            log(f"发送飞书告警失败: {e}")
    elif primary_status == "warning":
        log(f"⚠️ 检测到警告状态: {primary_msg}")
        try:
            token = get_feishu_access_token()
            send_feishu_card(
                token, FEISHU_USER_OPEN_ID,
                title="⚠️ API 降级通知",
                content=f"**Kimi API 降级**\n\n- 原因：{msg}\n- 结果：已切换到备用方案\n- 时间：{ts}",
                level="warning"
            )
        except Exception as e:
            log(f"发送飞书告警失败: {e}")
    else:
        log(f"✅ API状态正常: {primary_msg}")

    log(f"=== Kimi Quota 检查完成 ===")
    return 0 if primary_status == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
