#!/bin/bash
set -euo pipefail

# =============================================================================
# Start Ouroboros in Local LLM Mode (Ollama)
# =============================================================================

DEFAULT_MODEL="qwen2.5:7b"

# -----------------------------------------------------------------------------
# 1. Detect Ollama, install if missing
# -----------------------------------------------------------------------------
install_ollama() {
  echo "[start-local] Ollama not found. Installing..."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    if command -v brew &>/dev/null; then
      brew install ollama
    else
      echo "[start-local] Homebrew not found. Please install Ollama manually: https://ollama.com"
      exit 1
    fi
  elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    curl -fsSL https://ollama.com/install.sh | sh
  else
    echo "[start-local] Unsupported OS. Please install Ollama manually: https://ollama.com"
    exit 1
  fi
}

if ! command -v ollama &>/dev/null; then
  install_ollama
fi

# Ensure Ollama service is responsive
if ! ollama list &>/dev/null; then
  echo "[start-local] Ollama binary exists but 'ollama list' failed."
  echo "[start-local] Please start the Ollama service and try again."
  exit 1
fi

# -----------------------------------------------------------------------------
# 2. Pull default model
# -----------------------------------------------------------------------------
echo "[start-local] Ensuring model ${DEFAULT_MODEL} is available..."
ollama pull "${DEFAULT_MODEL}"

# -----------------------------------------------------------------------------
# 3. Set environment variables for local mode
# -----------------------------------------------------------------------------
export LLM_PROVIDER="local"
export LLM_BASE_URL="http://localhost:11434"
export LLM_MODEL="${DEFAULT_MODEL}"

echo "[start-local] Local mode configured:"
echo "  LLM_PROVIDER = ${LLM_PROVIDER}"
echo "  LLM_BASE_URL = ${LLM_BASE_URL}"
echo "  LLM_MODEL    = ${LLM_MODEL}"

# -----------------------------------------------------------------------------
# 4. Start Ouroboros dev server
# -----------------------------------------------------------------------------
echo "[start-local] Starting Ouroboros dev server..."
npm run dev
