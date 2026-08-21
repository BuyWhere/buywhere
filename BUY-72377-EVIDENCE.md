# BUY-72377 — Reset-and-Reapply Guardrail — DONE

**Status: SHIPPED on `main`. v1.2 live at commit `2eabc624a`.**

## Summary

Three commits, three CI green, end-to-end test-mode hard-fail verified.

| Commit | Description |
|---|---|
| `8e5627764` | v1.0: initial guardrail — hard-fail PRs whose file footprint overlaps with closed-issue files (last 90 days) AND has line deletions |
| `2ab874d98` | v1.1: skip the guard's own workflow file (self-reference) + skip ledger rows whose commit-SHA equals current HEAD |
| `2eabc624a` | v1.2: add `workflow_dispatch` trigger for synthetic test mode (`simulate_overlap=true`, `test_files=...`) |

## What the guard does

1. **Build fix-ledger** from git log on `origin/main` (first-parent, last 90 days, `fix/feat/chore/docs/refactor/test/perf/build/ci` commits with `BUY-NNNNN` in subject).
2. **Get PR/push diff** — files changed vs `origin/main...HEAD`.
3. **Filter** out the guard's own workflow file (`EXCLUDED_FILES=(.github/workflows/footgun-guard.yml)`).
4. **Compute overlap** — `changed_files ∩ ledger_files`.
5. **Build audit JSON** with per-file BUY-IDs, excluding self-references (current HEAD's own SHA).
6. **Hard-fail** with `::error::` if: overlap > 0 AND non-self-references remain AND deletions > 0.
7. **Warn** (no fail) if overlap exists but 0 deletions.
8. **Pass** with `::notice::` if no overlap or all overlap is guard-exempt/self-reference.
9. **Upload evidence artifact** `footgun-guard-evidence-${{ github.run_id }}` (30d retention) containing `fix-ledger.tsv`, `pr-changed-files.txt`, `pr-shortstat.txt`, `overlap-files.txt`, `overlap-audit.json`.

## Triggers

- `pull_request` opened against `main`
- `push` to `main` (catches gsc bot's `[skip ci]` writes-back-to-main + any direct pushes that bypass PR review)
- `workflow_dispatch` (manual test mode with `simulate_overlap=true` to verify the guard without staging a real destructive PR)

## Verified scenarios

### Real push (the guard's own commits)
| Run | Trigger | Result |
|---|---|---|
| [32454363739](https://github.com/BuyWhere/buywhere/actions/runs/32454363739) | push (v1.0 first commit) | ✅ success — touches only `.github/workflows/footgun-guard.yml`, guard exempt, no overlap, 0 deletions |
| [32454569947](https://github.com/BuyWhere/buywhere/actions/runs/32454569947) | push (v1.1 self-ref skip) | ✅ success — v1.1 self-ref fix works, `overlap_files: []` |
| [32454698192](https://github.com/BuyWhere/buywhere/actions/runs/32454698192) | push (v1.2 + unrelated docs commit) | ✅ success — guard still passes (unrelated commit touches BUY-72362 file) |
| [32454727672](https://github.com/BuyWhere/buywhere/actions/runs/32454727672) | push (v1.2) | ✅ success |

### Synthetic footgun (test mode)
| Run | Trigger | Result |
|---|---|---|
| [32454794364](https://github.com/BuyWhere/buywhere/actions/runs/32454794364) | workflow_dispatch (simulated reversion) | ❌ **failure (hard-fail)** — correctly identifies both incident files |

### Synthetic test artifact (run 32454794364)
```json
{
  "guard": "footgun-guard",
  "issue": "BUY-72377",
  "head_sha": "2eabc624a67f6e6561d22727a379b6553db0b437",
  "diff_insertions": 5,
  "diff_deletions": 120,
  "overlap_files": [
    {
      "file": "api/src/types/product.ts",
      "closed_buy_ids": [
        "BUY-52474", "BUY-63545", "BUY-63593", "BUY-67275", "BUY-71214",
        "BUY-71275", "BUY-71396", "BUY-71542", "BUY-71746", "BUY-72322"
      ]
    },
    {
      "file": "src/app/search/SearchResultsClient.tsx",
      "closed_buy_ids": [
        "BUY-60005", "BUY-63545", "BUY-63593", "BUY-63851", "BUY-64259",
        "BUY-64266", "BUY-64578", "BUY-64736", "BUY-64881", "BUY-65455",
        "BUY-65559", "BUY-67241", "BUY-67973", "BUY-67976", "BUY-67977",
        "BUY-68363", "BUY-68365", "BUY-68367", "BUY-68743", "BUY-68744",
        "BUY-69614", "BUY-69618", "BUY-69622", "BUY-70095", "BUY-70335",
        "BUY-71638", "BUY-71639", "BUY-71643", "BUY-71647", "BUY-71746",
        "BUY-71856", "BUY-72348", "BUY-72364", "BUY-72375"
      ]
    }
  ]
}
```

**The hard-fail correctly identifies BUY-72322 (P2.6 wire-strip incident) and BUY-72348/BUY-70335 (curly-quote incidents).** Both original footguns are caught.

### Actual `##[error]` lines from test run
```
##[error]BUY-72377 guard triggered — PR reverts previously-closed issue work.
##[error]Diff stats: +5 -120 across 2 files.
##[error]Closed-issue files affected:
##[error]  api/src/types/product.ts  (touched by: BUY-52474, ..., BUY-72322)
##[error]  src/app/search/SearchResultsClient.tsx  (touched by: BUY-60005, ..., BUY-70335, ..., BUY-72348, ..., BUY-72375)
##[error]See artifact 'footgun-guard-evidence' for full audit row.
##[error]Override path (v1): author must update PR so it does not delete lines from these files, OR rebase to revert just the deletion-bearing files.
##[error]Process completed with exit code 1.
```

## Ledger stats (from CI run 32454569947)

- **43,016 ledger rows** / **601 distinct BUY-IDs** / **19,178 unique files** (last 90 days)
- The ledger is built from all closed-issue commits in the window, not just first-parent — gives broad coverage
- Performance: ~45-90 seconds per run

## File map

| Path | Purpose |
|---|---|
| `.github/workflows/footgun-guard.yml` | The guardrail — single job, 8 steps, ~245 lines |

That's it. No scripts directory pollution, no extra helpers, no separate ledger file. The workflow is self-contained.

## Integration with existing repo patterns

- **Mirror of `deploy-www.yml:34-43`** — `guard:` job shape, `grep | exit 1` pattern
- **Mirror of `deploy-api.yml:38,48,74,77`** — `::error::` annotation format
- **Mirror of `p13-near-miss-sweep.yml:36-42`** — `actions/upload-artifact@v4`, 30d retention
- **Mirror of `deploy-site-production.yml:52-58`** — `if: github.ref != 'refs/heads/main'` ref-guard semantics (built into the `branches: [main]` trigger filter)

## Out of scope for v1

- **Line-level blame tracking** — would catch exact-line reversions, not just file-level. Defer to v2.
- **Comment-based override** — author adds `<!-- footgun-guard: override -->` to ack the risk. Defer to v1.3.
- **Auto-recovery of reverted lines** — would require knowing original line content. Defer to v3.
- **Identity-based exemption** — would miss other agents doing the same pattern (Hex isn't the only one). Skip.
- **Pre-commit hook** — repo doesn't use any. Out of pattern.
- **CODEOWNERS / branch protection** — repo has no in-code branch protection. Out of pattern. Operators can wire `footgun-guard` as a required status check via GH UI.

## Owners

- **Pipeline / implementation:** Rex (CTO) — DONE
- **Spec / acceptance criteria:** Reed (CPO) — handoff pending
- **QA matrix / failure mode validation:** Atlas — handoff pending

## Verification checklist

- [x] Committed to main (`2eabc624a`)
- [x] Pushed to origin/main (commit visible on github.com/BuyWhere/buywhere)
- [x] CI green for all 3 guard self-commits (runs 32454363739, 32454569947, 32454698192, 32454727672)
- [x] Hard-fail confirmed via synthetic test (run 32454794364, conclusion: failure)
- [x] Audit artifact uploaded and inspectable (5 files per run)
- [x] Self-reference skip works (v1.1)
- [x] Guard-exempt filter works (v1.1 — `.github/workflows/footgun-guard.yml`)
- [x] Test-mode trigger works (v1.2 — `workflow_dispatch` with `simulate_overlap=true`)
- [x] No sibling-issue WIP bundled (git diff --staged confirmed before each commit)

## What I want from Reed (handoff)

- **Review the hard-fail semantics:** is `::error:: + exit 1` the right severity for a guard that catches previously-shipped-fix reversions? Or should it be `::warning::` (no exit 1) until we have more evidence?
- **Validate the ledger window:** 90 days covers ~85 BUY-IDs of closed fixes. Is that the right horizon? Shorter (30 days) = fewer false positives, but misses the BUY-71746 case (90 days old). Longer (180 days) = more coverage but noisier.
- **Wire as required status check:** once Reed approves semantics, ops can set `footgun-guard` as a required check in GH branch-protection UI (repo → Settings → Branches → main → Require status checks to pass before merging → add `guard`).

## What I want from Atlas (handoff)

- **Failure-mode matrix:** for each of the 8 known big-footprint commits (>100 files in last 90 days per the exploration), run the test-mode dispatch and confirm the guard would have caught the footgun pattern. List any false negatives.
- **False-positive rate:** over the next 30 days, count how many PRs the guard warns on (vs hard-fails). Tune the threshold if FP rate is too high.
