#!/bin/bash
# BUY-69622 production verification probe
# Checks all 5 acceptance criteria against live /search SSR HTML
set -uo pipefail

QUERY="wireless+earbuds"
NOMATCH="zzxxqq-nonexistent-product"
UA="Mozilla/5.0 (compatible; BUY-69622-verify/1.0)"

echo "=== Probe: /search?q=$QUERY (matched query) ==="
HTML=$(curl -sL "https://buywhere.ai/search?q=$QUERY" -A "$UA")
H1_COUNT=$(echo "$HTML" | grep -o "<h1" | wc -l)
PULSE=$(echo "$HTML" | grep -o "animate-pulse" | wc -l)
SEARCHING=$(echo "$HTML" | grep -o "Searching catalog" | wc -l)
RESULTS_H1=$(echo "$HTML" | grep -o "Search results for" | wc -l)
OG_TITLE=$(echo "$HTML" | grep -oE 'property="og:title" content="[^"]*"' | head -1)
OG_URL=$(echo "$HTML" | grep -oE 'property="og:url" content="[^"]*"' | head -1)
TW_TITLE=$(echo "$HTML" | grep -oE 'name="twitter:title" content="[^"]*"' | head -1)
echo "H1 count: $H1_COUNT (want 1)"
echo "animate-pulse: $PULSE"
echo "'Searching catalog' in H1: $SEARCHING (want 0)"
echo "'Search results for' present: $RESULTS_H1 (want >=1)"
echo "$OG_TITLE"
echo "$OG_URL"
echo "$TW_TITLE"
echo ""
echo "=== Probe: /search?q=$NOMATCH (no-match query) ==="
HTML2=$(curl -sL "https://buywhere.ai/search?q=$NOMATCH" -A "$UA")
H1_COUNT2=$(echo "$HTML2" | grep -o "<h1" | wc -l)
SEARCHING2=$(echo "$HTML2" | grep -o "Searching catalog" | wc -l)
RESULTS_H12=$(echo "$HTML2" | grep -o "Search results for" | wc -l)
echo "H1 count: $H1_COUNT2 (want 1)"
echo "'Searching catalog': $SEARCHING2 (want 0)"
echo "'Search results for' present: $RESULTS_H12 (want >=1)"
