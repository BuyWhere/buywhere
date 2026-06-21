# FTS p95 Baseline — 2026-06-21 05:42Z

Captured live against `https://api.buywhere.ai/v1/products/search` (production).

## Method

- 50 representative queries covering English/SEA/exact-SKU mix
- Single request each (no warmup), single connection
- All queries `limit=10`, mode not specified (defaults to FTS path)
- Timestamp: 2026-06-21T05:42Z

## Results

| Metric | Latency (ms) |
|--------|-------------:|
| min    |           61 |
| p50    |           89 |
| **p95**|      **186** |
| p99    |          857 |
| max    |          857 |

## Acceptance

- Threshold: post-hybrid degradation <= 10% of FTS baseline.
- Allowed hybrid p95: 186 * 1.10 = **204.6ms** (rounded to 205ms).
- Live `mode=hybrid` is currently falling through to FTS path (semantic lib removed
  per BUY-45741). When Jina v3 1024-dim fusion ships (BUY-52328 → BUY-41134 public
  REST), this baseline is the reference.

## Source queries (50)

birthday gift, running shoes, wireless earbuds, office chair, coffee maker, yoga mat,
sunglasses, watch, headphones, laptop bag, smartphone, fitness tracker, bluetooth
speaker, kitchen knife, cookware set, skincare, makeup, perfume, shampoo, toothbrush,
vacuum cleaner, air fryer, rice cooker, mattress, pillow, bedsheet, sofa, dining table,
bookshelf, shoe rack, lamp, fan, heater, aircon, refrigerator, washing machine,
microwave, oven, toaster, blender, iron, hair dryer, straightener, curler, shaver,
trimmer, sunscreen, moisturizer, cleanser, toner
