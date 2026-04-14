#!/bin/bash
# Kimi Quota Checker - Shell wrapper for cron execution
cd ~/.openclaw/workspace/skills/kimi-quota-checker 2>/dev/null || cd /Users/chimu/.openclaw/workspace/skills/kimi-quota-checker
python3 check.py
