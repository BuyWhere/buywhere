# BUY-60877 Comprehensive Color-Contrast Fix

## Issue Description
WCAG 2.1 AA color-contrast violations across site-wide pages:
- Homepage: 6 violations
- /laptop-singapore: 20 violations
- /best-gaming-laptops-us: 16 violations  
- /search: 2 violations

WCAG 2.1 AA requires 4.5:1 contrast ratio for normal text. Low-contrast classes were below this threshold.

## Fix Strategy
Systematic replacement of low-contrast Tailwind classes:
- `text-slate-400` → `text-slate-500/600/700` (depending on context)
- `text-gray-400` → `text-gray-500/600` (depending on context)
- `text-indigo-200` → `text-indigo-300/400` (where applicable)
- Background context considered for appropriate replacement

## Files Modified

### Core Product Components
1. **src/components/seo/SeoLandingPage.tsx**
   - Merchant/category text: `text-slate-500` → `text-slate-700`
   - "Current price" label: `text-slate-400` → `text-slate-600`
   - "Developer angle" label: `text-slate-400` → `text-slate-600`
   - Fallback brand text: `text-slate-400` → `text-slate-600`

2. **src/components/ProductCard.tsx**
   - Review count: `text-gray-400` → `text-gray-600`
   - Shipping info: `text-gray-500` → `text-gray-600`
   - Strike-through price: `text-gray-400` → `text-gray-500`

3. **src/components/compare/CompareProductsGrid.tsx**
   - Placeholder icon: `text-slate-400` → `text-slate-500`
   - Empty value placeholder: `text-slate-400` → `text-slate-500`
   - "No history" text: `text-slate-400` → `text-slate-500`
   - Compare button inactive state: `text-slate-400 hover:text-slate-600` → `text-slate-500 hover:text-slate-700`
   - "+N more" header: `text-slate-400` → `text-slate-500`

4. **src/components/compare/CompareBarChart.tsx**
   - Empty state and axis labels: `text-slate-400` → `text-slate-500`

5. **src/components/compare/CompareSelectButton.tsx**
   - Inactive state: `text-slate-400` → `text-slate-500`

### Deal & Price Components
6. **src/components/USDealsSection.tsx**
   - Strike-through prices: `text-gray-400 line-through` → `text-gray-500 line-through`
   - Timestamp/disclaimer text: `text-gray-400` → `text-gray-600`

7. **src/components/DealOfTheDay.tsx**
   - Strike-through price: `text-gray-400 line-through` → `text-gray-500 line-through`

### UI Components
8. **src/components/PopularComparisons.tsx**
   - Footer section header: `text-slate-400` → `text-slate-600`

## Expected Results
All critical product listing and comparison pages should now pass WCAG 2.1 AA color-contrast requirements:
- Homepage: 0 violations
- /laptop-singapore: 0 violations  
- /best-gaming-laptops-us: 0 violations
- /search: 0 violations

## Notes
- Maintained semantic hierarchy (600 for labels, 500 for decorative/secondary text, 700 for emphasis)
- Preserved visual design intent while meeting accessibility standards
- Fixed strike-through prices to be readable as discount indicators
