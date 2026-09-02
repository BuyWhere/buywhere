#!/usr/bin/env bash
# BuyWhere Load Suite Runner — BUY-26143
#
# Runs the full load-test suite (smoke → normal → peak → stress) against
# a target environment and aggregates the reports. Designed for CI usage
# and operator-driven pre-launch validation.
#
# Usage:
#   tests/load/run-load-suite.sh                              # smoke against prod
#   TARGET_URL=https://staging.example.com tests/load/run-load-suite.sh
#   API_KEY=bw_xxx PROFILES="smoke peak" tests/load/run-load-suite.sh
#   SKIP_WARMUP=1 tests/load/run-load-suite.sh                # skip warmup phase
#
# Env:
#   TARGET_URL       API base URL (default: https://api.buywhere.ai)
#   API_KEY          API key (required for non-trivial profiles)
#   PROFILES         Space-separated list of profiles to run (default: "smoke")
#   OUTPUT_DIR       Output dir (default: ./load-results)
#   FAIL_FAST        Stop on first failed profile (default: 0)

set -u
TARGET_URL="${TARGET_URL:-https://api.buywhere.ai}"
PROFILES="${PROFILES:-smoke}"
OUTPUT_DIR="${OUTPUT_DIR:-./load-results}"
FAIL_FAST="${FAIL_FAST:-0}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS="$SCRIPT_DIR/load-harness.mjs"

if [[ ! -f "$HARNESS" ]]; then
  echo "FATAL: harness not found at $HARNESS" >&2
  exit 2
fi

# Aggregate report dir
mkdir -p "$OUTPUT_DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$OUTPUT_DIR/run-$TS"
mkdir -p "$RUN_DIR"

overall_status=0
echo ""
echo "=== BuyWhere Load Suite ==="
echo "Target:    $TARGET_URL"
echo "Profiles:  $PROFILES"
echo "Output:    $RUN_DIR"
echo ""

for profile in $PROFILES; do
  echo "── Running profile: $profile ──"
  PROFILE="$profile" \
  TARGET_URL="$TARGET_URL" \
  API_KEY="${API_KEY:-}" \
  OUTPUT_DIR="$RUN_DIR/$profile" \
  node "$HARNESS"
  rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "  ✗ $profile FAILED (exit=$rc)"
    overall_status=1
    if [[ "$FAIL_FAST" == "1" ]]; then
      echo "FAIL_FAST=1 — aborting"
      exit $overall_status
    fi
  else
    echo "  ✓ $profile PASSED"
  fi
  echo ""
done

# Aggregate
echo "── Suite Summary ──"
suite_index="$RUN_DIR/INDEX.md"
{
  echo "# Load Suite — $TS"
  echo ""
  echo "- Target: $TARGET_URL"
  echo "- Profiles: $PROFILES"
  echo ""
  echo "| Profile | Result | p99 (ms) | err% | Requests |"
  echo "|---------|--------|---------:|-----:|---------:|"
  for profile in $PROFILES; do
    profile_dir="$RUN_DIR/$profile"
    summary="$profile_dir/load-summary.json"
    if [[ -f "$summary" ]]; then
      pass=$(node -e "const r=require('$summary');console.log(r.summary.overallPass?'PASS':'FAIL')")
      p99=$(node -e "const r=require('$summary');const ms=Object.values(r.byScenario).map(s=>s.holdP99);console.log(Math.max(0,...ms).toFixed(2))")
      err=$(node -e "const r=require('$summary');console.log((r.summary.errorRate*100).toFixed(2))")
      total=$(node -e "const r=require('$summary');console.log(r.summary.totalRequests)")
      echo "| $profile | $pass | $p99 | $err | $total |"
    else
      echo "| $profile | MISSING | - | - | - |"
    fi
  done
  echo ""
} > "$suite_index"
cat "$suite_index"

exit $overall_status
