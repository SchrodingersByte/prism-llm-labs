#!/bin/bash
# E2E test orchestrator — runs all phases in order.
# Usage: bash scripts/e2e/run-all.sh
# Requires: .env.e2e in the project root, npm/pnpm, Python 3.8+

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$ROOT_DIR"

if [ ! -f ".env.e2e" ]; then
  echo "[run-all] ERROR: .env.e2e not found in project root"
  echo "[run-all] Copy scripts/e2e/.env.e2e.example to .env.e2e and fill in values"
  exit 1
fi

TS_NODE="./scripts/e2e/node_modules/.bin/ts-node --project scripts/e2e/tsconfig.json"

echo ""
echo "==================================================================="
echo " Prism E2E Test Suite"
echo "==================================================================="
echo ""

echo "--- Phase 1: Seed ---"
$TS_NODE scripts/e2e/seed.ts

echo ""
echo "--- Phase 2: TypeScript SDK — Analytics Mode ---"
$TS_NODE scripts/e2e/run-ts-analytics.ts

echo ""
echo "--- Phase 3: TypeScript SDK — Gateway Mode ---"
$TS_NODE scripts/e2e/run-ts-gateway.ts

echo ""
echo "--- Phase 4: MCP SDK ---"
$TS_NODE scripts/e2e/run-mcp.ts

echo ""
echo "--- Phase 5: Python SDK ---"
if command -v python3 &>/dev/null; then
  (
    cd tests/python
    python3 -m pip install -q prism-llm-labs pytest
    # Copy seed file to cwd so Python tests can read it
    cp ../../.e2e-seed.json .e2e-seed.json
    # Source env vars for pytest
    set -a; source ../../.env.e2e; set +a
    python3 -m pytest test_analytics_mode.py test_gateway_mode.py -v
    rm -f .e2e-seed.json
  )
else
  echo "[run-all] python3 not found — skipping Python SDK tests"
fi

echo ""
echo "--- Phase 6: Verify (waiting for Tinybird ingestion) ---"
$TS_NODE scripts/e2e/verify.ts

echo ""
echo "--- Phase 7: Teardown ---"
$TS_NODE scripts/e2e/teardown.ts

echo ""
echo "==================================================================="
echo " All E2E tests passed!"
echo "==================================================================="
