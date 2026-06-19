# BUY-53395 safe-data-cleanup dry-run investigation

Timestamp: 2026-06-19T06:00:00Z

## Summary

- Investigated the repeated `120s` timeout for workspace `5bc984ee-e2d2-4312-9e6c-b2864524a21f` when running `./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --grace=0`.
- The timeout is caused by the script's per-file `lsof` gate, not by `find`, catalog sampling, or R2 checks.
- This workspace has `368` cleanup candidates, including `324` `data/shopify-discovery/*/products.jsonl` files, so the per-file `lsof` cost dominates the dry run.
- Benchmark evidence:
  - Default dry run timed out after `30.01s` while only processing `28` files.
  - The same dry run with `--skip-lsof` reached the script's `MAX_FILES=200` cap in `6.01s`.
  - `50x lsof -- <file>` on one representative candidate took `48.13s`.
  - `50x wc -l < <file>` on the same candidate took `0.26s`.

## Commands Run

```bash
find /paperclip/instances/default/workspaces/5bc984ee-e2d2-4312-9e6c-b2864524a21f/data \
  -type f \( -name '*.ndjson' -o -name '*.jsonl' -o -name '*.gz' \) \
  ! -path '*/checkpoints/*' ! -path '*/ingest_ready/*' ! -path '*/merchants/*' \
  ! -path '*/_trash/*' ! -name '*checkpoint*' ! -name '*-state.json' \
  ! -name '*.pid' ! -name '*_cleanup_log*' | wc -l

find /paperclip/instances/default/workspaces/5bc984ee-e2d2-4312-9e6c-b2864524a21f/data \
  -type f -name '*.ingested.json' | wc -l

cd /paperclip/instances/default/workspaces/5bc984ee-e2d2-4312-9e6c-b2864524a21f
/usr/bin/time -f 'elapsed=%E cpu=%P maxrss=%MKB' \
  timeout 30 ./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --grace=0

/usr/bin/time -f 'elapsed=%E cpu=%P maxrss=%MKB' \
  timeout 30 ./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --skip-lsof --grace=0

f=$(find data -type f \( -name '*.ndjson' -o -name '*.jsonl' -o -name '*.gz' \) \
  ! -path '*/checkpoints/*' ! -path '*/ingest_ready/*' ! -path '*/merchants/*' \
  ! -path '*/_trash/*' ! -name '*checkpoint*' ! -name '*-state.json' \
  ! -name '*.pid' ! -name '*_cleanup_log*' | head -n 1)

/usr/bin/time -f 'lsof elapsed=%E cpu=%P' \
  bash -lc 'for i in $(seq 1 50); do lsof -- "$0" >/dev/null 2>&1 || true; done' "$f"

/usr/bin/time -f 'wcl elapsed=%E cpu=%P' \
  bash -lc 'for i in $(seq 1 50); do wc -l < "$0" >/dev/null; done' "$f"
```

## Findings

### Candidate shape

- Total cleanup candidates matching the script's `find`: `368`
- Sibling `.ingested.json` markers in the workspace: `24`
- `shopify-discovery/*/products.jsonl` candidates alone: `324`

This means the script spends most of its time traversing many small discovery outputs instead of a few large files.

### Timed dry-run comparison

Default command:

```text
timeout 30 ./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --grace=0
```

Observed result:

```text
timed out after 30.01s
processed 28 files before termination
```

Comparison command:

```text
timeout 30 ./safe-data-cleanup.sh --skip-r2 --skip-catalog-check --skip-lsof --grace=0
```

Observed result:

```text
cap: MAX_FILES reached
--- files=200 ... apply=0
elapsed=0:06.01
```

That changes throughput from roughly `0.9` files/sec to roughly `33` files/sec.

### Hot-path benchmark

Representative candidate file:

```text
data/buy30620_rejected_domains.jsonl
```

Benchmarks:

```text
50x lsof -- <file>      => 48.13s
50x wc -l < <file>      => 0.26s
```

The per-file `lsof` call is therefore about `185x` slower than the line-count read on the same file and is sufficient by itself to explain the timeout.

## Conclusion

- Root cause: the default `lsof` gate in `safe-data-cleanup.sh` is too expensive for this workspace's `shopify-discovery` fanout.
- The previously suspected catalog and R2 paths are not involved in this timeout because the slow run already uses `--skip-catalog-check --skip-r2`.
- A dry-run-only mitigation is straightforward: add `--skip-lsof` when probing this workspace, or when running fleet dry-run sweeps that only need a size estimate.

## Recommended Follow-up

- If the goal is only to measure reclaimable bytes during dry runs, use `--skip-lsof` for the routine probe path.
- Keep the default `lsof` behavior for `--apply` runs unless a separate safety review decides the open-file guard is unnecessary there as well.
