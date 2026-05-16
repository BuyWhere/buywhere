# BUY-17493 - Carousell Scraper Monitor Fix - COMPLETED

## Follow-up verification (2026-05-14T16:30:19Z)

- Revalidated monitor execution workspace resolution by running directly from `/home/paperclip/buywhere-api/scripts/monitor_carousell_sg.sh`.
- Confirmed the monitor now derives `WORKDIR` from the script location / git worktree root instead of relying on hardcoded paths.
- Confirmed PID handling is PID-file aware plus live process matching (`pgrep -af "python3 -m scrapers.carousell_sg"` with `--continuous` pattern) before deciding to restart.
- Confirmed restart path kills only matching scraper processes and restarts with `"${WORKDIR}/data/carousell-sg"` context and writes updated PID.
- Confirmed JSONL output regenerated after restart: `data/carousell-sg/products_20260514_163021.jsonl`.

## Files changed
- `scripts/monitor_carousell_sg.sh`
