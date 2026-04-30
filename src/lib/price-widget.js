"use client";

const WIDGET_REGISTRY = new Map();

class PriceWidgetLoader {
  constructor(options = {}) {
    this.apiKey = options.apiKey || "";
    this.baseUrl = options.baseUrl || "/api";
    this.defaultCurrency = options.defaultCurrency || "S$";
    this.defaultCountry = options.defaultCountry || "SG";
    this.cache = new Map();
    this.cacheTimeout = options.cacheTimeout || 5 * 60 * 1000;
  }

  async fetchPriceData(productQuery, options = {}) {
    const cacheKey = `price-${productQuery}-${JSON.stringify(options)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const params = new URLSearchParams({
        query: productQuery,
        country: options.country || this.defaultCountry,
        ...options,
      });

      const response = await fetch(`${this.baseUrl}/prices?${params}`, {
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
        },
      });

      if (!response.ok) {
        throw new Error(`Price fetch failed: ${response.status}`);
      }

      const data = await response.json();
      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      console.error("[PriceWidget] Fetch error:", error);
      return this.getMockPriceData(productQuery, options);
    }
  }

  getMockPriceData(productQuery, options = {}) {
    const merchants = this.getMerchantList(options.region || "sea");
    const seed = productQuery.split("").reduce((sum, c) => sum + c.charCodeAt(0), 0);
    const basePrice = 25 + (seed % 180);
    const platformCount = 2 + (seed % 4);

    const prices = merchants.slice(0, platformCount).map((merchant, index) => {
      const price = basePrice + index * 7 + ((seed + index) % 9);
      const isUS = options.region === "us" || options.country === "US";
      return {
        merchant,
        price: price.toFixed(2),
        currency: isUS ? "$" : "S$",
        url: "#",
        in_stock: (seed + index) % 5 !== 0,
        rating: 3.8 + ((seed + index) % 12) / 10,
        last_updated: new Date(Date.now() - index * 3600000).toISOString(),
      };
    });

    prices.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

    const lowestPrice = prices[0];
    const highestPrice = prices[prices.length - 1];

    return {
      productName: productQuery,
      prices,
      lowestPrice,
      highestPrice,
      priceDiff: (parseFloat(highestPrice.price) - parseFloat(lowestPrice.price)).toFixed(2),
    };
  }

  getMerchantList(region) {
    if (region === "us") {
      return ["Amazon.com", "Walmart", "Target", "Best Buy", "eBay"];
    }
    return ["Shopee", "Lazada", "Amazon.sg", "Carousell", "Qoo10"];
  }

  clearCache() {
    this.cache.clear();
  }
}

const defaultLoader = new PriceWidgetLoader();

const CURRENCY_LOCALE_MAP = {
  USD: "en-US",
  S$: "en-SG",
  A$: "en-AU",
  "£": "en-GB",
  "€": "de-DE",
};

const CURRENCY_SYMBOL_MAP = {
  USD: "$",
  S$: "S$",
  A$: "A$",
  "£": "£",
  "€": "€",
};

function getLocaleForCurrency(currency) {
  return CURRENCY_LOCALE_MAP[currency] || "en-SG";
}

function getSymbolForCurrency(currency) {
  return CURRENCY_SYMBOL_MAP[currency] || currency;
}

function formatPrice(price, currency = "S$") {
  const num = parseFloat(price);
  const locale = getLocaleForCurrency(currency);
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return `${getSymbolForCurrency(currency)} ${formatted}`;
}

function getPlatformColors(platform) {
  const colors = {
    Shopee: { bg: "bg-red-50", text: "text-red-600", border: "border-red-200" },
    Lazada: { bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-200" },
    "Amazon.sg": { bg: "bg-orange-50", text: "text-orange-600", border: "border-orange-200" },
    "Amazon.com": { bg: "bg-orange-50", text: "text-orange-600", border: "border-orange-200" },
    Carousell: { bg: "bg-green-50", text: "text-green-600", border: "border-green-200" },
    Qoo10: { bg: "bg-purple-50", text: "text-purple-600", border: "border-purple-200" },
    Walmart: { bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-200" },
    "Best Buy": { bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-200" },
    Target: { bg: "bg-red-50", text: "text-red-600", border: "border-red-200" },
    eBay: { bg: "bg-indigo-50", text: "text-indigo-600", border: "border-indigo-200" },
  };
  return colors[platform] || { bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" };
}

function createPriceBadgeElement(priceData, options = {}) {
  const { maxPlatforms = 4, showPriceDiff = false, className = "" } = options;
  const container = document.createElement("div");
  container.className = `bw-widget bw-widget-badge inline-flex items-center flex-wrap gap-2 ${className}`;

  const displayedPlatforms = priceData.prices.slice(0, maxPlatforms);
  const remainingCount = priceData.prices.length - maxPlatforms;

  displayedPlatforms.forEach((item) => {
    const style = getPlatformColors(item.merchant);
    const badge = document.createElement("a");
    badge.href = item.url;
    badge.target = "_blank";
    badge.rel = "noopener noreferrer";
    badge.className = `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all hover:shadow-sm ${style.bg} ${style.text} ${style.border}`;
    badge.innerHTML = `
      <span class="w-1.5 h-1.5 rounded-full ${item.in_stock ? "bg-green-500" : "bg-red-400"}"></span>
      <span>${item.merchant}</span>
      <span class="font-semibold">${formatPrice(item.price, item.currency)}</span>
    `;
    container.appendChild(badge);
  });

  if (remainingCount > 0) {
    const more = document.createElement("span");
    more.className = "text-xs text-gray-500 px-1";
    more.textContent = `+${remainingCount} more`;
    container.appendChild(more);
  }

  if (showPriceDiff && priceData.prices.length > 1) {
    const diff = document.createElement("span");
    diff.className = "text-xs text-gray-400";
    diff.textContent = `(diff: ${formatPrice(priceData.priceDiff)})`;
    container.appendChild(diff);
  }

  return container;
}

function createPriceCardElement(priceData, options = {}) {
  const { className = "" } = options;
  const container = document.createElement("div");
  container.className = `bw-widget bw-widget-card bg-white rounded-xl border border-gray-100 p-4 ${className}`;

  const lowestPrice = priceData.lowestPrice;
  const savings = priceData.prices.length > 1
    ? ((parseFloat(priceData.highestPrice.price) - parseFloat(lowestPrice.price)) / parseFloat(priceData.highestPrice.price) * 100).toFixed(0)
    : 0;

  container.innerHTML = `
    <div class="flex items-center justify-between mb-3">
      <span class="text-sm text-gray-500">Lowest Price</span>
      <span class="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
        ${lowestPrice.in_stock ? "In Stock" : "Out of Stock"}
      </span>
    </div>
    <div class="text-2xl font-bold text-indigo-600 mb-1">
      ${formatPrice(lowestPrice.price, lowestPrice.currency)}
    </div>
    <div class="text-xs text-gray-500 mb-3">at ${lowestPrice.merchant}</div>
    ${priceData.prices.length > 1 ? `
      <div class="flex items-center gap-2 text-sm">
        <span class="text-gray-400 line-through">${formatPrice(priceData.highestPrice.price, priceData.highestPrice.currency)}</span>
        <span class="text-green-600 font-medium">Save ${savings}%</span>
      </div>
    ` : ""}
    <a href="${lowestPrice.url}" target="_blank" rel="noopener noreferrer"
       class="mt-3 block w-full py-2 px-4 bg-indigo-600 text-white text-center text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
      View Deal
    </a>
  `;

  return container;
}

function createPriceComparisonElement(priceData, options = {}) {
  const { maxMerchants = 6, showRating = true, className = "" } = options;
  const container = document.createElement("div");
  container.className = `bw-widget bw-widget-comparison ${className}`;

  const table = document.createElement("table");
  table.className = "w-full text-sm";
  table.innerHTML = `
    <thead>
      <tr class="border-b border-gray-100">
        <th class="text-left py-2 px-3 font-medium text-gray-500">Merchant</th>
        <th class="text-right py-2 px-3 font-medium text-gray-500">Price</th>
        <th class="text-center py-2 px-3 font-medium text-gray-500">Status</th>
        ${showRating ? '<th class="text-center py-2 px-3 font-medium text-gray-500">Rating</th>' : ''}
        <th class="text-right py-2 px-3 font-medium text-gray-500"></th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");
  const displayedPrices = priceData.prices.slice(0, maxMerchants);

  displayedPrices.forEach((item) => {
    const style = getPlatformColors(item.merchant);
    const row = document.createElement("tr");
    row.className = "border-b border-gray-50 hover:bg-gray-50 transition-colors";
    row.innerHTML = `
      <td class="py-3 px-3">
        <span class="font-medium ${style.text}">${item.merchant}</span>
      </td>
      <td class="py-3 px-3 text-right font-semibold">
        ${formatPrice(item.price, item.currency)}
      </td>
      <td class="py-3 px-3 text-center">
        <span class="inline-flex items-center gap-1">
          <span class="w-2 h-2 rounded-full ${item.in_stock ? "bg-green-500" : "bg-red-400"}"></span>
          <span class="text-xs text-gray-500">${item.in_stock ? "In Stock" : "Out"}</span>
        </span>
      </td>
      ${showRating && item.rating ? `
        <td class="py-3 px-3 text-center">
          <span class="text-yellow-500">★</span> ${item.rating.toFixed(1)}
        </td>
      ` : '<td class="py-3 px-3"></td>'}
      <td class="py-3 px-3 text-right">
        <a href="${item.url}" target="_blank" rel="noopener noreferrer"
           class="px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded transition-colors">
          View
        </a>
      </td>
    `;
    tbody.appendChild(row);
  });

  container.appendChild(table);
  return container;
}

function createSkeletonLoader(type = "badge") {
  const container = document.createElement("div");
  container.className = "bw-widget bw-widget-skeleton animate-pulse";

  if (type === "badge") {
    container.className += " inline-flex items-center gap-2";
    for (let i = 0; i < 3; i++) {
      const skeleton = document.createElement("div");
      skeleton.className = "h-6 w-28 bg-gray-200 rounded-full";
      container.appendChild(skeleton);
    }
  } else if (type === "card") {
    container.className = "bw-widget bw-widget-skeleton p-4 bg-white rounded-xl border border-gray-100";
    container.innerHTML = `
      <div class="h-4 w-24 bg-gray-200 rounded mb-3"></div>
      <div class="h-8 w-32 bg-gray-200 rounded mb-2"></div>
      <div class="h-3 w-20 bg-gray-200 rounded mb-4"></div>
      <div class="h-10 w-full bg-gray-200 rounded-lg"></div>
    `;
  } else {
    container.className = "bw-widget bw-widget-skeleton";
    container.innerHTML = `
      <div class="h-8 w-full bg-gray-200 rounded mb-2"></div>
      <div class="h-6 w-3/4 bg-gray-200 rounded mb-2"></div>
      <div class="h-6 w-1/2 bg-gray-200 rounded"></div>
    `;
  }

  return container;
}

async function renderPriceWidget(containerOrSelector, options = {}) {
  const container = typeof containerOrSelector === "string"
    ? document.querySelector(containerOrSelector)
    : containerOrSelector;

  if (!container) {
    console.error("[PriceWidget] Container not found:", containerOrSelector);
    return null;
  }

  const {
    query,
    productId,
    type = "badge",
    loader = defaultLoader,
    showLoading = true,
    ...fetchOptions
  } = options;

  if (!query) {
    console.error("[PriceWidget] Query is required");
    return null;
  }

  if (showLoading) {
    container.innerHTML = "";
    container.appendChild(createSkeletonLoader(type));
  }

  try {
    const priceData = await loader.fetchPriceData(query, { productId, ...fetchOptions });

    container.innerHTML = "";

    let element;
    switch (type) {
      case "card":
        element = createPriceCardElement(priceData, options);
        break;
      case "comparison":
        element = createPriceComparisonElement(priceData, options);
        break;
      case "badge":
      default:
        element = createPriceBadgeElement(priceData, options);
        break;
    }

    container.appendChild(element);
    return element;
  } catch (error) {
    console.error("[PriceWidget] Render error:", error);
    container.innerHTML = `<div class="text-red-500 text-sm">Failed to load price data</div>`;
    return null;
  }
}

function registerWidgetType(name, config) {
  WIDGET_REGISTRY.set(name, config);
}

function getRegisteredWidgets() {
  return Array.from(WIDGET_REGISTRY.entries());
}

const PriceWidget = {
  Loader: PriceWidgetLoader,
  defaultLoader,
  render: renderPriceWidget,
  formatPrice,
  createPriceBadgeElement,
  createPriceCardElement,
  createPriceComparisonElement,
  createSkeletonLoader,
  registerWidgetType,
  getRegisteredWidgets,
};

export {
  PriceWidget,
  PriceWidgetLoader,
  renderPriceWidget,
  formatPrice,
  createPriceBadgeElement,
  createPriceCardElement,
  createPriceComparisonElement,
  createSkeletonLoader,
  registerWidgetType,
  getRegisteredWidgets,
};

export default PriceWidget;
