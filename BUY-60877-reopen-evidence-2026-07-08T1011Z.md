# BUY-60877 reopen verification — 2026-07-08T10:11Z

QA reopened because axe-core@4.10.2 still reported:
- `/`: 6 `color-contrast` violations targeting `.text-gray-400`, `.text-indigo-200`, and `.ml-2` elements.
- `/laptop-singapore`: 16 `color-contrast` violations targeting merchant tags using muted gray text on `.bg-slate-100` badges.

## Fix applied

- `src/components/TrustLayer.tsx`: raised homepage trust labels from `text-gray-400` to `text-gray-600`.
- `src/components/ui/MerchantBadge.tsx`: raised fallback merchant badge text from `text-gray-600` to `text-gray-700` for better contrast on `bg-gray-100`.
- Existing homepage code-demo and CTA contrast fixes remain in `src/app/page.tsx`.

## Focused verification

Ran a local Playwright + axe-core probe against only the reopened failing routes:

```bash
node <<'NODE'
const { chromium } = require('@playwright/test');
const fs = require('fs');
const axeSource = fs.readFileSync(require.resolve('axe-core'), 'utf8');
const routes = ['/', '/laptop-singapore'];
(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const route of routes) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(`http://127.0.0.1:3100${route}`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(async () => {
      return await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } });
    });
    results.push({ route, violations: result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, html: n.html, failureSummary: n.failureSummary })) })) });
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
  const total = results.reduce((sum, route) => sum + route.violations.reduce((s, v) => s + v.nodes.length, 0), 0);
  process.exitCode = total === 0 ? 0 : 1;
})();
NODE
```

Result:

```json
[
  {
    "route": "/",
    "violations": []
  },
  {
    "route": "/laptop-singapore",
    "violations": []
  }
]
```

## Notes

- The dev server emitted an existing Next middleware `EvalError: Code generation from strings disallowed for this context` during shutdown after the successful axe run. The focused axe command exited `0` with zero contrast violations on both routes before the server was interrupted.
