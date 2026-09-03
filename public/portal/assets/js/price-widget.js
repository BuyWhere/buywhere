(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global = global || self, global.PriceWidget = factory());
}(this, (function () {
  'use strict';

  var WIDGET_REGISTRY = new Map();

  var PriceWidgetLoader = function PriceWidgetLoader(options) {
    options = options || {};
    this.apiKey = options.apiKey || '';
    this.baseUrl = options.baseUrl || '/api';
    this.defaultCurrency = options.defaultCurrency || 'S$';
    this.defaultCountry = options.defaultCountry || 'SG';
    this.cache = new Map();
    this.cacheTimeout = options.cacheTimeout || 5 * 60 * 1000;
  };

  PriceWidgetLoader.prototype.fetchPriceData = async function fetchPriceData(productQuery, options) {
    options = options || {};
    var cacheKey = 'price-' + productQuery + '-' + JSON.stringify(options);
    var cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      var self = this;
      var params = new URLSearchParams({
        query: productQuery,
        country: options.country || this.defaultCountry
      });

      var response = await fetch(this.baseUrl + '/prices?' + params, {
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          this.apiKey && { Authorization: 'Bearer ' + this.apiKey }
        )
      });

      if (!response.ok) {
        throw new Error('Price fetch failed: ' + response.status);
      }

      var data = await response.json();
      this.cache.set(cacheKey, { data: data, timestamp: Date.now() });
      return data;
    } catch (error) {
      console.error('[PriceWidget] Fetch error:', error);
      return this.getMockPriceData(productQuery, options);
    }
  };

  PriceWidgetLoader.prototype.getMockPriceData = function getMockPriceData(productQuery, options) {
    options = options || {};
    var merchants = this.getMerchantList(options.region || 'sea');
    var seed = productQuery.split('').reduce(function(sum, c) { return sum + c.charCodeAt(0); }, 0);
    var basePrice = 25 + (seed % 180);
    var platformCount = 2 + (seed % 4);

    var prices = merchants.slice(0, platformCount).map(function(merchant, index) {
      var price = basePrice + index * 7 + ((seed + index) % 9);
      var isUS = options.region === 'us' || options.country === 'US';
      return {
        merchant: merchant,
        price: price.toFixed(2),
        currency: isUS ? '$' : 'S$',
        url: '#',
        in_stock: (seed + index) % 5 !== 0,
        rating: 3.8 + ((seed + index) % 12) / 10,
        last_updated: new Date(Date.now() - index * 3600000).toISOString()
      };
    });

    prices.sort(function(a, b) { return parseFloat(a.price) - parseFloat(b.price); });

    var lowestPrice = prices[0];
    var highestPrice = prices[prices.length - 1];

    return {
      productName: productQuery,
      prices: prices,
      lowestPrice: lowestPrice,
      highestPrice: highestPrice,
      priceDiff: (parseFloat(highestPrice.price) - parseFloat(lowestPrice.price)).toFixed(2)
    };
  };

  PriceWidgetLoader.prototype.getMerchantList = function getMerchantList(region) {
    if (region === 'us') {
      return ['Amazon.com', 'Walmart', 'Target', 'Best Buy', 'eBay'];
    }
    return ['Shopee', 'Lazada', 'Amazon.sg', 'Carousell', 'Qoo10'];
  };

  PriceWidgetLoader.prototype.clearCache = function clearCache() {
    this.cache.clear();
  };

  var defaultLoader = new PriceWidgetLoader();

  var CURRENCY_LOCALE_MAP = {
    USD: 'en-US',
    'S$': 'en-SG',
    'A$': 'en-AU',
    '\u00a3': 'en-GB',
    '\u20ac': 'de-DE'
  };

  var CURRENCY_SYMBOL_MAP = {
    USD: '$',
    'S$': 'S$',
    'A$': 'A$',
    '\u00a3': '\u00a3',
    '\u20ac': '\u20ac'
  };

  function getLocaleForCurrency(currency) {
    return CURRENCY_LOCALE_MAP[currency] || 'en-SG';
  }

  function getSymbolForCurrency(currency) {
    return CURRENCY_SYMBOL_MAP[currency] || currency;
  }

  function formatPrice(price, currency) {
    currency = currency || 'S$';
    var num = parseFloat(price);
    var locale = getLocaleForCurrency(currency);
    var formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num);
    return getSymbolForCurrency(currency) + ' ' + formatted;
  }

  function getPlatformColors(platform) {
    var colors = {
      'Shopee': { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200' },
      'Lazada': { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
      'Amazon.sg': { bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-200' },
      'Amazon.com': { bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-200' },
      'Carousell': { bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-200' },
      'Qoo10': { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200' },
      'Walmart': { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
      'Best Buy': { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
      'Target': { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200' },
      'eBay': { bg: 'bg-indigo-50', text: 'text-indigo-600', border: 'border-indigo-200' }
    };
    return colors[platform] || { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200' };
  }

  function createPriceBadgeElement(priceData, options) {
    options = options || {};
    var maxPlatforms = options.maxPlatforms || 4;
    var showPriceDiff = options.showPriceDiff || false;
    var className = options.className || '';

    var container = document.createElement('div');
    container.className = 'bw-widget bw-widget-badge inline-flex items-center flex-wrap gap-2 ' + className;

    var displayedPlatforms = priceData.prices.slice(0, maxPlatforms);
    var remainingCount = priceData.prices.length - maxPlatforms;

    displayedPlatforms.forEach(function(item) {
      var style = getPlatformColors(item.merchant);
      var badge = document.createElement('a');
      badge.href = item.url;
      badge.target = '_blank';
      badge.rel = 'noopener noreferrer';
      badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all hover:shadow-sm ' + style.bg + ' ' + style.text + ' ' + style.border;
      badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full ' + (item.in_stock ? 'bg-green-500' : 'bg-red-400') + '"></span>' +
        '<span>' + item.merchant + '</span>' +
        '<span class="font-semibold">' + formatPrice(item.price, item.currency) + '</span>';
      container.appendChild(badge);
    });

    if (remainingCount > 0) {
      var more = document.createElement('span');
      more.className = 'text-xs text-gray-500 px-1';
      more.textContent = '+' + remainingCount + ' more';
      container.appendChild(more);
    }

    if (showPriceDiff && priceData.prices.length > 1) {
      var diff = document.createElement('span');
      diff.className = 'text-xs text-gray-400';
      diff.textContent = '(diff: ' + formatPrice(priceData.priceDiff) + ')';
      container.appendChild(diff);
    }

    return container;
  }

  function createPriceCardElement(priceData, options) {
    options = options || {};
    var className = options.className || '';

    var container = document.createElement('div');
    container.className = 'bw-widget bw-widget-card bg-white rounded-xl border border-gray-100 p-4 ' + className;

    var lowestPrice = priceData.lowestPrice;
    var savings = priceData.prices.length > 1
      ? ((parseFloat(priceData.highestPrice.price) - parseFloat(lowestPrice.price)) / parseFloat(priceData.highestPrice.price) * 100).toFixed(0)
      : 0;

    container.innerHTML =
      '<div class="flex items-center justify-between mb-3">' +
        '<span class="text-sm text-gray-500">Lowest Price</span>' +
        '<span class="px-2 py-0.5 ' + (lowestPrice.in_stock ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700') + ' text-xs font-medium rounded-full">' +
          (lowestPrice.in_stock ? 'In Stock' : 'Out of Stock') +
        '</span>' +
      '</div>' +
      '<div class="text-2xl font-bold text-indigo-600 mb-1">' +
        formatPrice(lowestPrice.price, lowestPrice.currency) +
      '</div>' +
      '<div class="text-xs text-gray-500 mb-3">at ' + lowestPrice.merchant + '</div>' +
      (priceData.prices.length > 1
        ? '<div class="flex items-center gap-2 text-sm">' +
            '<span class="text-gray-400 line-through">' + formatPrice(priceData.highestPrice.price, priceData.highestPrice.currency) + '</span>' +
            '<span class="text-green-600 font-medium">Save ' + savings + '%</span>' +
          '</div>'
        : '') +
      '<a href="' + lowestPrice.url + '" target="_blank" rel="noopener noreferrer" class="mt-3 block w-full py-2 px-4 bg-indigo-600 text-white text-center text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">View Deal</a>';

    return container;
  }

  function createPriceComparisonElement(priceData, options) {
    options = options || {};
    var maxMerchants = options.maxMerchants || 6;
    var showRating = options.showRating !== false;
    var className = options.className || '';

    var container = document.createElement('div');
    container.className = 'bw-widget bw-widget-comparison ' + className;

    var table = document.createElement('table');
    table.className = 'w-full text-sm';
    table.innerHTML =
      '<thead>' +
        '<tr class="border-b border-gray-100">' +
          '<th class="text-left py-2 px-3 font-medium text-gray-500">Merchant</th>' +
          '<th class="text-right py-2 px-3 font-medium text-gray-500">Price</th>' +
          '<th class="text-center py-2 px-3 font-medium text-gray-500">Status</th>' +
          (showRating ? '<th class="text-center py-2 px-3 font-medium text-gray-500">Rating</th>' : '') +
          '<th class="text-right py-2 px-3 font-medium text-gray-500"></th>' +
        '</tr>' +
      '</thead>' +
      '<tbody></tbody>';

    var tbody = table.querySelector('tbody');
    var displayedPrices = priceData.prices.slice(0, maxMerchants);

    displayedPrices.forEach(function(item) {
      var style = getPlatformColors(item.merchant);
      var row = document.createElement('tr');
      row.className = 'border-b border-gray-50 hover:bg-gray-50 transition-colors';
      row.innerHTML =
        '<td class="py-3 px-3">' +
          '<span class="font-medium ' + style.text + '">' + item.merchant + '</span>' +
        '</td>' +
        '<td class="py-3 px-3 text-right font-semibold">' +
          formatPrice(item.price, item.currency) +
        '</td>' +
        '<td class="py-3 px-3 text-center">' +
          '<span class="inline-flex items-center gap-1">' +
            '<span class="w-2 h-2 rounded-full ' + (item.in_stock ? 'bg-green-500' : 'bg-red-400') + '"></span>' +
            '<span class="text-xs text-gray-500">' + (item.in_stock ? 'In Stock' : 'Out') + '</span>' +
          '</span>' +
        '</td>' +
        (showRating && item.rating
          ? '<td class="py-3 px-3 text-center"><span class="text-yellow-500">&#9733;</span> ' + item.rating.toFixed(1) + '</td>'
          : '<td class="py-3 px-3"></td>') +
        '<td class="py-3 px-3 text-right">' +
          '<a href="' + item.url + '" target="_blank" rel="noopener noreferrer" class="px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded transition-colors">View</a>' +
        '</td>';
      tbody.appendChild(row);
    });

    container.appendChild(table);
    return container;
  }

  function createSkeletonLoader(type) {
    type = type || 'badge';
    var container = document.createElement('div');
    container.className = 'bw-widget bw-widget-skeleton animate-pulse';

    if (type === 'badge') {
      container.className += ' inline-flex items-center gap-2';
      for (var i = 0; i < 3; i++) {
        var skeleton = document.createElement('div');
        skeleton.className = 'h-6 w-28 bg-gray-200 rounded-full';
        container.appendChild(skeleton);
      }
    } else if (type === 'card') {
      container.className = 'bw-widget bw-widget-skeleton p-4 bg-white rounded-xl border border-gray-100';
      container.innerHTML =
        '<div class="h-4 w-24 bg-gray-200 rounded mb-3"></div>' +
        '<div class="h-8 w-32 bg-gray-200 rounded mb-2"></div>' +
        '<div class="h-3 w-20 bg-gray-200 rounded mb-4"></div>' +
        '<div class="h-10 w-full bg-gray-200 rounded-lg"></div>';
    } else {
      container.className = 'bw-widget bw-widget-skeleton';
      container.innerHTML =
        '<div class="h-8 w-full bg-gray-200 rounded mb-2"></div>' +
        '<div class="h-6 w-3/4 bg-gray-200 rounded mb-2"></div>' +
        '<div class="h-6 w-1/2 bg-gray-200 rounded"></div>';
    }

    return container;
  }

  async function renderPriceWidget(containerOrSelector, options) {
    var container = typeof containerOrSelector === 'string'
      ? document.querySelector(containerOrSelector)
      : containerOrSelector;

    if (!container) {
      console.error('[PriceWidget] Container not found:', containerOrSelector);
      return null;
    }

    options = options || {};
    var query = options.query;
    var productId = options.productId;
    var type = options.type || 'badge';
    var loader = options.loader || defaultLoader;
    var showLoading = options.showLoading !== false;

    var fetchOptions = {};
    if (productId !== undefined) fetchOptions.productId = productId;
    if (options.country) fetchOptions.country = options.country;
    if (options.region) fetchOptions.region = options.region;
    if (options.currency) fetchOptions.currency = options.currency;

    if (!query) {
      console.error('[PriceWidget] Query is required');
      return null;
    }

    if (showLoading) {
      container.innerHTML = '';
      container.appendChild(createSkeletonLoader(type));
    }

    try {
      var priceData = await loader.fetchPriceData(query, fetchOptions);
      container.innerHTML = '';

      var element;
      switch (type) {
        case 'card':
          element = createPriceCardElement(priceData, options);
          break;
        case 'comparison':
          element = createPriceComparisonElement(priceData, options);
          break;
        case 'badge':
        default:
          element = createPriceBadgeElement(priceData, options);
          break;
      }

      container.appendChild(element);
      return element;
    } catch (error) {
      console.error('[PriceWidget] Render error:', error);
      container.innerHTML = '<div class="text-red-500 text-sm">Failed to load price data</div>';
      return null;
    }
  }

  function registerWidgetType(name, config) {
    WIDGET_REGISTRY.set(name, config);
  }

  function getRegisteredWidgets() {
    return Array.from(WIDGET_REGISTRY.entries());
  }

  var PriceWidget = {
    Loader: PriceWidgetLoader,
    defaultLoader: defaultLoader,
    render: renderPriceWidget,
    formatPrice: formatPrice,
    createPriceBadgeElement: createPriceBadgeElement,
    createPriceCardElement: createPriceCardElement,
    createPriceComparisonElement: createPriceComparisonElement,
    createSkeletonLoader: createSkeletonLoader,
    registerWidgetType: registerWidgetType,
    getRegisteredWidgets: getRegisteredWidgets
  };

  return PriceWidget;
})));
