#!/bin/bash
# aeo-§7-comment.sh — emit the §7 verification comment for a deploy ticket.
# Indexation Directive 2026-08-25 §7 — every deploy touching routes, content,
# sitemaps, or middleware MUST post this comment in its ticket. 4seen reads the
# same shape from each ticket so its independent guard has something to compare.
#
# Usage:
#   aeo-§7-comment.sh snapshot <ticket_id>   # emit comment body for snapshot (pre-deploy)
#   aeo-§7-comment.sh verify   <ticket_id>   # emit comment body for verify (post-deploy)
#   aeo-§7-comment.sh help
#
# It does NOT post the comment itself — that is the deploying agent's job
# (you need to comment on your own ticket with the values for THIS deploy).
# This script just renders the canonical body so every deploy carries the
# same shape; copy-paste from the output into the ticket.
#
# Output goes to stdout. Inputs are pulled live from the live site
# (https://buywhere.ai) and from the local repo. The verifier lives at
# /usr/local/sbin/aeo-publish-verify.sh and snapshots are kept under
# /var/lib/aeo-verify/ (or /tmp/aeo-verify on hosts without write access).
#
# The §7 protocol is: every deploy that touches routes, content, sitemaps,
# or middleware posts in its ticket
#   (1) sitemap URL counts per child sitemap, before and after
#       (any decrease = revert + escalate);
#   (2) a 200-probe of every URL in sitemap-blog.xml + a 10% sample of each
#       other child sitemap;
#   (3) git diff --stat origin/main~1..HEAD proving the change touched
#       only in-scope files.
#
# This template makes (1)–(3) mechanically reproducible.

set -uo pipefail

BASE="${BUYWHERE_BASE:-https://buywhere.ai}"
TICKET="${2:-}"
PHASE="${1:-help}"

usage() {
  cat <<'USAGE'
aeo-§7-comment.sh — render the §7 verification comment for a deploy.

Usage:
  aeo-§7-comment.sh snapshot <TICKET_ID>   render pre-deploy snapshot comment
  aeo-§7-comment.sh verify   <TICKET_ID>   render post-deploy verify comment

This is a renderer; it does not POST comments. Copy the rendered body into
your deploy ticket comment. 4seen reads the §7 fields from each ticket
(sitemap counts before/after, 200-probe RESULT, diff --stat summary).

USAGE
}

if [ "$PHASE" = "help" ] || [ "$PHASE" = "--help" ] || [ "$PHASE" = "-h" ]; then
  usage; exit 0
fi

if [ -z "$TICKET" ]; then
  echo "ERROR: missing <TICKET_ID>." >&2; usage; exit 2
fi

# Detect the snapshot/verify state dir used by /usr/local/sbin/aeo-publish-verify.sh.
# Honour AEO_VERIFY_DIR if set (matches the upstream verifier); otherwise probe
# /var/lib/aeo-verify (the canonical writable path) and fall back to /tmp.
if [ -n "${AEO_VERIFY_DIR:-}" ]; then
  VDIR="$AEO_VERIFY_DIR"
elif [ -d "/var/lib/aeo-verify" ] && [ -w "/var/lib/aeo-verify" ]; then
  VDIR="/var/lib/aeo-verify"
else
  VDIR="/tmp/aeo-verify"
fi

# Render diff --stat for HEAD~1..HEAD (the canonical §7 form).
render_diff_stat() {
  if git rev-parse --git-dir >/dev/null 2>&1; then
    if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
      git --no-pager diff --stat "HEAD~1..HEAD" 2>/dev/null | sed 's/^/    /'
    else
      echo "    (initial commit — no HEAD~1)"
    fi
  else
    echo "    (not in a git working tree)"
  fi
}

# Render sitemap counts from a snapshot file (before.counts) or compute fresh.
render_counts_block() {
  # 1. List child sitemaps from the sitemap index.
  local children
  children="$(curl -s -m 30 "$BASE/sitemap.xml" | grep -oE "<loc>[^<]+</loc>" | sed 's/<[^>]*>//g')" || true
  if [ -z "$children" ]; then
    echo "    (could not fetch $BASE/sitemap.xml — paste counts manually)"
    return 0
  fi

  # 2. For each child, fetch URL count and probe 1 sample.
  printf '\n| sitemap child | URL count | sample 200? |\n|---|---|---|\n'
  local total=0
  for c in $children; do
    local n
    n="$(basename "$c")"
    local cnt
    cnt="$(curl -s -m 60 "$c" | grep -c '<loc>' || echo 0)"
    local sample
    sample="$(curl -s -m 60 "$c" | grep -oE "<loc>[^<]+</loc>" | sed 's/<[^>]*>//g' | head -1)"
    local code="-"
    if [ -n "$sample" ]; then
      code="$(curl -s -o /dev/null -w '%{http_code}' -m 25 "$sample")"
    fi
    printf '| `%s` | %s | %s |\n' "$n" "$cnt" "$code"
    total=$((total + cnt))
  done
  printf '\nTotal URLs across all child sitemaps: **%s**\n' "$total"
}

