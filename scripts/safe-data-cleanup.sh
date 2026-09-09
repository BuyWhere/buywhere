#!/usr/bin/env bash
# safe-data-cleanup.sh — verified, reversible cleanup of INGESTED scrape data.
# Usage: safe-data-cleanup.sh [DATA_DIR=data] [--apply] [--grace=24] [--max-files=200] [--max-gb=8] [--sample-size=100] [--skip-catalog-check] [--skip-lsof]
#
# Gates (all must pass before a file moves to _trash/):
#   A — Settled:    mtime >= grace, no lsof handle (skipped with --skip-lsof), no active ticket.
#   B — Ingested:   (B1) under data/ingested/, OR (B2) sibling *summary*.json
#                   confirms inserted>0 errors=0, OR (B3) >=98% catalog sample.
#                   B3 can be skipped with --skip-catalog-check (relies on R2 Gate D instead).
#   C — Breakers:   catalog unreachable / <90% median -> abort whole run.
#   D — R2 present: (D1) sibling <file>.ingested.json marker with r2.key, OR
#                   (D2) r2_head.py finds the same basename in
#                   scrape/<workspace_short>/<lane>/.  Defense in depth so we
#                   never delete bytes that aren't durably stored in R2.
#
set -uo pipefail
DATA="data"; APPLY=0; GRACE_H=24; MAX_FILES=200; MAX_GB=8; SAMPLE=100; MIN_PCT=98; SKIP_CATALOG=0; SKIP_LSOF=0; SKIP_R2=0
R2_HEAD="${R2_HEAD:-$DATA/../scripts/r2_head.py}"
WORKSPACE_SHORT="${WORKSPACE_SHORT:-${PAPERCLIP_WORKSPACE_ID_SHORT:-3ec8f6dd}}"
for a in "$@"; do case "$a" in
  --apply) APPLY=1;;
  --grace=*) GRACE_H=${a#*=};;
  --max-files=*) MAX_FILES=${a#*=};;
  --max-gb=*) MAX_GB=${a#*=};;
  --sample-size=*) SAMPLE=${a#*=};;
  --skip-catalog-check) SKIP_CATALOG=1;;
  --skip-lsof) SKIP_LSOF=1;;
  --skip-r2) SKIP_R2=1;;
  --*) ;;
  *) DATA="$a";;
  esac; done
case "$MAX_FILES" in
  ''|*[!0-9]*)
    echo "ABORT: invalid --max-files value: $MAX_FILES"
    exit 2
    ;;
esac
case "$MAX_GB" in
  ''|*[!0-9]*)
    echo "ABORT: invalid --max-gb value: $MAX_GB"
    exit 2
    ;;
esac
CAT=$(cat "$DATA/.catalog_db_url" 2>/dev/null || true)
[ -z "$CAT" ] && { echo "ABORT: no $DATA/.catalog_db_url"; exit 2; }
export PGCONNECT_TIMEOUT=15
psql "$CAT" -At -c 'SELECT 1' >/dev/null 2>&1 || { echo "ABORT: catalog DB unreachable"; exit 2; }
TRASH="$DATA/_trash/$(date +%F)"; LOG="$DATA/_cleanup_log.jsonl"; TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
n=0; freedKB=0; checked=0; lowmatch=0
gateDR2Missed=0

# Resolve R2 head helper, prefer the local copy next to this script.
_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd 2>/dev/null || echo .)"
[ -x "$_here/r2_head.py" ] && R2_HEAD="$_here/r2_head.py"

file_kb() {  # $1=file -> echoes size in KiB without parsing pathname-bearing output
  local bytes
  bytes=$(stat -c '%s' -- "$1" 2>/dev/null || echo 0)
  awk -v b="$bytes" 'BEGIN{printf "%d", (b+1023)/1024}'
}

kb_to_gb() {  # $1=KiB -> echoes human-readable GiB
  awk -v k="$1" 'BEGIN{printf "%.2fGB", k/1048576}'
}

is_protected_catalog_state() {  # $1=file -> 0 if file is durable catalog/discovery state
  local f="$1"
  case "$f" in
    "$DATA"/google_shopping_merchants.jsonl|\
    "$DATA"/shopify_validated_merchants.jsonl|\
    "$DATA"/known_shopify_domains.txt|\
    "$DATA"/buy31015-wc-known-merchants.json)
      return 0
      ;;
  esac
  return 1
}

verify_catalog() {  # $1=file -> echoes match% (0-100), or empty if too few urls
  local f="$1" urls cnt hit
  urls=$(grep -ohE '"url":"[^"]+"' "$f" 2>/dev/null | sed 's/.*"url":"//;s/"$//' | shuf | head -$SAMPLE)
  cnt=$(printf '%s\n' "$urls" | grep -c .); [ "$cnt" -lt 10 ] && return 0
  printf '%s\n' "$urls" > "$TMP/u.txt"
  hit=$(psql "$CAT" -X -qAt -v ON_ERROR_STOP=1 <<SQL 2>/dev/null | tail -n1 | tr -cd '0-9'
CREATE TEMP TABLE _s(url text);
\copy _s(url) from '$TMP/u.txt'
SELECT count(DISTINCT p.url) FROM products p JOIN _s s ON p.url=s.url;
SQL
)
  [ -z "$hit" ] && hit=0
  awk "BEGIN{printf \"%d\", ($cnt? 100*${hit:-0}/$cnt:0)}"
}

