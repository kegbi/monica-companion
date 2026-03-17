#!/usr/bin/env bash
#
# Orchestrates all load tests against the Docker Compose stack.
#
# Prerequisites:
#   - Docker Compose stack running with profiles: app, observability
#   - .env file with JWT_SECRET set
#
# Usage:
#   bash tests/load/run-all.sh
#
# Environment overrides:
#   SCHEDULER_URL       (default: http://localhost:3005)
#   AI_ROUTER_URL       (default: http://localhost:3002)
#   PROMETHEUS_URL      (default: http://localhost:9090)
#   REDIS_URL           (default: redis://localhost:6379)
#   JWT_SECRET          (required)
#   MOCK_PORT           (default: 9999)
#   RESPONSE_DELAY_MS   (default: 50)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

export SCHEDULER_URL="${SCHEDULER_URL:-http://localhost:3005}"
export AI_ROUTER_URL="${AI_ROUTER_URL:-http://localhost:3002}"
export PROMETHEUS_URL="${PROMETHEUS_URL:-http://localhost:9090}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export MOCK_PORT="${MOCK_PORT:-9999}"
export RESPONSE_DELAY_MS="${RESPONSE_DELAY_MS:-50}"

if [ -z "${JWT_SECRET:-}" ]; then
  echo "ERROR: JWT_SECRET environment variable is required"
  exit 1
fi

echo "================================"
echo "  Load Test Suite"
echo "================================"
echo ""
echo "Scheduler:  $SCHEDULER_URL"
echo "AI Router:  $AI_ROUTER_URL"
echo "Prometheus: $PROMETHEUS_URL"
echo "Redis:      $REDIS_URL"
echo "Mock delay: ${RESPONSE_DELAY_MS}ms"
echo ""

# Start mock server in background
echo "Starting mock server on port $MOCK_PORT..."
npx tsx "$SCRIPT_DIR/mock-server.ts" &
MOCK_PID=$!
sleep 2

cleanup() {
  echo ""
  echo "Stopping mock server (PID $MOCK_PID)..."
  kill "$MOCK_PID" 2>/dev/null || true
  wait "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo ""
echo "--- 1/4: Queue Latency ---"
echo ""
npx tsx "$SCRIPT_DIR/queue-latency.ts" || echo "WARN: queue-latency test had failures"

echo ""
echo "--- 2/4: Read-Only Latency (delay=${RESPONSE_DELAY_MS}ms) ---"
echo ""
npx tsx "$SCRIPT_DIR/read-only-latency.ts" || echo "WARN: read-only-latency test had failures"

echo ""
echo "--- 3/4: Reminder Reliability ---"
echo ""
npx tsx "$SCRIPT_DIR/reminder-reliability.ts" || echo "WARN: reminder-reliability test had failures"

echo ""
echo "--- 4/4: Budget Accuracy ---"
echo ""
npx tsx "$SCRIPT_DIR/budget-accuracy.ts" || echo "WARN: budget-accuracy test had failures"

echo ""
echo "================================"
echo "  Load Test Suite Complete"
echo "================================"
echo ""
echo "To test with variable external delays, re-run with:"
echo "  RESPONSE_DELAY_MS=100 bash tests/load/run-all.sh"
echo "  RESPONSE_DELAY_MS=500 bash tests/load/run-all.sh"
echo "  RESPONSE_DELAY_MS=1000 bash tests/load/run-all.sh"
