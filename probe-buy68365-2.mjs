import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) BuyWhereBot/1.0' });
const page = await ctx.newPage();
let captured = null;
page.on('response', async r => {
  if (r.url().includes('/api/products/search') && r.status() === 200) {
    try { captured = await r.json(); } catch {}
  }
});
await page.goto('https://buywhere.ai/search?q=gaming%20laptop&country=us', { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(3000);
if (captured) {
  const items = captured.data || captured.items || captured.results || captured.products || [];
  console.log('total items:', items.length);
  items.forEach((it, i) => {
    const name = (it.name || it.title || '').slice(0, 80);
    const cat = it.category || (it.structured_specs && it.structured_specs.category) || (it.metadata && it.metadata.category) || '';
    console.log(`  ${i+1}. [${cat}] ${name}`);
  });
} else {
  console.log('no captured response');
}
await browser.close();
