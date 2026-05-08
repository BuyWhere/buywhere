---
title: "How to Build a Price Comparison Browser Extension with BuyWhere API"
slug: "build-price-comparison-browser-extension"
description: "Step-by-step guide to building a browser extension that shows price comparisons directly on retailer product pages using the BuyWhere API. Covers Chrome extension architecture, content scripts, API integration, and deployment."
category: Blog
tags:
  - "browser extension development"
  - "price comparison extension"
  - "Chrome extension tutorial"
  - "BuyWhere API tutorial"
  - "shopping extension"
  - "price tracker browser extension"
  - "MCP server"
schema_type: Article
published: true
updated: 2026-05-08
---

# How to Build a Price Comparison Browser Extension with BuyWhere API

Browser extensions let you surface price comparisons directly on retailer product pages — showing users whether they're getting the best price without leaving the page. This guide walks through building a Chrome extension that queries the BuyWhere API and displays competing prices from other retailers on any product page.

---

## What You'll Build

A Chrome extension that:
1. Detects when you're on a product page
2. Extracts the product name
3. Queries BuyWhere for the same product at other retailers
4. Displays a price comparison popup on the page

---

## Prerequisites

- Chrome browser (or Chromium-based browser)
- Node.js 18+
- A BuyWhere API key ([get one free](https://buywhere.ai/api-keys))
- Basic JavaScript knowledge

---

## Project Structure

```
price-comparison-extension/
├── manifest.json
├── background.js
├── content.js
├── popup.html
├── popup.js
├── style.css
└── .env (API key)
```

---

## 1. Set Up manifest.json

Define the extension's permissions and structure.

```json
{
  "manifest_version": 3,
  "name": "Price Compare BuyWhere",
  "version": "1.0.0",
  "description": "Compare prices across retailers directly on product pages",
  "permissions": ["activeTab", "storage"],
  "host_permissions": [
    "https://*.amazon.com/*",
    "https://*.walmart.com/*",
    "https://*.bestbuy.com/*",
    "https://*.target.com/*",
    "https://api.buywhere.ai/*"
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": "icon.png"
  },
  "content_scripts": [
    {
      "matches": ["https://*.amazon.com/*", "https://*.walmart.com/*", "https://*.bestbuy.com/*"],
      "js": ["content.js"],
      "css": ["style.css"]
    }
  ],
  "background": {
    "service_worker": "background.js"
  }
}
```

---

## 2. Background Script — API Proxy

Handle API calls from the content script to avoid CORS issues.

```javascript
// background.js
const BUYWHERE_API_KEY = 'YOUR_API_KEY';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SEARCH_PRODUCT') {
    fetch(`https://api.buywhere.ai/v1/products/search?q=${encodeURIComponent(request.query)}&country=${request.country}&limit=5`, {
      headers: {
        'Authorization': `Bearer ${BUYWHERE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    })
    .then(res => res.json())
    .then(data => sendResponse({ success: true, data }))
    .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // async response
  }
});
```

---

## 3. Content Script — Detect Product Pages

Extract the product name from retailer pages.

```javascript
// content.js

function extractProductName() {
  const url = window.location.hostname;

  if (url.includes('amazon.com')) {
    return document.getElementById('productTitle')?.innerText?.trim();
  }
  if (url.includes('walmart.com')) {
    return document.querySelector('[data-testid="product-title"]')?.innerText?.trim();
  }
  if (url.includes('bestbuy.com')) {
    return document.querySelector('.sku-title h1')?.innerText?.trim();
  }
  if (url.includes('target.com')) {
    return document.querySelector('[data-test="product-title"]')?.innerText?.trim();
  }

  // Generic fallback: look for h1
  return document.querySelector('h1')?.innerText?.trim();
}

function initPriceComparison() {
  const productName = extractProductName();
  if (!productName) return;

  // Determine country from domain
  const country = window.location.hostname.includes('.sg') ? 'SG' :
                  window.location.hostname.includes('.my') ? 'MY' : 'US';

  // Send to background script
  chrome.runtime.sendMessage({
    type: 'SEARCH_PRODUCT',
    query: productName,
    country
  }, response => {
    if (response.success) {
      showPriceComparison(response.data.products);
    }
  });
}
```

---

## 4. Display the Price Comparison Popup

Render a floating widget on the page.

```javascript
// content.js (continued)

function showPriceComparison(products) {
  // Remove existing widget
  const existing = document.getElementById('buywhere-price-widget');
  if (existing) existing.remove();

  // Filter out the current retailer
  const currentDomain = window.location.hostname.replace('www.', '');
  const otherRetailers = products.filter(p => !p.domain.includes(currentDomain));

  if (otherRetailers.length === 0) return;

  const widget = document.createElement('div');
  widget.id = 'buywhere-price-widget';

  const sorted = otherRetailers.sort((a, b) => a.price - b.price);
  const best = sorted[0];

  widget.innerHTML = `
    <div class="bw-header">
      <strong>💰 Price Compare</strong>
      <button class="bw-close" onclick="this.closest('#buywhere-price-widget').remove()">×</button>
    </div>
    <div class="bw-body">
      <p class="bw-best">Best price: <strong>$${best.price}</strong> at ${best.domain}</p>
      <ul class="bw-list">
        ${sorted.slice(0, 5).map(p => `
          <li>
            <span class="bw-merchant">${p.domain}</span>
            <span class="bw-price">$${p.price}</span>
            ${p.in_stock ? '<span class="bw-stock">In stock</span>' : '<span class="bw-oos">Out of stock</span>'}
          </li>
        `).join('')}
      </ul>
      <a class="bw-cta" href="https://buywhere.ai" target="_blank">View all on BuyWhere →</a>
    </div>
  `;

  document.body.appendChild(widget);
}

// Auto-init when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPriceComparison);
} else {
  initPriceComparison();
}
```

---

## 5. Style the Widget

```css
/* style.css */

#buywhere-price-widget {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 300px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  z-index: 999999;
  border: 1px solid #e5e7eb;
}

.bw-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f8f9fa;
  border-radius: 12px 12px 0 0;
  border-bottom: 1px solid #e5e7eb;
}

.bw-close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #666;
}

.bw-body {
  padding: 16px;
}

.bw-best {
  font-size: 14px;
  color: #333;
  margin: 0 0 12px;
}

.bw-best strong {
  color: #16a34a;
  font-size: 18px;
}

.bw-list {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
}

.bw-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #f3f4f6;
  font-size: 13px;
}

.bw-merchant {
  color: #666;
}

.bw-price {
  font-weight: 600;
  color: #333;
}

.bw-stock {
  font-size: 11px;
  color: #16a34a;
  background: #dcfce7;
  padding: 2px 6px;
  border-radius: 4px;
}

.bw-oos {
  font-size: 11px;
  color: #dc2626;
  background: #fee2e2;
  padding: 2px 6px;
  border-radius: 4px;
}

.bw-cta {
  display: block;
  text-align: center;
  background: #2563eb;
  color: white;
  text-decoration: none;
  padding: 10px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
}

.bw-cta:hover {
  background: #1d4ed8;
}
```

---

## 6. Popup UI (Optional)

A popup for manual search when the content script doesn't trigger.

```html
<!-- popup.html -->
<!DOCTYPE html>
<html>
<head>
  <style>
    body { width: 320px; padding: 16px; font-family: sans-serif; }
    input { width: 100%; padding: 8px; margin-bottom: 8px; }
    button { width: 100%; padding: 8px; background: #2563eb; color: white; border: none; border-radius: 4px; }
    #results { margin-top: 12px; }
    .result { padding: 8px 0; border-bottom: 1px solid #eee; font-size: 13px; }
  </style>
</head>
<body>
  <h3>Price Compare</h3>
  <input type="text" id="query" placeholder="Enter product name..." />
  <button id="search">Search</button>
  <div id="results"></div>
  <script src="popup.js"></script>
</body>
</html>
```

```javascript
// popup.js
document.getElementById('search').addEventListener('click', async () => {
  const query = document.getElementById('query').value;
  const results = document.getElementById('results');
  results.innerHTML = 'Searching...';

  const response = await fetch(`https://api.buywhere.ai/v1/products/search?q=${encodeURIComponent(query)}&country=US&limit=5`, {
    headers: { 'Authorization': 'Bearer YOUR_API_KEY' }
  });
  const data = await response.json();

  results.innerHTML = data.products
    .map(p => `<div class="result"><strong>$${p.price}</strong> at ${p.domain} ${p.in_stock ? '✅' : '❌'}</div>`)
    .join('');
});
```

---

## 7. Load the Extension

1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the extension folder
5. Navigate to any product page on Amazon, Walmart, or Best Buy to see the widget

---

## 8. Production Considerations

- **API key security**: Store the API key in `chrome.storage.encrypted` or use a backend proxy to avoid exposing it in the client
- **Rate limiting**: Cache results for 5–10 minutes to avoid hitting API limits
- **Domain detection**: Add support for Shopee, Lazada, and other SEA retailers
- **User settings**: Let users configure which retailers to show and their target price

---

## Get Started

- [Get API key](https://buywhere.ai/api-keys) — free tier, 1,000 calls/month
- [API docs](https://api.buywhere.ai/docs)
- [MCP setup guide](https://buywhere.ai/integrate)

---

## Related Guides

- [Build a Price Comparison Tool with BuyWhere API](/blog/build-price-comparison-tool-buywhere-api) — Full comparison site guide
- [Build a Deal Alert App with BuyWhere API](/blog/build-deal-alert-app-buywhere-api) — Price alert app guide
- [Build an AI Shopping Agent with BuyWhere MCP](/blog/build-ai-shopping-agent-buywhere-mcp) — AI agent guide