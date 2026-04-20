#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Sandbox Test Runner
# ===================
# Run the full test suite inside an isolated Docker container to validate
# that an evolution does not break the core system before it is applied.
# =============================================================================

IMAGE_TAG="ouroboros-sandbox:test"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Building sandbox image..."
docker build -t "$IMAGE_TAG" -f "$PROJECT_ROOT/Dockerfile" "$PROJECT_ROOT" >/dev/null 2>&1

echo "Running sandbox tests..."
docker run --rm \
  --memory="2g" \
  --cpus="2" \
  -e NODE_ENV=test \
  -e LLM_PROVIDER=local \
  -e SQLITE_WAL=false \
  "$IMAGE_TAG" \
  sh -c "npm test -- --run && npm run lint && npx tsc --noEmit"

echo "Sandbox tests passed."
