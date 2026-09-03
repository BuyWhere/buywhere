# BUY-67977 — Fix Evidence (2026-08-14)

## Reopen context

QA reopened at 2026-08-14T02:15Z after PR #431 (commit `6926603b`) shipped.
VidMee visual diff: outer card containers and bottom actions aligned, but
the subtitle/category slot still inconsistent — card 1 shows "Audio
Headphones" while cards 2–4 omit the line.

## Root cause (this heartbeat's discovery)

PR #431 reserved the meta-slot height (`min-h-[1.25rem] flex-wrap items-center
gap-x-2 gap-y-0.5`). It did NOT address the data problem: live API response
for `q=wireless+headphones&country=us` returns:

| Card | metadata.category | brand (any level) |
| ---- | ----------------- | ----------------- |
| 1    | "Audio Headphones" | (none) |
| 2    | (none)             | (none) |
| 3    | (none)             | (none) |
| 4    | (none)             | (none) |
| 5    | (none)             | (none) |
| 6    | (none)             | (none) |
| …    | (none)             | (none) |
| 22   | "Audio Headphones" | (none) |

22/22 results have **no brand**; 2/22 have `metadata.category` from the
catalog ingest lane (BUY-52807 family). The catalog ingest lane is the
named blocker for every catalog-data sentinel per the memory entry.

PR #431 fixed slot height. The remaining gap was slot **content**: only the
rare rows where the ingest lane happened to populate `metadata.category`
rendered any subtitle line at all.

## Fix shipped — PR #502, commit `2b5b8029f`

`deriveBrandFromTitle(title)` walks the leading tokens of the product name
until it finds a brand-shaped one:

- **Single-token brands**: "JBL", "Sony", "Skullcandy", "Edifier", "Creative"
- **ALLCAPS tokens**: "SONY", "JBL"
- **Hyphenated brands**: "Audio-Technica"
- **Compound brands**: "SoundPEATS", "JBuds"
- **"Brand by SubBrand" multi-word pattern**: "Beats by Dr. Dre"

A blocklist of generic product nouns (`wireless`, `headphones`, `anc`, …),
marketing adjectives (`premium`, `pro`, `plus`, …), colors/finishes (`black`,
`silver`, `matte`, …), and function words (`the`, `by`, `for`, …) prevents
the heuristic from picking up noise like "Wireless Headphones Black Edition".

`normalizeProduct` falls back to `deriveBrandFromTitle(name)` when
`item.brand` and `specBrand` are both null, so every card in a row renders
a brand line and the meta slot stays visually consistent.

PR: https://github.com/BuyWhere/buywhere/pull/502
Commit: `2b5b8029f5c036346acedc3bae3689df977771f6`
Merged: 2026-08-14T02:45:29Z

## Live re-verification (2026-08-14T02:48Z)

Headless Chromium probe against
`https://buywhere.ai/search?q=wireless%20headphones&country=us` at viewport
1440×900. Every card in the first row now renders a brand line:

```
[
  { title: "JBuds Open Headphone Open-Ear Wireless Headphones Cloud",
    meta: ["JBuds", "Audio Headphones"], height: 460 },
  { title: "JBuds Open Headphone Open-Ear Wireless Headphones Black",
    meta: ["JBuds"], height: 460 },
  { title: "Beats by Dr. Dre Solo3 Wireless Headphones MTU02LL/A Crystal",
    meta: ["Beats by Dr. Dre"], height: 460 },
  { title: "JBL Everest 310 On-Ear Wireless Headphones, with Google Assistant",
    meta: ["JBL"], height: 460 },
  { title: "JBL Reflect Fit In-Ear Wireless Headphones with Heart-Rate M",
    meta: ["JBL"], height: 460 },
  { title: "Sony MDR-100ABN/B H.ear Wireless Headphones",
    meta: ["Sony"], height: 460 }
]
```

**All cards are exactly 460 px tall** — slot height and slot content now
consistent. Card 1 also retains its "Audio Headphones" category from
`metadata.category`, but cards 2–6 all show a brand line where before they
showed nothing.

### Live chunk fingerprint

`https://buywhere.ai/_next/static/chunks/8252-0e72ea7c0c637f0c.js` contains
all 12 blocklist strings from the new heuristic (`wireless`, `bluetooth`,
`headphones`, `earbuds`, `cancelling`, `anc`, `hi-fi`, `foldable`, `stereo`,
`matte`, `glossy`, `graphite`) — confirming PR #502 is on live, not just
PR #431.

### Test coverage

`src/app/search/SearchResultsClient.brandDerivation.test.mjs` covers 16
cases (helper presence, blocklist coverage, normalizeProduct wiring, slot
reservation regression guard, single-word / ALLCAPS / multi-word extraction,
generic-noun rejection, length cap, full-row consistency). All 16 pass
under `node --test`:

```
ok 1 - BUY-67977: deriveBrandFromTitle helper exists in the source
ok 2 - BUY-67977: title brand blocklist excludes generic product nouns
ok 3 - BUY-67977: normalizeProduct falls back to derived brand
ok 4 - BUY-67977: deriveBrandFromTitle is exported via __test__ for direct coverage
ok 5 - BUY-67977: the SearchCard meta slot is still reserved with min-h-[1.25rem]
ok 6 - BUY-67977: single-word brand extraction (JBL/Sony/Skullcandy/Edifier/Creative)
ok 7 - BUY-67977: ALLCAPS first token
ok 8 - BUY-67977: multi-word "Beats by Dr. Dre" pattern
ok 9 - BUY-67977: hyphenated brand "Audio-Technica"
ok 10 - BUY-67977: compound brand "SoundPEATS"
ok 11 - BUY-67977: JBuds resolves to leading token (no parent brand guess)
ok 12 - BUY-67977: returns null on null/empty/whitespace
ok 13 - BUY-67977: returns null when the leading token is a generic product noun
ok 14 - BUY-67977: returns null when no token is brand-shaped
ok 15 - BUY-67977: caps candidate length at 32 chars
ok 16 - BUY-67977: a full row of "wireless headphones" cards all get a brand
```

## Side observations (not blockers)

- Stale 410 errors on the page (contents.mediadecathlon.com Sony photos) are
  separate upstream image-URL rot per BUY-64057 / BUY-67621 / BUY-67241 —
  unrelated to this fix. They were already present in the original QA repro
  and the BUY-68364 / BUY-3a0e6ebd Shopify CDN filter pattern already
  handles the same class of issue for the search-card image.
- Card 4 (JBL Everest) still overlays "Product image" on the JBL image
  because of the same upstream 410 — this is the QA-reported "fourth card
  overlays 'Product image'" observation from the reopen, and it persists.
  Fix is also upstream image-URL refresh (BUY-64057 family), not this
  ticket.
