# BUY-78332 — CTA pill wraps to 4 lines (fix verified)

**Page:** https://buywhere.ai/best-gaming-laptops-us
**Viewport:** 1440x900
**Screenshot (card region):** `qa-evidence/BUY-78332-card-after.png`

## Root cause
`ProductGridCard` bottom row (non-compact) is `flex items-end justify-between gap-4`
sharing ~222px between price block + 2 CTAs. The affiliate `<a>` used
`rounded-full` (border-radius 9999px) without `whitespace-nowrap`, so when the
flex parent squeezed it, "Buy at Best Buy" wrapped to 4 vertical lines
inside a 62px-wide pill.

## Fix (src/components/seo/ProductGridCard.tsx, commit merged as 4e61f71e5)
- `rounded-full` → `rounded-lg` (8px rounded rectangle per issue spec)
- added `shrink-0` (CTA refuses to compress below content width)
- added `whitespace-nowrap` (label never wraps mid-phrase)
- CTA wrapper `flex items-center gap-2` → `flex flex-wrap items-center justify-end gap-2`
  so overflow wraps as whole buttons, not mid-word

## Verification (headless chromium, 1440x900, LIVE page)
| metric | before | after |
|---|---|---|
| width | 62px | 138px |
| height | 100px | 44px |
| lines | 4 ("Buy/at/Best/Buy") | 1 ("Buy at Best Buy") |
| border-radius | 9999px | 8px |

Acceptance gate (single line, legible at 1440x900): **MET**.

## Cross-page spot check (all ProductGridCard lanes)
- /best-gaming-laptops-us → Buy at Best Buy, 138x44
- /best-gaming-laptop-singapore → Compare prices 140x44
- /best-gaming-mice-us → Compare prices 140x44
- /best-gaming-monitors-us → compact lane OK

Deploy-www run 33365004856 → SUCCESS 06:45:40Z.
