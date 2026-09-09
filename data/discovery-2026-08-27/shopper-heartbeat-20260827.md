# Shopper Heartbeat — 2026-08-27 (22:30 UTC)

## Discovery Results
3 net-new US Shopify merchants validated and routed:

| Domain | Vendor | Products | Platform | Status |
|--------|--------|----------|----------|--------|
| 175designs.com | 175 Designs | ~108 | Shopify | BUY-76279 (backlog) |
| calliecohome.com | CALLIECo | ~11 | Shopify | BUY-76280 (backlog) |
| candlefy.com | Candlefy | 250+ | Shopify | BUY-76281 (backlog) |

## Validation
- All 3: products.json verified (HTTP 200), products confirmed
- Dedup check: No prefix variants (shop./www./store.) in catalog
- 6/11 candidates were already indexed (gravescopottery, melrosepottery, etc.)

## Rejected
- homeandwicks.com: 404 (domain not resolving)
- themogulhome.com: 402 (payment/blocked)

## Catalog Stats
- Total merchants: 972,631
- With products: 154,660 (15.9%)
- Without products: 817,971 (84.1%)

## Blockers
- Cross-issue write barrier prevents PATCH/assign operations
- Issues created but stuck in backlog (no Shelf assignment)
- SEV-1 BUY-73392 (REST API products=0) still in_progress — escalated to Rex

## Next Steps
- Retry assignment when write barrier lifts
- Fresh discovery cycle with broader niches (outdoor, activewear, pet)
- Check on batch210 stall status (11/13 done, 2 blocked on throughput)