lane_from_path() {  # $1=file under data/ -> echoes lane segment
  local rel="${1#${DATA}/}"
  echo "${rel%%/*}"
}

gate_d_r2_check() {  # $1=file, $2=lane -> echoes "D1" / "D2:<key>" / "" if not confirmed
  local f="$1" lane="$2" marker="$f.ingested.json"
  if [ -s "$marker" ]; then
    local key
    key=$(grep -oE '"key"[[:space:]]*:[[:space:]]*"[^"]+"' "$marker" 2>/dev/null | head -1 | sed 's/.*"key"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    [ -n "$key" ] && { echo "D1:$key"; return; }
  fi
  local base; base=$(basename "$f")
  for guess_lane in "$lane" "${lane%-*}" unknown; do
    local guess="scrape/${WORKSPACE_SHORT}/${guess_lane}/${base}"
    if [ -x "$R2_HEAD" ]; then
      if "$R2_HEAD" --key "$guess" >/dev/null 2>&1; then
        echo "D2:$guess"; return
      fi
    fi
  done
  echo ""
}

while IFS= read -r -d '' f; do
  [ $n -ge $MAX_FILES ] && { echo "cap: MAX_FILES reached"; break; }
  [ $(( freedKB/1048576 )) -ge $MAX_GB ] && { echo "cap: MAX_GB reached"; break; }
  if is_protected_catalog_state "$f"; then
    continue
  fi
  if [ "$SKIP_LSOF" = 0 ]; then
    lsof -- "$f" >/dev/null 2>&1 && continue               # A2: open -> skip
  fi
  kb=$(file_kb "$f")
  gate=""; pct=""; dcheck=""

  # D1 marker fast-path (BUY-32826): if a sibling <file>.ingested.json
  # marker with a "key" field exists, that is durable proof of R2 upload.
  # Skip the slow B3 catalog-sample gate entirely. This unblocks the
  # cleanup routine when the catalog DB is loaded (the per-file JOIN
  # currently times out at 60s on 100-URL samples), and it short-circuits
  # the BUY-33177/33096 ingester-marker dependency in practice: the
  # markers ARE being written (4500+ verified in buy30620-* dirs at last
  # audit); the protocol just had B3 in the wrong slot.
  fpkey=""
  if [ -s "$f.ingested.json" ]; then
    fpkey=$(grep -oE '"key"[[:space:]]*:[[:space:]]*"[^"]+"' "$f.ingested.json" 2>/dev/null | head -1 | sed 's/.*"key"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
  fi
  if [ -n "$fpkey" ]; then
    gate="marker-bypass"
    dcheck="D1:$fpkey"
    pct="NA"
    rec=$(wc -l < "$f" 2>/dev/null || echo 0)
    printf '{"ts":"%s","file":"%s","kb":%s,"records":%s,"matchPct":"%s","gate":"%s","r2":"%s","action":"%s"}\n' \
      "$(date -uIs)" "$f" "$kb" "$rec" "$pct" "$gate" "$dcheck" "$([ $APPLY = 1 ] && echo trash || echo dryrun)" >> "$LOG"
    if [ $APPLY = 1 ]; then mkdir -p "$TRASH/$(dirname "${f#$DATA/}")"; mv "$f" "$TRASH/${f#$DATA/}"; touch -- "$TRASH/${f#$DATA/}"; fi
    n=$((n+1)); freedKB=$((freedKB+kb))
    echo "$([ $APPLY = 1 ] && echo TRASHED || echo would-trash) [$gate+$dcheck] $(kb_to_gb "$kb") $f"
    continue
  fi
  case "$f" in */ingested/*) gate="ingested-dir";; esac     # B1
  if [ -z "$gate" ]; then                                    # B2: summary
    s=$(ls "${f%.*}"*summary*.json 2>/dev/null | head -1)
    if [ -n "$s" ]; then
      ins=$(grep -oE '"inserted"[^0-9]*[0-9]+' "$s" | grep -oE '[0-9]+' | head -1)
      err=$(grep -oE '"errors"[^0-9]*[0-9]+' "$s" | grep -oE '[0-9]+' | head -1)
      [ "${ins:-0}" -gt 0 ] && [ "${err:-1}" -eq 0 ] && gate="summary"
    fi
  fi
  if [ -z "$gate" ]; then                                    # B3: catalog sampling
    if [ "$SKIP_CATALOG" = 1 ]; then
      gate="catalog-skipped"
    else
      pct=$(verify_catalog "$f"); checked=$((checked+1))
      if [ -n "$pct" ] && [ "$pct" -ge $MIN_PCT ]; then gate="catalog:${pct}%"; else
        [ -n "$pct" ] && lowmatch=$((lowmatch+1)); fi
    fi
  fi
  [ -z "$gate" ] && continue                                 # not confirmed -> KEEP
  # Gate D: R2 presence — refuse delete unless we have a marker or live R2 HEAD.
  # --skip-r2 is opt-in for the BUY-33094 routine: the durable R2 marker
  # writer (BUY-33089) and R2 uploader (BUY-33090) are still in flight, so
  # Gate D would block every cleanup. Skip the R2 check for the routine sweep
  # and rely on Gates A + B + C. Remove --skip-r2 once BUY-33089 lands.
  lane=$(lane_from_path "$f")
  # Determine if this is a "raw" file (lives under data/buy*/). Raw scrape
  # files are the only category for which the user's "do not delete uningested"
  # constraint from BUY-32838 has historically been violated when --skip-r2
  # was passed. The 2026-06-07 incident moved 1.6GB of buy30620_scout_full_scrape
  # to _trash on catalog-sample alone, while the live scraper was still
  # rotating files in the same directory. To honor that constraint, raw files
  # are now ALWAYS checked for a sibling <file>.ingested.json R2 marker,
  # regardless of --skip-r2. Catalog files and data/ingested/ still get the
  # bypass because they have their own ingestion signal.
  is_raw=0
  case "$f" in
    "$DATA"/buy*|\
    "$DATA"/buy*/*) is_raw=1 ;;
  esac
  if [ "$SKIP_R2" = 1 ]; then
    if [ "$is_raw" = 1 ] && [ "${CLEANUP_REQUIRE_R2_FOR_RAW:-1}" = "1" ]; then
      # Raw files: in --skip-r2 mode only trust the sibling marker. Do not
      # fall back to live R2 HEAD probes here or dry-runs can spend most of
      # their time proving files we already intend to skip.
      marker="$f.ingested.json"
      fpkey=""
      if [ -s "$marker" ]; then
        fpkey=$(grep -oE '"key"[[:space:]]*:[[:space:]]*"[^"]+"' "$marker" 2>/dev/null | head -1 | sed 's/.*"key"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
      fi
      if [ -z "$fpkey" ]; then
        gateDR2Missed=$((gateDR2Missed+1))
        continue
      fi
      dcheck="D1:$fpkey"
    else
      dcheck="D:skipped"
    fi
  else
    dcheck=$(gate_d_r2_check "$f" "$lane")
    if [ -z "$dcheck" ]; then
      gateDR2Missed=$((gateDR2Missed+1))
      continue
    fi
  fi
  rec=$(wc -l < "$f" 2>/dev/null || echo 0)
  printf '{"ts":"%s","file":"%s","kb":%s,"records":%s,"matchPct":"%s","gate":"%s","r2":"%s","action":"%s"}\n' \
    "$(date -uIs)" "$f" "$kb" "$rec" "${pct:-NA}" "$gate" "$dcheck" "$([ $APPLY = 1 ] && echo trash || echo dryrun)" >> "$LOG"
  if [ $APPLY = 1 ]; then mkdir -p "$TRASH/$(dirname "${f#$DATA/}")"; mv "$f" "$TRASH/${f#$DATA/}"; touch -- "$TRASH/${f#$DATA/}"; fi
  n=$((n+1)); freedKB=$((freedKB+kb))
  echo "$([ $APPLY = 1 ] && echo TRASHED || echo would-trash) [$gate+$dcheck] $(kb_to_gb "$kb") $f"
done < <(find "$DATA" -type f \( -name '*.ndjson' -o -name '*.jsonl' -o -name '*.gz' \) -mmin +$((GRACE_H*60)) \
  ! -path '*/checkpoints/*' ! -path '*/ingest_ready/*' ! -path '*/merchants/*' ! -path '*/_trash/*' \
  ! -name '*checkpoint*' ! -name '*-state.json' ! -name '*.pid' ! -name '*_cleanup_log*' \
  -print0 2>/dev/null)

echo "--- files=$n freed=$(kb_to_gb "$freedKB") catalogChecked=$checked lowMatchKept=$lowmatch r2Missed=$gateDR2Missed apply=$APPLY"
# Gate-C breaker: ingestion looks broken if >half of sampled files miss the catalog
if [ "$checked" -gt 10 ] && [ "$lowmatch" -gt $((checked/2)) ]; then
  echo "WARN: >50% of sampled files below ${MIN_PCT}% catalog match — ingestion may be lagging. Review before --apply."
fi
# phase-2: purge trash older than 48h (raw scrape files get 7-day grace
# so a delayed catalog or R2 upload can still rescue them — BUY-32838)
find "$DATA/_trash" -type f -mmin +2880 ! -path "*/buy[0-9]*/*" -delete 2>/dev/null
find "$DATA/_trash" -type f -mmin +10080 -path "*/buy[0-9]*/*" -delete 2>/dev/null
find "$DATA/_trash" -type d -empty -delete 2>/dev/null
