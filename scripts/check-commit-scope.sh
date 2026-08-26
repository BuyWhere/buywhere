#!/bin/bash
# check-commit-scope.sh — local §7 commit-scope guard (Indexation Directive 2026-08-25).
#
# Fail if a commit (or staged/unstaged/uncommitted change vs origin/main) violates the
# rule-2 commit-scope discipline:
#   - >25 files touched
#   - any deletion under a protected path (content/, src/app/, src/middleware.ts,
#     src/lib/sitemaps.ts, .github/)
#
# Why: the 2026-08-19 stale-tree incident (commit 554950c) cost 224 indexed pages.
# This script is the local + instruction guard. The fleet PAT cannot push GitHub
# Actions workflows, so the GitHub-Actions-side check is intentionally out of scope;
# 4seen runs an external guard every 6 hours that covers that surface.
#
# Usage:
#   scripts/check-commit-scope.sh                          # check HEAD vs origin/main
#   scripts/check-commit-scope.sh --staged                 # check staged vs HEAD
#   scripts/check-commit-scope.sh --base <ref> --head <ref>  # arbitrary range
#   scripts/check-commit-scope.sh --uncommitted            # working-tree vs HEAD
#
# Exit codes: 0 = PASS, 1 = FAIL, 2 = misconfiguration.

set -uo pipefail

MODE="head"
BASE=""
HEAD_REF=""
PROTECTED_EXACT=("src/middleware.ts" "src/lib/sitemaps.ts")
PROTECTED_PREFIXES=("content/" "src/app/" ".github/")

usage() {
  sed -n '2,16p' "$0"
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --staged)        MODE="staged"; shift ;;
    --uncommitted)   MODE="uncommitted"; shift ;;
    --base)          BASE="${2:-}"; shift 2 ;;
    --head)          HEAD_REF="${2:-}"; shift 2 ;;
    -h|--help)       usage ;;
    *)               echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Resolve diff target based on mode.
case "$MODE" in
  staged)
    if [ -z "$(git diff --cached --name-only)" ] && [ -z "$(git diff --cached --name-status)" ]; then
      # nothing staged, treat as uncommitted
      RANGE="HEAD"
    fi
    FILES=$(git diff --cached --name-only)
    STAT=$(git diff --cached --name-status)
    TITLE="staged vs HEAD"
    ;;
  uncommitted)
    FILES=$(git diff --name-only; git diff --name-only --cached)
    STAT=$(git diff --name-status; git diff --cached --name-status)
    TITLE="working tree (unstaged + staged) vs HEAD"
    ;;
  head|*)
    if [ -n "$BASE" ] && [ -n "$HEAD_REF" ]; then
      RANGE="$BASE..$HEAD_REF"
    else
      DEFAULT_BASE="$(git config --get branch.$(git rev-parse --abbrev-ref HEAD).merge 2>/dev/null \
        || git config --get init.defaultBranch || echo main)"
      DEFAULT_BASE_REF="${DEFAULT_BASE#refs/heads/}"
      if ! git rev-parse --verify "origin/$DEFAULT_BASE_REF" >/dev/null 2>&1; then
        # Fallback: parent of HEAD if HEAD is a commit (PR/squash)
        PARENT=$(git rev-parse --verify HEAD^ 2>/dev/null || true)
        if [ -n "$PARENT" ]; then
          RANGE="$PARENT..HEAD"
        else
          echo "ERROR: cannot resolve origin/$DEFAULT_BASE_REF and no parent of HEAD." >&2
          echo "Specify --base <ref> --head <ref>." >&2
          exit 2
        fi
      else
        RANGE="origin/$DEFAULT_BASE_REF..HEAD"
      fi
    fi
    FILES=$(git diff --name-only "$RANGE")
    STAT=$(git diff --name-status "$RANGE")
    TITLE="diff range: $RANGE"
    ;;
esac

# Empty diff is a pass with a heads-up (someone may have called the script on a clean tree).
if [ -z "$FILES" ]; then
  echo "check-commit-scope: no changes detected ($TITLE). PASS (vacuous)."
  exit 0
fi

TOTAL=$(printf '%s\n' "$FILES" | wc -l | tr -d ' ')
echo "check-commit-scope: $TITLE — $TOTAL file(s)"

# Rule 2: >25 files is a stale-tree smell.
RC=0
if [ "$TOTAL" -gt 25 ]; then
  echo "FAIL: touched $TOTAL files (>25). Per Indexation Directive §7 rule 2, this is a"
  echo "      stale-tree smell — rebase and re-diff before pushing."
  RC=1
fi

# Rule 2/3: any deletion under a protected path is forbidden without Richmond approval.
DELETIONS=$(printf '%s\n' "$STAT" | awk '$1 ~ /^D$/ {print $2}')
PROT_HIT=""
if [ -n "$DELETIONS" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    for exact in "${PROTECTED_EXACT[@]}"; do
      if [ "$f" = "$exact" ]; then
        PROT_HIT+="  $f"$'\n'
        break
      fi
    done
    for prefix in "${PROTECTED_PREFIXES[@]}"; do
      case "$f" in
        "$prefix"*) PROT_HIT+="  $f"$'\n'; break ;;
      esac
    done
  done <<< "$DELETIONS"
fi

if [ -n "$PROT_HIT" ]; then
  echo "FAIL: deletions under protected paths (rules 2/3/9):"
  printf '%s' "$PROT_HIT"
  echo "      These paths require an SEO-GATE:-titled PR and Richmond's written approval."
  RC=1
fi

# Informational: list the files for human review.
echo "Files in this diff:"
printf '  %s\n' $FILES

if [ "$RC" -eq 0 ]; then
  echo "check-commit-scope: PASS"
  exit 0
fi
echo "check-commit-scope: FAIL"
exit 1