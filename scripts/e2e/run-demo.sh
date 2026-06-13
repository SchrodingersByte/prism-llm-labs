#!/bin/bash
# Demo data seed runner.
# Usage: bash scripts/e2e/run-demo.sh
# Requires: .env.e2e in the project root

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f ".env.e2e" ]; then
  echo "[run-demo] ERROR: .env.e2e not found. Create it from scripts/e2e/.env.e2e.example"
  exit 1
fi

# Source env vars
set -a
source .env.e2e
set +a

TS_NODE="./scripts/e2e/node_modules/.bin/ts-node --project scripts/e2e/tsconfig.json"

echo ""
echo "=================================================================="
echo " Prism Demo Data Seed — dip.dey2112@gmail.com"
echo "=================================================================="
echo ""

$TS_NODE scripts/e2e/seed-demo.ts
