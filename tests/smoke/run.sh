#!/usr/bin/env bash
#
# Orchestrates Docker Compose stack smoke tests.
#
# Spins up infrastructure + services, waits for health, runs Vitest
# smoke suite, then tears down. Exit code reflects test results.
#
# Prerequisites:
#   - Docker and Docker Compose installed
#   - .env file in project root with JWT_SECRET (and other vars)
#
# Usage:
#   bash tests/smoke/run.sh            # full lifecycle (up → test → down)
#   bash tests/smoke/run.sh --no-up    # skip startup (stack already running)
#   bash tests/smoke/run.sh --no-down  # skip teardown (leave stack running)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Parse flags
DO_UP=true
DO_DOWN=true
for arg in "$@"; do
  case "$arg" in
    --no-up)   DO_UP=false ;;
    --no-down) DO_DOWN=false ;;
  esac
done

# Load .env for JWT_SECRET and other vars
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  . "$PROJECT_ROOT/.env"
  set +a
fi

if [ -z "${JWT_SECRET:-}" ]; then
  echo "ERROR: JWT_SECRET is required. Set it in .env or environment."
  exit 1
fi

export JWT_SECRET
export AI_ROUTER_URL="${AI_ROUTER_URL:-http://localhost:3002}"
export USER_MANAGEMENT_URL="${USER_MANAGEMENT_URL:-http://localhost:3007}"
export DELIVERY_URL="${DELIVERY_URL:-http://localhost:3006}"
export VOICE_TRANSCRIPTION_URL="${VOICE_TRANSCRIPTION_URL:-http://localhost:3003}"
export TELEGRAM_BRIDGE_URL="${TELEGRAM_BRIDGE_URL:-http://localhost:3001}"
export MONICA_INTEGRATION_URL="${MONICA_INTEGRATION_URL:-http://localhost:3004}"
export SCHEDULER_URL="${SCHEDULER_URL:-http://localhost:3005}"
export WEB_UI_URL="${WEB_UI_URL:-http://localhost:4321}"
export CADDY_URL="${CADDY_URL:-http://localhost:80}"
export POSTGRES_URL="${POSTGRES_URL:-postgresql://monica:monica_dev@localhost:15432/monica_companion}"

echo "================================"
echo "  Stack Smoke Test Suite"
echo "================================"
echo ""

# ---- Startup ----

if [ "$DO_UP" = true ]; then
  echo "Starting infrastructure..."
  docker compose -f "$PROJECT_ROOT/docker-compose.yml" -f "$PROJECT_ROOT/docker-compose.smoke.yml" --profile infra up -d

  echo "Waiting for Postgres and Redis..."
  timeout=30
  while [ $timeout -gt 0 ]; do
    if docker compose -f "$PROJECT_ROOT/docker-compose.yml" -f "$PROJECT_ROOT/docker-compose.smoke.yml" ps postgres 2>/dev/null | grep -q healthy; then
      break
    fi
    sleep 1
    timeout=$((timeout - 1))
  done
  if [ $timeout -eq 0 ]; then
    echo "ERROR: Postgres did not become healthy in 30s"
    exit 1
  fi

  echo "Starting application services..."
  docker compose -f "$PROJECT_ROOT/docker-compose.yml" -f "$PROJECT_ROOT/docker-compose.smoke.yml" --profile app up -d

  echo "Waiting for services to start..."
  sleep 15
fi

# ---- Health wait ----

echo "Checking service health..."
services=("$AI_ROUTER_URL" "$USER_MANAGEMENT_URL" "$DELIVERY_URL" "$VOICE_TRANSCRIPTION_URL" "$TELEGRAM_BRIDGE_URL" "$MONICA_INTEGRATION_URL" "$SCHEDULER_URL")
for url in "${services[@]}"; do
  retries=10
  while [ $retries -gt 0 ]; do
    if curl -sf "$url/health" > /dev/null 2>&1; then
      echo "  ✓ $url"
      break
    fi
    sleep 2
    retries=$((retries - 1))
  done
  if [ $retries -eq 0 ]; then
    echo "  ✗ $url (not reachable after 20s)"
  fi
done

echo ""

# ---- Run tests ----

echo "Running smoke tests..."
echo ""

TEST_EXIT=0
cd "$SCRIPT_DIR"
npx vitest run --config vitest.config.ts || TEST_EXIT=$?

echo ""

# ---- Teardown ----

if [ "$DO_DOWN" = true ]; then
  echo "Tearing down stack..."
  docker compose -f "$PROJECT_ROOT/docker-compose.yml" -f "$PROJECT_ROOT/docker-compose.smoke.yml" --profile app --profile infra down
fi

echo ""
if [ $TEST_EXIT -eq 0 ]; then
  echo "================================"
  echo "  All smoke tests PASSED"
  echo "================================"
else
  echo "================================"
  echo "  Smoke tests FAILED (exit $TEST_EXIT)"
  echo "================================"
fi

exit $TEST_EXIT
