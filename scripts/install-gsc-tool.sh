#!/usr/bin/env bash
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)/gsc-tool"
install -m 0755 "$SRC" /home/paperclip/bin/gsc-tool
if [ -w /usr/local/bin/gsc-tool ] || [ -w /usr/local/bin ]; then
  install -m 0755 "$SRC" /usr/local/bin/gsc-tool
  echo "installed $SRC -> /usr/local/bin/gsc-tool and ~/bin/gsc-tool"
else
  echo "installed $SRC -> ~/bin/gsc-tool ( /usr/local/bin/gsc-tool not writable; PATH prefers ~/bin )"
fi
