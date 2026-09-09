#!/usr/bin/env bash
# Fails the build if a server component under src/app passes an event handler prop (onClick/onChange/onSubmit…)
# to a child. React throws "Event handlers cannot be passed to Client Component props" at REQUEST time for this,
# which is how 14 errors/day reached prod on 2026-08-26 (src/app/us/[category]/page.tsx). Add "use client" or move
# the handler into a client wrapper component. Test files and client components are ignored.
set -euo pipefail
cd "$(dirname "$0")/.."
bad=0
while IFS= read -r f; do
  head -5 "$f" | grep -qE "^[\"']use client[\"']" && continue
  if grep -nE "\bon[A-Z][A-Za-z]+=\{" "$f" >/dev/null; then
    echo "::error file=$f::server component passes an event handler prop (add 'use client' or a client wrapper)"; grep -nE "\bon[A-Z][A-Za-z]+=\{" "$f" | head -3; bad=1
  fi
done < <(find src/app -type f \( -name "page.tsx" -o -name "layout.tsx" -o -name "template.tsx" -o -name "default.tsx" \) ! -name "*.test.*")
[ "$bad" -eq 0 ] && echo "check-server-handlers: ok"
exit $bad
