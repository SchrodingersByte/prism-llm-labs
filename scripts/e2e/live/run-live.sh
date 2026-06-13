#!/bin/bash
# Prism live test runner — real LLM calls, real Pinecone, real gateway.
#
# Prerequisites:
#   1. .env.e2e has PRISM_API_KEY, OPENAI_API_KEY, PINECONE_API_KEY
#   2. Pinecone index "prism-test-docs" created (1536 dims, cosine, serverless)
#   3. Dev server running: pnpm --filter web dev
#   4. Demo infra seeded: bash scripts/e2e/run-demo.sh
#
# Usage:
#   bash scripts/e2e/live/run-live.sh
#   bash scripts/e2e/live/run-live.sh --skip-load   # skip Pinecone data load
#   bash scripts/e2e/live/run-live.sh --skip-github  # skip GitHub repo connect

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$ROOT_DIR"

SKIP_LOAD=false
SKIP_GITHUB=false
for arg in "$@"; do
  case $arg in
    --skip-load)   SKIP_LOAD=true   ;;
    --skip-github) SKIP_GITHUB=true ;;
  esac
done

if [ ! -f ".env.e2e" ]; then
  echo "[run-live] ERROR: .env.e2e not found in project root"
  exit 1
fi

set -a; source .env.e2e; set +a

TS_NODE="./scripts/e2e/node_modules/.bin/ts-node --project scripts/e2e/tsconfig.json"

echo ""
echo "=================================================================="
echo " Prism Live E2E Test"
echo "=================================================================="
echo ""

# ── Step 1: Load Pinecone (one-time) ─────────────────────────────────────────
if [ "$SKIP_LOAD" = false ]; then
  echo "--- Step 1: Load Pinecone index ---"
  $TS_NODE scripts/e2e/live/load-pinecone.ts
  echo ""
else
  echo "--- Step 1: Pinecone load skipped ---"
fi

# ── Step 2: Connect GitHub repo (one-time) ────────────────────────────────────
if [ "$SKIP_GITHUB" = false ] && [ -n "$GITHUB_REPO_OWNER" ]; then
  echo "--- Step 2: Connect GitHub repo ---"
  $TS_NODE scripts/e2e/live/connect-github-repo.ts
  echo ""
else
  echo "--- Step 2: GitHub connect skipped (set GITHUB_REPO_OWNER to enable) ---"
fi

# ── Step 3: Run test agent ────────────────────────────────────────────────────
echo "--- Step 3: Run test agent (5 scenarios) ---"
PRISM_GATEWAY_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}" \
$TS_NODE scripts/e2e/live/agent.ts

echo ""
echo "=================================================================="
echo " Live test complete! Check your dashboard."
echo "=================================================================="
