#!/usr/bin/env bash
#
# Resource profile script for service separation analysis.
#
# Captures Docker container resource usage snapshots during load testing
# to validate that delivery and voice-transcription warrant separate
# deployables in V1.
#
# Usage:
#   bash tests/load/resource-profile.sh
#
# Runs 5 snapshots at 10-second intervals by default.
# Override with SNAPSHOT_COUNT and SNAPSHOT_INTERVAL_S.

set -euo pipefail

SNAPSHOT_COUNT="${SNAPSHOT_COUNT:-5}"
SNAPSHOT_INTERVAL_S="${SNAPSHOT_INTERVAL_S:-10}"
OUTPUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/results"
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
OUTPUT_FILE="$OUTPUT_DIR/resource-profile-$TIMESTAMP.txt"

mkdir -p "$OUTPUT_DIR"

echo "================================"
echo "  Resource Profile Capture"
echo "================================"
echo ""
echo "Snapshots: $SNAPSHOT_COUNT"
echo "Interval:  ${SNAPSHOT_INTERVAL_S}s"
echo "Output:    $OUTPUT_FILE"
echo ""

# Header
{
  echo "Resource Profile - $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Snapshots: $SNAPSHOT_COUNT at ${SNAPSHOT_INTERVAL_S}s intervals"
  echo ""
  echo "Services of interest:"
  echo "  - scheduler"
  echo "  - delivery"
  echo "  - voice-transcription"
  echo "  - ai-router"
  echo "  - telegram-bridge"
  echo "  - monica-integration"
  echo ""
} > "$OUTPUT_FILE"

for i in $(seq 1 "$SNAPSHOT_COUNT"); do
  echo "Snapshot $i/$SNAPSHOT_COUNT..."
  {
    echo "--- Snapshot $i ($(date -u +%H:%M:%S)) ---"
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.PIDs}}" 2>/dev/null || echo "(docker stats not available)"
    echo ""
  } >> "$OUTPUT_FILE"

  if [ "$i" -lt "$SNAPSHOT_COUNT" ]; then
    sleep "$SNAPSHOT_INTERVAL_S"
  fi
done

echo ""
echo "Profile complete. Results saved to:"
echo "  $OUTPUT_FILE"
echo ""
echo "Key analysis points:"
echo "  1. Compare memory usage between scheduler, delivery, and voice-transcription"
echo "  2. Check if any service has disproportionate CPU during load"
echo "  3. Verify network I/O patterns match expected communication flows"
echo "  4. Look for PID count differences indicating thread/worker behavior"