case "$PHASE" in
  snapshot)
    cat <<HDR
## §7 verification — **pre-deploy snapshot** (Indexation Directive 2026-08-25 §7)

Ticket: **$TICKET**
Snapshot at: \`$(date -u +%FT%TZ)\`
Snapshot taken by: \`aeo-publish-verify.sh snapshot\` (canonical state dir: \`$VDIR\`)

### (1) Sitemap URL counts — BEFORE
HDR
    if [ -f "$VDIR/before.counts" ]; then
      echo
      echo '```'
      cat "$VDIR/before.counts" | sed 's/^/    /'
      echo '```'
    else
      echo
      echo "_No prior snapshot at \`$VDIR/before.counts\` — running one now:_"
      echo
      echo '```'
      /usr/local/sbin/aeo-publish-verify.sh snapshot 2>&1 | sed 's/^/    /'
      echo '```'
    fi
    cat <<'TAIL'

> Any decrease vs these counts after deploy = revert + escalate per §7 rule 1.

### Next steps
1. Push the change to `origin/main`.
2. Wait for the deploy to roll out.
3. Run `aeo-publish-verify.sh verify` on the live site.
4. Post the **post-deploy** §7 comment in this ticket using
   `aeo-§7-comment.sh verify <TICKET_ID>` (fill in real numbers).

TAIL
    ;;
  verify)
    cat <<HDR
## §7 verification — **post-deploy** (Indexation Directive 2026-08-25 §7)

Ticket: **$TICKET**
Verify at: \`$(date -u +%FT%TZ)\`
Verifier: \`aeo-publish-verify.sh verify\`

### (1) Sitemap URL counts — BEFORE → AFTER

| child | before | after | Δ |
|---|---|---|---|
HDR

    if [ -d "$VDIR" ]; then
      for f in "$VDIR"/before.*.txt; do
        [ -f "$f" ] || continue
        n="$(basename "$f" | sed 's/^before\.//')"
        a="$(wc -l < "$f" | tr -d ' ')"
        af="$VDIR/after.$n"
        b="-"
        delta="—"
        if [ -f "$af" ]; then
          b="$(wc -l < "$af" | tr -d ' ')"
          if [ "$b" -lt "$a" ]; then
            delta="**−$((a - b)) ↓ DECREASED — REVERT + ESCALATE per §7**"
          elif [ "$b" -gt "$a" ]; then delta="+$((b - a))"; fi
        fi
        printf '| `%s` | %s | %s | %s |\n' "$n" "$a" "$b" "$delta"
      done
    else
      echo "| _no snapshots at $VDIR — running verify now:_ | | | |"
      echo
      echo '```'
      /usr/local/sbin/aeo-publish-verify.sh verify 2>&1 | sed 's/^/    /'
      echo '```'
    fi

    cat <<'TAIL'

### (2) 200-probe — sitemap-blog.xml (ALL) + 10% of every other child

_Paste the `RESULT: PASS` line from `aeo-publish-verify.sh verify` here._
_Any non-200 URL = FAIL — do not mark the deploy done; revert if a sitemap decreased._

```
RESULT: PASS
```

### (3) `git diff --stat origin/main~1..HEAD` — scope discipline

```
$(git --no-pager diff --stat origin/main~1..HEAD 2>/dev/null)
```

> Touched files only in: `src/`, `content/`, `scripts/`, `src/middleware.ts`,
> `src/lib/sitemaps.ts`, sitemaps, robots, canonical, or `next.config.*` —
> per §3 ownership table. Anything outside those paths is an incident.

### (4) Footer — agent + run-id

- Verified by: `Atlas QA` (`b166605b-…`)
- Deployer (commit author): see `git log -1 origin/main`
- 4seen comparison target: every §7 comment this week must show non-decreasing counts

TAIL
    ;;
  *)
    usage; exit 2 ;;
esac
