"use strict";
var BuyWhereSDK = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.ts
  var index_exports = {};
  __export(index_exports, {
    AGENT_RESULT_SCHEMA: () => AGENT_RESULT_SCHEMA,
    AgentsClient: () => AgentsClient,
    ApiError: () => ApiError,
    AutocompleteClient: () => AutocompleteClient,
    BuyWhereClient: () => BuyWhereClient,
    BuyWhereError: () => BuyWhereError,
    BuyWhereSDK: () => BuyWhereSDK,
    CircuitBreaker: () => CircuitBreaker,
    CircuitBreakerError: () => CircuitBreakerError,
    MACHINE_RELEVANT_METRICS_SCHEMA: () => MACHINE_RELEVANT_METRICS_SCHEMA,
    MCP_TOOL_DEFINITIONS: () => MCP_TOOL_DEFINITIONS,
    METRICS_ENDPOINT_RESPONSE: () => METRICS_ENDPOINT_RESPONSE,
    OPENAI_TOOL_SCHEMAS: () => OPENAI_TOOL_SCHEMAS,
    ProductsClient: () => ProductsClient,
    QUERY_RESULT_SCHEMA: () => QUERY_RESULT_SCHEMA,
    SupportedCountries: () => SupportedCountries,
    SupportedRegions: () => SupportedRegions,
    ValidationError: () => ValidationError,
    WebhooksClient: () => WebhooksClient,
    createCategoryNotFoundResponse: () => createCategoryNotFoundResponse,
    createCircuitBreakerErrorResponse: () => createCircuitBreakerErrorResponse,
    createClient: () => createClient,
    createErrorResponse: () => createErrorResponse,
    createProductNotFoundResponse: () => createProductNotFoundResponse,
    createRateLimitErrorResponse: () => createRateLimitErrorResponse,
    createValidationErrorResponse: () => createValidationErrorResponse,
    isAuthError: () => isAuthError,
    isRetryableError: () => isRetryableError,
    mapHttpStatusToErrorCode: () => mapHttpStatusToErrorCode,
    parseApiErrorResponse: () => parseApiErrorResponse,
    validateAgentSearchParams: () => validateAgentSearchParams,
    validateBatchSearchParams: () => validateBatchSearchParams,
    validateCompareParams: () => validateCompareParams,
    validateDealsFeedParams: () => validateDealsFeedParams,
    validateDealsParams: () => validateDealsParams,
    validateGetPriceHistoryParams: () => validateGetPriceHistoryParams,
    validateGetProductAlertsParams: () => validateGetProductAlertsParams,
    validateGetProductReviewsParams: () => validateGetProductReviewsParams,
    validatePriceHistoryOptions: () => validatePriceHistoryOptions,
    validateProductId: () => validateProductId,
    validateSearchParams: () => validateSearchParams,
    validateWebhookEvents: () => validateWebhookEvents,
    validateWebhookUrl: () => validateWebhookUrl
  });

  // src/circuit-breaker.ts
  var DEFAULT_CIRCUIT_BREAKER_CONFIG = {
    failureThreshold: 3,
    resetTimeoutMs: 6e4,
    halfOpenMaxAttempts: 1
  };
  var CircuitBreakerError = class extends Error {
    constructor(circuitState, message) {
      super(message);
      this.circuitState = circuitState;
      this.name = "CircuitBreakerError";
    }
  };
  var CircuitBreaker = class {
    constructor(config) {
      this.config = config;
      this.state = "closed";
      this.failureCount = 0;
      this.lastFailureTime = null;
      this.halfOpenAttempts = 0;
    }
    get timeSinceLastFailure() {
      if (this.lastFailureTime === null) return 0;
      return Date.now() - this.lastFailureTime;
    }
    isOpen() {
      if (this.state === "open") {
        if (this.timeSinceLastFailure >= this.config.resetTimeoutMs) {
          this.state = "half-open";
          this.halfOpenAttempts = 0;
          return false;
        }
        return true;
      }
      return false;
    }
    async execute(fn) {
      if (this.isOpen()) {
        throw new CircuitBreakerError(
          this.state,
          "Circuit breaker is OPEN. Semantic search temporarily unavailable."
        );
      }
      if (this.state === "half-open") {
        if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
          throw new CircuitBreakerError(
            this.state,
            "Circuit breaker is HALF-OPEN. Max test attempts reached."
          );
        }
        this.halfOpenAttempts++;
      }
      try {
        const result = await fn();
        this.onSuccess();
        return result;
      } catch (error) {
        this.onFailure();
        throw error;
      }
    }
    onSuccess() {
      if (this.state === "half-open") {
        this.state = "closed";
        this.failureCount = 0;
      }
      this.halfOpenAttempts = 0;
    }
    onFailure() {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      if (this.state === "half-open") {
        this.state = "open";
      } else if (this.failureCount >= this.config.failureThreshold) {
        this.state = "open";
      }
    }
    getState() {
      return this.state;
    }
    getFailureCount() {
      return this.failureCount;
    }
    shouldFallback() {
      return this.isOpen();
    }
    reset() {
      this.state = "closed";
      this.failureCount = 0;
      this.lastFailureTime = null;
      this.halfOpenAttempts = 0;
    }
  };

  // src/client.ts
  var DEFAULT_BASE_URL = "https://api.buywhere.ai";
  var DEFAULT_RETRY_CONFIG = {
    maxRetries: 3,
    initialDelayMs: 1e3,
    maxDelayMs: 1e4,
    backoffMultiplier: 2
  };
  var BuyWhereClient = class {
    constructor(config) {
      if (typeof config === "string") {
        this.apiKey = config;
        this.baseUrl = DEFAULT_BASE_URL;
        this.timeout = 3e4;
        this.defaultCurrency = "SGD";
        this.defaultCountry = "SG";
        this.retryConfig = DEFAULT_RETRY_CONFIG;
        this.circuitBreaker = new CircuitBreaker(DEFAULT_CIRCUIT_BREAKER_CONFIG);
      } else {
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
        this.timeout = config.timeout ?? 3e4;
        this.defaultCurrency = config.defaultCurrency ?? "SGD";
        this.defaultCountry = config.defaultCountry ?? "SG";
        this.retryConfig = config.retry ? {
          maxRetries: config.retry.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries,
          initialDelayMs: config.retry.initialDelayMs ?? DEFAULT_RETRY_CONFIG.initialDelayMs,
          maxDelayMs: config.retry.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs,
          backoffMultiplier: config.retry.backoffMultiplier ?? DEFAULT_RETRY_CONFIG.backoffMultiplier
        } : DEFAULT_RETRY_CONFIG;
        const cbConfig = config.circuitBreaker ? {
          failureThreshold: config.circuitBreaker.failureThreshold ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold,
          resetTimeoutMs: config.circuitBreaker.resetTimeoutMs ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs,
          halfOpenMaxAttempts: config.circuitBreaker.halfOpenMaxAttempts ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.halfOpenMaxAttempts
        } : DEFAULT_CIRCUIT_BREAKER_CONFIG;
        this.circuitBreaker = new CircuitBreaker(cbConfig);
      }
    }
    async sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    async requestWithRetry(requestFn, options = {}) {
      if (options.skipRetry) {
        return requestFn();
      }
      let lastError = null;
      let delay = this.retryConfig.initialDelayMs;
      for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
        try {
          return await requestFn();
        } catch (error) {
          lastError = error;
          if (error instanceof BuyWhereError) {
            if (error.statusCode === 429 && attempt < this.retryConfig.maxRetries) {
              await this.sleep(delay);
              delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelayMs);
              continue;
            }
          }
          throw error;
        }
      }
      throw lastError;
    }
    getRequestHeaders(options = {}) {
      return {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options.headers
      };
    }
    async parseResponse(response) {
      if (response.status === 204) {
        return void 0;
      }
      const text = await response.text();
      if (!text) {
        return void 0;
      }
      return JSON.parse(text);
    }
    async buildError(response) {
      const requestIdHeader = response.headers.get("x-request-id");
      const responseText = await response.text().catch(() => "");
      const parsed = parseJson(responseText);
      const errorObject = isRecord(parsed) ? parsed : void 0;
      const message = getString(errorObject, ["message", "error_message"]) ?? getValidationMessage(errorObject) ?? responseText ?? `HTTP ${response.status}: ${response.statusText}`;
      const errorCode = getString(errorObject, ["errorCode", "error_code"]);
      const requestId = getString(errorObject, ["requestId", "request_id"]) ?? requestIdHeader ?? void 0;
      return new BuyWhereError(message, response.status, responseText || void 0, errorCode, requestId);
    }
    async fetchJson(path, method, options = {}, body) {
      return this.requestWithRetry(async () => {
        const url = `${this.baseUrl}${path}`;
        const headers = this.getRequestHeaders(options);
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : void 0,
          signal: AbortSignal.timeout(options.timeout ?? this.timeout)
        });
        if (!response.ok) {
          throw await this.buildError(response);
        }
        return this.parseResponse(response);
      }, options);
    }
    async request(path, options = {}) {
      return this.fetchJson(path, "GET", options);
    }
    async post(path, body, options = {}) {
      return this.fetchJson(path, "POST", options, body);
    }
    async delete(path, options = {}) {
      return this.fetchJson(path, "DELETE", options);
    }
    async search(params) {
      const searchParams = typeof params === "string" ? { query: params } : params;
      const query = new URLSearchParams();
      query.set("q", searchParams.query);
      if (searchParams.country) {
        query.set("country", searchParams.country);
      } else {
        query.set("country", this.defaultCountry);
      }
      if (searchParams.region) {
        query.set("region", searchParams.region);
      }
      if (searchParams.currency) {
        query.set("currency", searchParams.currency);
      } else {
        query.set("currency", this.defaultCurrency);
      }
      if (searchParams.limit) {
        query.set("limit", String(searchParams.limit));
      }
      if (searchParams.offset) {
        query.set("offset", String(searchParams.offset));
      }
      if (searchParams.price_min) {
        query.set("price_min", String(searchParams.price_min));
      }
      if (searchParams.price_max) {
        query.set("price_max", String(searchParams.price_max));
      }
      if (searchParams.platform) {
        query.set("platform", searchParams.platform);
      }
      return this.request(`/v1/products/search?${query.toString()}`);
    }
    async compare(params) {
      if (Array.isArray(params)) {
        return this.compareByIds(params);
      }
      if (typeof params === "string") {
        const categorySlug = params;
        return this.request(`/v1/compare/${categorySlug}`);
      }
      if (params.category) {
        const query = new URLSearchParams();
        if (params.region) query.set("region", params.region);
        if (params.country) query.set("country", params.country);
        const queryStr = query.toString();
        const path = `/v1/compare/${params.category}${queryStr ? `?${queryStr}` : ""}`;
        return this.request(path);
      }
      return this.compareByIds(params.product_ids ?? []);
    }
    // BUY-70605: prod route is GET /v1/products/compare?ids=id1,id2 — not POST.
    // See api/src/routes/products.ts for the on-disk handler. This method also
    // validates client-side so callers get a clear error before the API 400s.
    async compareByIds(productIds) {
      if (productIds.length < 2) {
        throw new BuyWhereError(
          'compare() requires at least 2 product IDs (prod returns "Provide at least 2 product IDs via ?ids=id1,id2" otherwise).',
          400,
          void 0,
          "compare_ids_too_few"
        );
      }
      const ids = productIds.map((id) => String(id)).join(",");
      return this.request(`/v1/products/compare?ids=${encodeURIComponent(ids)}`);
    }
    async deals(params) {
      const query = new URLSearchParams();
      if (params?.country) {
        query.set("country", params.country);
      } else {
        query.set("country", this.defaultCountry);
      }
      if (params?.category) {
        query.set("category", params.category);
      }
      if (params?.limit) {
        query.set("limit", String(params.limit));
      }
      if (params?.offset) {
        query.set("offset", String(params.offset));
      }
      return this.request(`/v1/products/deals?${query.toString()}`);
    }
    async getProduct(productId) {
      const response = await this.request(`/v1/products/${productId}`);
      return response.results?.[0] ?? null;
    }
    async getProductByParams(params) {
      const response = await this.request(`/v1/products/${params.product_id}`);
      return response.results?.[0] ?? null;
    }
    async priceHistory(productId, options = {}) {
      const query = new URLSearchParams();
      if (options.country) {
        query.set("country", options.country);
      }
      if (options.period) {
        query.set("period", options.period);
      }
      if (options.limit !== void 0) {
        query.set("limit", String(options.limit));
      }
      if (options.since) {
        query.set("since", options.since);
      }
      const queryStr = query.toString();
      const path = `/v1/products/${productId}/price-history${queryStr ? `?${queryStr}` : ""}`;
      return this.request(path);
    }
    async getPriceHistory(params) {
      return this.priceHistory(params.product_id, {
        country: params.country,
        period: params.period
      });
    }
    async getDealsFeed(_params) {
      throw new BuyWhereError(
        "getDealsFeed() is no longer supported \u2014 the /v1/deals/feed route was never deployed. Use client.deals({ country, category, limit, offset }) instead. (BUY-70605)",
        410,
        void 0,
        "getDealsFeed_removed"
      );
    }
    // BUY-70872: /v1/products/{id}/reviews/summary was a phantom route — no handler
    // exists in api/src/routes/products.ts. The 429 daily-quota response on /v1/products/*
    // masks this in live probes, but the route is absent in source and 404s once quota resets.
    async getProductReviewsSummary(_params) {
      throw new BuyWhereError(
        "getProductReviewsSummary() is not supported \u2014 the /v1/products/{id}/reviews/summary route was never deployed. (BUY-70872)",
        501,
        void 0,
        "reviewsSummary_unavailable"
      );
    }
    // BUY-70872: /v1/products/{id}/alerts was a phantom route — no handler exists in
    // api/src/routes/products.ts. Same 429-masking caveat as reviews/summary above.
    async getProductAlerts(_params) {
      throw new BuyWhereError(
        "getProductAlerts() is not supported \u2014 the /v1/products/{id}/alerts route was never deployed. (BUY-70872)",
        501,
        void 0,
        "productAlerts_unavailable"
      );
    }
    async batchSearch(params) {
      const results = [];
      const errors = [];
      const searchPromises = params.queries.map(async (query, index) => {
        try {
          const result = await this.search({
            query: query.query,
            country: query.country,
            limit: query.limit,
            price_min: query.price_min,
            price_max: query.price_max
          });
          return { index, result, error: null };
        } catch (error) {
          return { index, result: null, error: error.message };
        }
      });
      const settled = await Promise.all(searchPromises);
      for (const { index, result, error } of settled) {
        if (error) {
          errors.push({ index, error });
          results.push({
            results: [],
            total: 0,
            page: { limit: 0, offset: 0 },
            response_time_ms: 0,
            cached: false
          });
        } else if (result) {
          results.push(result);
        }
      }
      return { results, errors };
    }
    appendUTMParams(url, utmParams) {
      try {
        const urlObj = new URL(url);
        Object.entries(utmParams).forEach(([key, value]) => {
          if (value) {
            urlObj.searchParams.set(key, value);
          }
        });
        return urlObj.toString();
      } catch {
        return url;
      }
    }
    getApiKey() {
      return this.apiKey;
    }
    getBaseUrl() {
      return this.baseUrl;
    }
    getCircuitBreaker() {
      return this.circuitBreaker;
    }
    async getAuthMe() {
      const auth = await this.request("/v1/auth/me");
      this.currentKeyId = auth.key_id;
      return auth;
    }
    // BUY-70872: /v1/keys/{id}/rotate was a phantom route — api/src/routes/keys.ts
    // only implements POST /v1/keys (create). Rotation was never deployed, so this
    // call 404s against production. Create a fresh key with POST /v1/keys and retire
    // the old one out-of-band until a real rotation endpoint ships.
    async rotateApiKey() {
      throw new BuyWhereError(
        "rotateApiKey() is not supported \u2014 the /v1/keys/{id}/rotate route was never deployed. Create a replacement key with POST /v1/keys instead. (BUY-70872)",
        501,
        void 0,
        "rotateApiKey_unavailable"
      );
    }
    // BUY-70872: /v1/webhooks was a phantom route — the API's only webhook surface is
    // the internal relay at /webhooks (uptime-robot, stripe), not a customer-facing
    // subscription API. All three methods 404 against production. Poll deals()/search()
    // until a real webhook API ships.
    async createWebhook(_url, _events) {
      throw webhooksUnavailable("createWebhook");
    }
    async listWebhooks() {
      throw webhooksUnavailable("listWebhooks");
    }
    async deleteWebhook(_id) {
      throw webhooksUnavailable("deleteWebhook");
    }
  };
  var BuyWhereError = class extends Error {
    constructor(message, statusCode, body, errorCode, requestId) {
      super(message);
      this.statusCode = statusCode;
      this.body = body;
      this.name = "BuyWhereError";
      this.errorCode = errorCode;
      this.requestId = requestId;
    }
  };
  function webhooksUnavailable(method) {
    return new BuyWhereError(
      `${method}() is not supported \u2014 the /v1/webhooks route was never deployed. BuyWhere has no customer-facing webhook API yet; poll client.deals() or client.search() instead. (BUY-70872)`,
      501,
      void 0,
      "webhooks_unavailable"
    );
  }
  function parseJson(value) {
    if (!value) {
      return void 0;
    }
    try {
      return JSON.parse(value);
    } catch {
      return void 0;
    }
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }
  function getString(value, keys) {
    if (!value) {
      return void 0;
    }
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
      }
    }
    return void 0;
  }
  function getValidationMessage(value) {
    const detail = value?.detail;
    if (!Array.isArray(detail) || detail.length === 0) {
      return void 0;
    }
    const first = detail[0];
    if (!isRecord(first)) {
      return void 0;
    }
    return getString(first, ["msg"]);
  }

  // src/search.ts
  var SearchClient = class {
    constructor(client) {
      this.client = client;
    }
    async search(params) {
      return this.client.search(params);
    }
    async searchByCategory(category, options = {}) {
      return this.client.search({
        query: category,
        ...options
      });
    }
    async searchByCountry(query, country, options = {}) {
      return this.client.search({
        query,
        country,
        ...options
      });
    }
    async searchByRegion(query, region, options = {}) {
      return this.client.search({
        query,
        region,
        ...options
      });
    }
  };

  // src/compare.ts
  var CompareClient = class {
    constructor(client) {
      this.client = client;
    }
    async compare(params) {
      if (Array.isArray(params)) {
        return this.client.compare(params);
      }
      return this.client.compare(params);
    }
    async compareByCategory(categorySlug) {
      return this.client.compare({ category: categorySlug, product_ids: [] });
    }
    async compareProducts(productIds) {
      return this.client.compare({ product_ids: productIds });
    }
    async getBestPrices(productIds) {
      return this.client.compare({ product_ids: productIds });
    }
  };
  function createCompareNamespace(client) {
    const compareClient = new CompareClient(client);
    const callableCompare = ((productIds) => compareClient.compareProducts(productIds));
    return Object.assign(callableCompare, compareClient);
  }

  // src/deals.ts
  var DealsClient = class {
    constructor(client) {
      this.client = client;
    }
    async getDeals(params) {
      return this.client.deals(params);
    }
    async getDealsByCountry(country, options = {}) {
      return this.client.deals({ country, ...options });
    }
    async getDealsByCategory(category, options = {}) {
      return this.client.deals({ category, ...options });
    }
    async getDealsFeed(params) {
      return this.client.getDealsFeed(params);
    }
  };

  // src/products.ts
  var ProductsClient = class {
    constructor(client) {
      this.client = client;
    }
    async getProduct(productId) {
      return this.client.getProduct(productId);
    }
    async comparePrices(query, options) {
      const params = {
        product_ids: [],
        category: options?.category,
        region: options?.region,
        country: options?.country
      };
      return this.client.compare(params);
    }
    async compareProducts(productIds) {
      return this.client.compare({ product_ids: productIds });
    }
    async getPriceHistory(params) {
      return this.client.getPriceHistory(params);
    }
    async getReviewsSummary(params) {
      return this.client.getProductReviewsSummary(params);
    }
    async getAlerts(params) {
      return this.client.getProductAlerts(params);
    }
  };

  // src/autocomplete.ts
  var AutocompleteClient = class {
    constructor(client) {
      this.client = client;
      this.debounceTimeout = null;
      this.abortController = null;
    }
    async autocomplete(query, options = {}) {
      if (!query.trim()) {
        return { items: [], query };
      }
      this.cancelPendingRequest();
      const limit = options.limit ?? 8;
      const params = new URLSearchParams();
      params.set("q", query);
      params.set("limit", String(limit));
      if (options.country) {
        params.set("country", options.country);
      }
      if (options.region) {
        params.set("region", options.region);
      }
      if (options.currency) {
        params.set("currency", options.currency);
      }
      const response = await this.client.request(`/v1/products/search?${params.toString()}`);
      return {
        items: (response.results ?? []).map((p) => ({
          id: typeof p.id === "string" ? parseInt(p.id, 10) : p.id,
          name: p.title,
          price: p.price?.amount ?? null,
          currency: p.price?.currency ?? "SGD",
          source: p.merchant,
          brand: p.metadata?.brand ?? null,
          image_url: p.image_url
        })),
        query
      };
    }
    debouncedAutocomplete(query, delay, options = {}) {
      return new Promise((resolve, reject) => {
        if (this.debounceTimeout) {
          clearTimeout(this.debounceTimeout);
        }
        this.debounceTimeout = setTimeout(async () => {
          try {
            const result = await this.autocomplete(query, options);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        }, delay);
      });
    }
    cancelPendingRequest() {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
      if (this.debounceTimeout) {
        clearTimeout(this.debounceTimeout);
        this.debounceTimeout = null;
      }
    }
    destroy() {
      this.cancelPendingRequest();
    }
  };

  // src/agents.ts
  var AgentsClient = class {
    constructor(client) {
      this.client = client;
    }
    async search(params) {
      const searchParams = typeof params === "string" ? { q: params } : params;
      const query = new URLSearchParams();
      query.set("q", searchParams.q);
      if (searchParams.limit !== void 0) {
        query.set("limit", String(searchParams.limit));
      }
      if (searchParams.offset !== void 0) {
        query.set("offset", String(searchParams.offset));
      }
      if (searchParams.cursor) {
        query.set("cursor", searchParams.cursor);
      }
      if (searchParams.source) {
        query.set("source", searchParams.source);
      }
      if (searchParams.platform) {
        query.set("platform", searchParams.platform);
      }
      const priceMin = searchParams.min_price ?? searchParams.price_min;
      if (priceMin !== void 0) {
        query.set("price_min", String(priceMin));
      }
      const priceMax = searchParams.max_price ?? searchParams.price_max;
      if (priceMax !== void 0) {
        query.set("price_max", String(priceMax));
      }
      if (searchParams.availability !== void 0) {
        query.set("availability", String(searchParams.availability));
      }
      if (searchParams.sort_by) {
        query.set("sort_by", searchParams.sort_by);
      }
      if (searchParams.currency) {
        query.set("currency", searchParams.currency);
      }
      if (searchParams.include_agent_insights) {
        query.set("include_agent_insights", "true");
      }
      if (searchParams.include_price_history) {
        query.set("include_price_history", "true");
      }
      if (searchParams.include_availability_prediction) {
        query.set("include_availability_prediction", "true");
      }
      const circuitBreaker = this.client.getCircuitBreaker();
      const ftsQuery = new URLSearchParams(query);
      ftsQuery.set("mode", "fts");
      const semanticUrl = `/v2/agents/search?${query.toString()}`;
      const ftsUrl = `/v1/products/search?${ftsQuery.toString()}`;
      try {
        return await circuitBreaker.execute(
          () => this.client.request(semanticUrl)
        );
      } catch (error) {
        if (error instanceof CircuitBreakerError) {
          console.log(`[CircuitBreaker] State=${circuitBreaker.getState()} \u2014 falling back to FTS search`);
          const response = await this.client.request(ftsUrl);
          Object.defineProperty(response, "_searchMode", {
            value: "fallback",
            writable: false
          });
          return response;
        }
        throw error;
      }
    }
  };

  // src/webhooks.ts
  var WebhooksClient = class {
    constructor(client) {
      this.client = client;
    }
    async create(url, events) {
      return this.client.createWebhook(url, events);
    }
    async list() {
      return this.client.listWebhooks();
    }
    async delete(id) {
      await this.client.deleteWebhook(id);
    }
  };

  // src/validation.ts
  var ValidationError = class extends Error {
    constructor(message, field, value) {
      super(message);
      this.field = field;
      this.value = value;
      this.name = "ValidationError";
    }
  };
  var VALID_COUNTRIES = ["SG", "MY", "TH", "PH", "VN", "ID", "US"];
  var VALID_REGIONS = ["us", "sea"];
  var VALID_PERIODS = ["7d", "30d", "90d", "1y"];
  var VALID_SORT_OPTIONS = ["relevance", "price_asc", "price_desc", "newest", "highest_rated", "most_reviewed"];
  function isString(value) {
    return typeof value === "string";
  }
  function isNumber(value) {
    return typeof value === "number" && !isNaN(value);
  }
  function isArray(value) {
    return Array.isArray(value);
  }
  function validateSearchParams(params) {
    if (!isString(params.query) || params.query.trim().length === 0) {
      throw new ValidationError("query must be a non-empty string", "query", params.query);
    }
    if (params.country !== void 0) {
      if (!isString(params.country) || !VALID_COUNTRIES.includes(params.country)) {
        throw new ValidationError(
          `country must be one of: ${VALID_COUNTRIES.join(", ")}`,
          "country",
          params.country
        );
      }
    }
    if (params.region !== void 0) {
      if (!isString(params.region) || !VALID_REGIONS.includes(params.region)) {
        throw new ValidationError(
          `region must be one of: ${VALID_REGIONS.join(", ")}`,
          "region",
          params.region
        );
      }
    }
    if (params.limit !== void 0) {
      if (!isNumber(params.limit) || params.limit < 1 || params.limit > 50) {
        throw new ValidationError("limit must be a number between 1 and 50", "limit", params.limit);
      }
    }
    if (params.offset !== void 0) {
      if (!isNumber(params.offset) || params.offset < 0) {
        throw new ValidationError("offset must be a non-negative number", "offset", params.offset);
      }
    }
    if (params.price_min !== void 0) {
      if (!isNumber(params.price_min) || params.price_min < 0) {
        throw new ValidationError("price_min must be a non-negative number", "price_min", params.price_min);
      }
    }
    if (params.price_max !== void 0) {
      if (!isNumber(params.price_max) || params.price_max < 0) {
        throw new ValidationError("price_max must be a non-negative number", "price_max", params.price_max);
      }
    }
    if (params.price_min !== void 0 && params.price_max !== void 0) {
      if (params.price_min > params.price_max) {
        throw new ValidationError("price_min cannot be greater than price_max", "price_min", params.price_min);
      }
    }
  }
  function validateCompareParams(params) {
    if (params.category !== void 0) {
      if (!isString(params.category) || params.category.trim().length === 0) {
        throw new ValidationError("category must be a non-empty string", "category", params.category);
      }
    }
    if (params.product_ids !== void 0) {
      if (!isArray(params.product_ids)) {
        throw new ValidationError("product_ids must be an array", "product_ids", params.product_ids);
      }
      for (let i = 0; i < params.product_ids.length; i++) {
        const id = params.product_ids[i];
        if (typeof id !== "string" && typeof id !== "number") {
          throw new ValidationError(`product_ids[${i}] must be a string or number`, `product_ids[${i}]`, id);
        }
      }
    }
    if (params.region !== void 0) {
      if (!isString(params.region) || !VALID_REGIONS.includes(params.region)) {
        throw new ValidationError(
          `region must be one of: ${VALID_REGIONS.join(", ")}`,
          "region",
          params.region
        );
      }
    }
    if (params.country !== void 0) {
      if (!isString(params.country) || !VALID_COUNTRIES.includes(params.country)) {
        throw new ValidationError(
          `country must be one of: ${VALID_COUNTRIES.join(", ")}`,
          "country",
          params.country
        );
      }
    }
  }
  function validateDealsParams(params) {
    if (params === void 0) return;
    if (params.country !== void 0) {
      if (!isString(params.country) || !VALID_COUNTRIES.includes(params.country)) {
        throw new ValidationError(
          `country must be one of: ${VALID_COUNTRIES.join(", ")}`,
          "country",
          params.country
        );
      }
    }
    if (params.category !== void 0) {
      if (!isString(params.category) || params.category.trim().length === 0) {
        throw new ValidationError("category must be a non-empty string", "category", params.category);
      }
    }
    if (params.limit !== void 0) {
      if (!isNumber(params.limit) || params.limit < 1 || params.limit > 100) {
        throw new ValidationError("limit must be a number between 1 and 100", "limit", params.limit);
      }
    }
    if (params.offset !== void 0) {
      if (!isNumber(params.offset) || params.offset < 0) {
        throw new ValidationError("offset must be a non-negative number", "offset", params.offset);
      }
    }
  }
  function validateDealsFeedParams(params) {
    if (params === void 0) return;
    if (params.country !== void 0) {
      if (!isString(params.country) || !VALID_COUNTRIES.includes(params.country)) {
        throw new ValidationError(
          `country must be one of: ${VALID_COUNTRIES.join(", ")}`,
          "country",
          params.country
        );
      }
    }
    if (params.category !== void 0) {
      if (!isString(params.category) || params.category.trim().length === 0) {
        throw new ValidationError("category must be a non-empty string", "category", params.category);
      }
    }
    if (params.limit !== void 0) {
      if (!isNumber(params.limit) || params.limit < 1 || params.limit > 100) {
        throw new ValidationError("limit must be a number between 1 and 100", "limit", params.limit);
      }
    }
    if (params.offset !== void 0) {
      if (!isNumber(params.offset) || params.offset < 0) {
        throw new ValidationError("offset must be a non-negative number", "offset", params.offset);
      }
    }
    if (params.min_discount_pct !== void 0) {
      if (!isNumber(params.min_discount_pct) || params.min_discount_pct < 0 || params.min_discount_pct > 100) {
        throw new ValidationError("min_discount_pct must be a number between 0 and 100", "min_discount_pct", params.min_discount_pct);
      }
    }
  }
  function validateGetPriceHistoryParams(params) {
    if (params.product_id === void 0) {
      throw new ValidationError("product_id is required", "product_id", params.product_id);
    }
    if (typeof params.product_id !== "string" && typeof params.product_id !== "number") {
      throw new ValidationError("product_id must be a string or number", "product_id", params.product_id);
    }
    if (params.country !== void 0) {
      if (!isString(params.country) || !VALID_COUNTRIES.includes(params.country)) {
        throw new ValidationError(
          `country must be one of: ${VALID_COUNTRIES.join(", ")}`,
          "country",
          params.country
        );
      }
    }
    if (params.period !== void 0) {
      if (!isString(params.period) || !VALID_PERIODS.includes(params.period)) {
        throw new ValidationError(
          `period must be one of: ${VALID_PERIODS.join(", ")}`,
          "period",
          params.period
        );
      }
    }
  }
  function validateGetProductReviewsParams(params) {
    if (params.product_id === void 0) {
      throw new ValidationError("product_id is required", "product_id", params.product_id);
    }
    if (typeof params.product_id !== "number") {
      throw new ValidationError("product_id must be a number", "product_id", params.product_id);
    }
    if (params.country !== void 0) {
      if (!isString(params.country) || !VALID_COUNTRIES.includes(params.country)) {
        throw new ValidationError(
          `country must be one of: ${VALID_COUNTRIES.join(", ")}`,
          "country",
          params.country
        );
      }
    }
  }
  function validateGetProductAlertsParams(params) {
    if (params.product_id === void 0) {
      throw new ValidationError("product_id is required", "product_id", params.product_id);
    }
    if (typeof params.product_id !== "number") {
      throw new ValidationError("product_id must be a number", "product_id", params.product_id);
    }
    if (params.country !== void 0) {
      if (!isString(params.country) || !VALID_COUNTRIES.includes(params.country)) {
        throw new ValidationError(
          `country must be one of: ${VALID_COUNTRIES.join(", ")}`,
          "country",
          params.country
        );
      }
    }
  }
  function validatePriceHistoryOptions(options) {
    if (options === void 0) return;
    if (options.country !== void 0) {
      if (!isString(options.country) || !VALID_COUNTRIES.includes(options.country)) {
        throw new ValidationError(
          `country must be one of: ${VALID_COUNTRIES.join(", ")}`,
          "country",
          options.country
        );
      }
    }
    if (options.period !== void 0) {
      if (!isString(options.period) || !VALID_PERIODS.includes(options.period)) {
        throw new ValidationError(
          `period must be one of: ${VALID_PERIODS.join(", ")}`,
          "period",
          options.period
        );
      }
    }
    if (options.limit !== void 0) {
      if (!isNumber(options.limit) || options.limit < 1) {
        throw new ValidationError("limit must be a positive number", "limit", options.limit);
      }
    }
    if (options.since !== void 0) {
      if (!isString(options.since)) {
        throw new ValidationError("since must be an ISO date string", "since", options.since);
      }
      const date = new Date(options.since);
      if (isNaN(date.getTime())) {
        throw new ValidationError("since must be a valid ISO date string", "since", options.since);
      }
    }
  }
  function validateBatchSearchParams(params) {
    if (!isArray(params.queries)) {
      throw new ValidationError("queries must be an array", "queries", params.queries);
    }
    if (params.queries.length === 0) {
      throw new ValidationError("queries array cannot be empty", "queries", params.queries);
    }
    if (params.queries.length > 20) {
      throw new ValidationError("queries array cannot exceed 20 items", "queries", params.queries);
    }
    for (let i = 0; i < params.queries.length; i++) {
      const query = params.queries[i];
      if (!isString(query.query) || query.query.trim().length === 0) {
        throw new ValidationError(`queries[${i}].query must be a non-empty string`, `queries[${i}].query`, query.query);
      }
      if (query.country !== void 0) {
        if (!isString(query.country) || !VALID_COUNTRIES.includes(query.country)) {
          throw new ValidationError(
            `queries[${i}].country must be one of: ${VALID_COUNTRIES.join(", ")}`,
            `queries[${i}].country`,
            query.country
          );
        }
      }
      if (query.limit !== void 0) {
        if (!isNumber(query.limit) || query.limit < 1 || query.limit > 50) {
          throw new ValidationError(
            `queries[${i}].limit must be a number between 1 and 50`,
            `queries[${i}].limit`,
            query.limit
          );
        }
      }
      if (query.price_min !== void 0 && (!isNumber(query.price_min) || query.price_min < 0)) {
        throw new ValidationError(
          `queries[${i}].price_min must be a non-negative number`,
          `queries[${i}].price_min`,
          query.price_min
        );
      }
      if (query.price_max !== void 0 && (!isNumber(query.price_max) || query.price_max < 0)) {
        throw new ValidationError(
          `queries[${i}].price_max must be a non-negative number`,
          `queries[${i}].price_max`,
          query.price_max
        );
      }
      if (query.price_min !== void 0 && query.price_max !== void 0) {
        if (query.price_min > query.price_max) {
          throw new ValidationError(
            `queries[${i}].price_min cannot be greater than price_max`,
            `queries[${i}].price_min`,
            query.price_min
          );
        }
      }
    }
  }
  function validateAgentSearchParams(params) {
    if (!isString(params.q) || params.q.trim().length === 0) {
      throw new ValidationError("q must be a non-empty string", "q", params.q);
    }
    if (params.limit !== void 0) {
      if (!isNumber(params.limit) || params.limit < 1 || params.limit > 100) {
        throw new ValidationError("limit must be a number between 1 and 100", "limit", params.limit);
      }
    }
    if (params.offset !== void 0) {
      if (!isNumber(params.offset) || params.offset < 0) {
        throw new ValidationError("offset must be a non-negative number", "offset", params.offset);
      }
    }
    if (params.sort_by !== void 0) {
      if (!isString(params.sort_by) || !VALID_SORT_OPTIONS.includes(params.sort_by)) {
        throw new ValidationError(
          `sort_by must be one of: ${VALID_SORT_OPTIONS.join(", ")}`,
          "sort_by",
          params.sort_by
        );
      }
    }
    if (params.min_price !== void 0) {
      if (!isNumber(params.min_price) || params.min_price < 0) {
        throw new ValidationError("min_price must be a non-negative number", "min_price", params.min_price);
      }
    }
    if (params.max_price !== void 0) {
      if (!isNumber(params.max_price) || params.max_price < 0) {
        throw new ValidationError("max_price must be a non-negative number", "max_price", params.max_price);
      }
    }
    if (params.price_min !== void 0) {
      if (!isNumber(params.price_min) || params.price_min < 0) {
        throw new ValidationError("price_min must be a non-negative number", "price_min", params.price_min);
      }
    }
    if (params.price_max !== void 0) {
      if (!isNumber(params.price_max) || params.price_max < 0) {
        throw new ValidationError("price_max must be a non-negative number", "price_max", params.price_max);
      }
    }
    if (params.availability !== void 0) {
      if (typeof params.availability !== "boolean") {
        throw new ValidationError("availability must be a boolean", "availability", params.availability);
      }
    }
    if (params.include_agent_insights !== void 0) {
      if (typeof params.include_agent_insights !== "boolean") {
        throw new ValidationError("include_agent_insights must be a boolean", "include_agent_insights", params.include_agent_insights);
      }
    }
    if (params.include_availability_prediction !== void 0) {
      if (typeof params.include_availability_prediction !== "boolean") {
        throw new ValidationError("include_availability_prediction must be a boolean", "include_availability_prediction", params.include_availability_prediction);
      }
    }
    if (params.include_price_history !== void 0) {
      if (typeof params.include_price_history !== "boolean") {
        throw new ValidationError("include_price_history must be a boolean", "include_price_history", params.include_price_history);
      }
    }
    if (params.min_price !== void 0 && params.max_price !== void 0) {
      if (params.min_price > params.max_price) {
        throw new ValidationError("min_price cannot be greater than max_price", "min_price", params.min_price);
      }
    }
    if (params.price_min !== void 0 && params.price_max !== void 0) {
      if (params.price_min > params.price_max) {
        throw new ValidationError("price_min cannot be greater than price_max", "price_min", params.price_min);
      }
    }
  }
  function validateProductId(productId, fieldName = "productId") {
    if (typeof productId !== "string" && typeof productId !== "number") {
      throw new ValidationError(`${fieldName} must be a string or number`, fieldName, productId);
    }
    if (typeof productId === "string" && productId.trim().length === 0) {
      throw new ValidationError(`${fieldName} cannot be empty`, fieldName, productId);
    }
    if (typeof productId === "number" && (isNaN(productId) || productId < 0)) {
      throw new ValidationError(`${fieldName} must be a positive number`, fieldName, productId);
    }
  }
  function validateWebhookUrl(url) {
    if (!isString(url) || url.trim().length === 0) {
      throw new ValidationError("webhook URL must be a non-empty string", "url", url);
    }
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new ValidationError("webhook URL must use HTTP or HTTPS protocol", "url", url);
      }
    } catch {
      throw new ValidationError("webhook URL must be a valid URL", "url", url);
    }
  }
  function validateWebhookEvents(events) {
    if (!isArray(events)) {
      throw new ValidationError("events must be an array", "events", events);
    }
    if (events.length === 0) {
      throw new ValidationError("events array cannot be empty", "events", events);
    }
    const VALID_EVENTS = ["price_drop", "stock_change", "new_product", "deal_expiry"];
    for (let i = 0; i < events.length; i++) {
      if (!isString(events[i])) {
        throw new ValidationError(`events[${i}] must be a string`, `events[${i}]`, events[i]);
      }
      if (!VALID_EVENTS.includes(events[i])) {
        throw new ValidationError(
          `events[${i}] must be one of: ${VALID_EVENTS.join(", ")}`,
          `events[${i}]`,
          events[i]
        );
      }
    }
  }

  // src/errors.ts
  function createErrorResponse(message, code, options) {
    const response = {
      error: message,
      code
    };
    if (options?.details) {
      response.details = options.details;
    }
    if (options?.requestId) {
      response.request_id = options.requestId;
    }
    if (options?.retryAfter !== void 0) {
      response.retry_after = options.retryAfter;
    }
    return response;
  }
  function createValidationErrorResponse(errors, requestId) {
    return {
      error: "Validation failed",
      code: "VALIDATION_ERROR",
      details: { validation_errors: errors },
      request_id: requestId
    };
  }
  function createRateLimitErrorResponse(retryAfter, requestId) {
    return createErrorResponse(
      "Rate limit exceeded. Please retry after the specified time.",
      "RATE_LIMIT_EXCEEDED",
      { retryAfter, requestId }
    );
  }
  function createProductNotFoundResponse(productId, requestId) {
    return {
      error: `Product with ID ${productId} not found`,
      code: "PRODUCT_NOT_FOUND",
      details: { product_id: productId },
      request_id: requestId
    };
  }
  function createCategoryNotFoundResponse(category, requestId) {
    return {
      error: `Category '${category}' not found`,
      code: "CATEGORY_NOT_FOUND",
      details: { category },
      request_id: requestId
    };
  }
  function createCircuitBreakerErrorResponse(state, requestId) {
    const messages = {
      open: "Service temporarily unavailable. The circuit breaker is open.",
      "half-open": "Service availability is limited. Testing connection.",
      closed: "Service is operating normally."
    };
    return {
      error: messages[state] || "Circuit breaker error",
      code: "CIRCUIT_BREAKER_OPEN",
      details: { circuit_state: state },
      request_id: requestId
    };
  }
  function parseApiErrorResponse(response, bodyText) {
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return {
        error: `HTTP ${response.status}: ${response.statusText}`,
        code: "UNKNOWN_ERROR"
      };
    }
    const requestId = response.headers.get("x-request-id") ?? void 0;
    const retryAfter = response.headers.get("retry-after") ? parseInt(response.headers.get("retry-after"), 10) : void 0;
    const code = mapHttpStatusToErrorCode(response.status);
    const errorMessage = parsed.error ?? parsed.message ?? `HTTP ${response.status}`;
    return {
      error: errorMessage,
      code,
      details: parsed.details,
      request_id: requestId,
      retry_after: retryAfter
    };
  }
  function mapHttpStatusToErrorCode(status) {
    switch (status) {
      case 400:
        return "VALIDATION_ERROR";
      case 401:
        return "INVALID_API_KEY";
      case 403:
        return "INVALID_API_KEY";
      case 404:
        return "PRODUCT_NOT_FOUND";
      case 429:
        return "RATE_LIMIT_EXCEEDED";
      case 500:
        return "SERVER_ERROR";
      case 502:
        return "SERVER_ERROR";
      case 503:
        return "SERVER_ERROR";
      default:
        return "UNKNOWN_ERROR";
    }
  }
  var ApiError = class _ApiError extends Error {
    constructor(message, code, statusCode = 500, options) {
      super(message);
      this.name = "ApiError";
      this.code = code;
      this.statusCode = statusCode;
      this.requestId = options?.requestId;
      this.retryAfter = options?.retryAfter;
      this.details = options?.details;
    }
    toJSON() {
      return createErrorResponse(this.message, this.code, {
        details: this.details,
        requestId: this.requestId,
        retryAfter: this.retryAfter
      });
    }
    static fromResponse(response, body) {
      const parsed = parseApiErrorResponse(response, body);
      return new _ApiError(
        parsed.error,
        parsed.code,
        response.status,
        {
          requestId: parsed.request_id,
          retryAfter: parsed.retry_after,
          details: parsed.details
        }
      );
    }
  };
  function isRetryableError(error) {
    if (error instanceof ApiError) {
      return error.code === "RATE_LIMIT_EXCEEDED" || error.code === "SERVER_ERROR" || error.code === "NETWORK_ERROR" || error.code === "TIMEOUT_ERROR";
    }
    return false;
  }
  function isAuthError(error) {
    if (error instanceof ApiError) {
      return error.code === "INVALID_API_KEY" || error.code === "MISSING_API_KEY";
    }
    return false;
  }

  // src/schemas.ts
  var OPENAI_TOOL_SCHEMAS = {
    tools: [
      {
        type: "function",
        function: {
          name: "resolve_product_query",
          description: 'Use this whenever a user asks to find, search, or look up products \u2014 especially when they want product recommendations or need to discover options for a shopping decision. Examples: "find me a laptop under $1000", "what are the best wireless headphones", "show me phones available in Singapore".',
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: 'Natural language search query for products (e.g., "mechanical keyboard", "iphone 15 case")'
              },
              country: {
                type: "string",
                enum: ["SG", "MY", "TH", "PH", "VN", "ID", "US"],
                description: "Country to search in (defaults to SG)"
              },
              region: {
                type: "string",
                enum: ["us", "sea"],
                description: 'Region filter - use "us" for United States or "sea" for Southeast Asia'
              },
              limit: {
                type: "integer",
                minimum: 1,
                maximum: 50,
                default: 10,
                description: "Maximum number of results to return"
              },
              price_min: {
                type: "number",
                description: "Minimum price filter"
              },
              price_max: {
                type: "number",
                description: "Maximum price filter"
              },
              include_out_of_stock: {
                type: "boolean",
                default: false,
                description: "Whether to include out-of-stock products in results"
              }
            },
            required: ["query"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "find_best_price",
          description: `Use this whenever a user asks about prices, wants to find the cheapest option, or asks "what's the best price for X" or "where can I buy X for the lowest price". This finds the best current price across all merchants.`,
          parameters: {
            type: "object",
            properties: {
              product_name: {
                type: "string",
                description: 'Product name to find best price for (e.g., "iphone 15 pro 256gb", "samsung galaxy s24")'
              },
              q: {
                type: "string",
                description: "Alias for product_name (deprecated, use product_name)."
              },
              category: {
                type: "string",
                description: 'Category to filter by (e.g., "electronics", "fashion")'
              },
              country: {
                type: "string",
                enum: ["SG", "MY", "TH", "PH", "VN", "ID", "US"],
                description: "Country to search in (defaults to SG)"
              },
              region: {
                type: "string",
                enum: ["us", "sea"],
                description: 'Region filter - use "us" for United States or "sea" for Southeast Asia'
              }
            },
            required: ["product_name"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "compare_products",
          description: "Use this whenever a user wants to compare multiple products, see side-by-side price comparisons, or understand the differences between product options. Returns products sorted by price with merchant listings.",
          parameters: {
            type: "object",
            properties: {
              product_ids: {
                type: "array",
                items: { type: "integer" },
                description: "Array of product IDs to compare"
              },
              category: {
                type: "string",
                description: 'Category slug to filter products for comparison (e.g., "electronics", "fashion")'
              },
              country: {
                type: "string",
                enum: ["SG", "MY", "TH", "PH", "VN", "ID", "US"],
                description: "Country to search in (defaults to SG)"
              },
              limit: {
                type: "integer",
                minimum: 1,
                maximum: 50,
                default: 10,
                description: "Maximum number of products to compare"
              }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_product_details",
          description: "Use this whenever a user wants detailed information about a specific product, needs to see all available prices from different merchants, or wants to see product reviews and price history. Requires a product_id from a previous search.",
          parameters: {
            type: "object",
            properties: {
              product_id: {
                type: "integer",
                description: "The unique product ID to get details for"
              },
              country: {
                type: "string",
                enum: ["SG", "MY", "TH", "PH", "VN", "ID", "US"],
                description: "Country to get product details for (defaults to SG)"
              },
              include_reviews: {
                type: "boolean",
                default: false,
                description: "Include review summary in response"
              },
              include_price_history: {
                type: "boolean",
                default: false,
                description: "Include price history in response"
              }
            },
            required: ["product_id"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_purchase_options",
          description: "Use this whenever a user is ready to buy and wants to see all purchase options, needs merchant choices for a product, or wants to compare fulfillment ratings and reliability across merchants. Returns all merchants with pricing and reliability scores.",
          parameters: {
            type: "object",
            properties: {
              product_id: {
                type: "integer",
                description: "The unique product ID to get purchase options for"
              },
              country: {
                type: "string",
                enum: ["SG", "MY", "TH", "PH", "VN", "ID", "US"],
                description: "Country to get purchase options for (defaults to SG)"
              },
              filter_merchant: {
                type: "string",
                description: "Filter results to a specific merchant"
              },
              filter_price_min: {
                type: "number",
                description: "Minimum price filter"
              },
              filter_price_max: {
                type: "number",
                description: "Maximum price filter"
              },
              sort_by: {
                type: "string",
                enum: ["price_asc", "price_desc", "reliability", "rating"],
                default: "price_asc",
                description: "How to sort purchase options"
              }
            },
            required: ["product_id"]
          }
        }
      }
    ]
  };
  var MCP_TOOL_DEFINITIONS = [
    {
      name: "resolve_product_query",
      description: 'Use this whenever a user asks to find, search, or look up products \u2014 especially when they want product recommendations or need to discover options for a shopping decision. Examples: "find me a laptop under $1000", "what are the best wireless headphones", "show me phones available in Singapore".',
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query for products" },
          country: { type: "string", enum: ["SG", "MY", "TH", "PH", "VN", "ID", "US"] },
          region: { type: "string", enum: ["us", "sea"] },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
          price_min: { type: "number" },
          price_max: { type: "number" },
          include_out_of_stock: { type: "boolean", default: false }
        },
        required: ["query"]
      }
    },
    {
      name: "find_best_price",
      description: `Use this whenever a user asks about prices, wants to find the cheapest option, or asks "what's the best price for X". This finds the best current price across all merchants.`,
      inputSchema: {
        type: "object",
        properties: {
          product_name: { type: "string", description: "Product name to find best price for" },
          q: { type: "string", description: "Alias for product_name (deprecated, use product_name)." },
          category: { type: "string" },
          country: { type: "string", enum: ["SG", "MY", "TH", "PH", "VN", "ID", "US"] },
          region: { type: "string", enum: ["us", "sea"] }
        },
        required: ["product_name"]
      }
    },
    {
      name: "compare_products",
      description: "Use this whenever a user wants to compare multiple products or see side-by-side price comparisons.",
      inputSchema: {
        type: "object",
        properties: {
          product_ids: { type: "array", items: { type: "integer" } },
          category: { type: "string" },
          country: { type: "string", enum: ["SG", "MY", "TH", "PH", "VN", "ID", "US"] },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 10 }
        }
      }
    },
    {
      name: "get_product_details",
      description: "Use this whenever a user wants detailed information about a specific product or needs to see all available prices from different merchants.",
      inputSchema: {
        type: "object",
        properties: {
          product_id: { type: "integer" },
          country: { type: "string", enum: ["SG", "MY", "TH", "PH", "VN", "ID", "US"] },
          include_reviews: { type: "boolean", default: false },
          include_price_history: { type: "boolean", default: false }
        },
        required: ["product_id"]
      }
    },
    {
      name: "get_purchase_options",
      description: "Use this whenever a user is ready to buy and wants to see all purchase options or compare merchants.",
      inputSchema: {
        type: "object",
        properties: {
          product_id: { type: "integer" },
          country: { type: "string", enum: ["SG", "MY", "TH", "PH", "VN", "ID", "US"] },
          filter_merchant: { type: "string" },
          filter_price_min: { type: "number" },
          filter_price_max: { type: "number" },
          sort_by: { type: "string", enum: ["price_asc", "price_desc", "reliability", "rating"], default: "price_asc" }
        },
        required: ["product_id"]
      }
    }
  ];
  var AGENT_RESULT_SCHEMA = {
    type: "object",
    properties: {
      buywhere_score: {
        type: "object",
        properties: {
          score: { type: "number", description: "Overall BuyWhere quality score (0-100)" },
          rank: { type: "integer", description: "Ranking position among results" },
          reason_for_rank: { type: "string", description: "Explanation of why this product was ranked this way" }
        },
        required: ["score", "rank", "reason_for_rank"]
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Confidence score for the match quality (0-1)"
      },
      merchant_reliability_score: {
        type: "object",
        properties: {
          score: { type: "number", description: "Merchant reliability score (0-100)" },
          tier: { type: "string", enum: ["platinum", "gold", "silver", "standard"] },
          fulfillment_rating: { type: "number", description: "Fulfillment rating (0-5)" },
          last_fulfillment_at: { type: "string", description: "ISO timestamp of last successful fulfillment" }
        },
        required: ["score", "tier"]
      },
      availability_status: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["in_stock", "low_stock", "out_of_stock", "preorder", "unknown"] },
          stock_level: { type: "integer", description: "Estimated units available" },
          restock_eta: { type: "string", description: "Estimated restock date if out of stock" }
        },
        required: ["status"]
      },
      price_last_checked: {
        type: "string",
        format: "date-time",
        description: "ISO timestamp of when the price was last verified"
      },
      exact_match: {
        type: "boolean",
        description: "Whether this is an exact match to the query or an approximate/fuzzy match"
      }
    },
    required: ["buywhere_score", "confidence", "merchant_reliability_score", "availability_status", "price_last_checked", "exact_match"]
  };
  var QUERY_RESULT_SCHEMA = {
    type: "object",
    properties: {
      query_processed: { type: "string", description: "The search query after processing/normalization" },
      total: { type: "integer", description: "Total number of matching products" },
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            product_id: { type: "integer" },
            title: { type: "string" },
            buywhere_score: AGENT_RESULT_SCHEMA.properties.buywhere_score,
            confidence: AGENT_RESULT_SCHEMA.properties.confidence,
            merchant_reliability_score: AGENT_RESULT_SCHEMA.properties.merchant_reliability_score,
            availability_status: AGENT_RESULT_SCHEMA.properties.availability_status,
            price_last_checked: AGENT_RESULT_SCHEMA.properties.price_last_checked,
            exact_match: AGENT_RESULT_SCHEMA.properties.exact_match,
            prices: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  merchant: { type: "string" },
                  price: { type: "number" },
                  currency: { type: "string" },
                  buy_url: { type: "string" },
                  affiliate_url: { type: "string" }
                }
              }
            }
          }
        }
      },
      query_time_ms: { type: "integer", description: "Query processing time in milliseconds" },
      cache_hit: { type: "boolean", description: "Whether the result was served from cache" }
    },
    required: ["query_processed", "total", "results", "query_time_ms"]
  };

  // src/metrics-schema.ts
  var MACHINE_RELEVANT_METRICS_SCHEMA = {
    type: "object",
    properties: {
      latency: {
        type: "object",
        description: "API response latency metrics",
        properties: {
          p50_ms: { type: "number", description: "50th percentile latency in milliseconds" },
          p95_ms: { type: "number", description: "95th percentile latency in milliseconds" },
          p99_ms: { type: "number", description: "99th percentile latency in milliseconds" },
          avg_ms: { type: "number", description: "Average latency in milliseconds" }
        },
        required: ["p50_ms", "p95_ms", "p99_ms", "avg_ms"]
      },
      accuracy: {
        type: "object",
        description: "Result quality and relevance metrics",
        properties: {
          exact_match_rate: { type: "number", minimum: 0, maximum: 1, description: "Rate of exact query matches (0-1)" },
          relevance_score_avg: { type: "number", minimum: 0, maximum: 1, description: "Average relevance score across results (0-1)" },
          zero_results_rate: { type: "number", minimum: 0, maximum: 1, description: "Rate of queries returning no results (0-1)" }
        },
        required: ["exact_match_rate", "relevance_score_avg", "zero_results_rate"]
      },
      freshness: {
        type: "object",
        description: "Data freshness metrics",
        properties: {
          prices_updated_last_1h: { type: "integer", description: "Number of prices updated in the last hour" },
          prices_updated_last_24h: { type: "integer", description: "Number of prices updated in the last 24 hours" },
          avg_price_freshness_minutes: { type: "number", description: "Average age of price data in minutes" }
        },
        required: ["prices_updated_last_1h", "prices_updated_last_24h", "avg_price_freshness_minutes"]
      },
      coverage: {
        type: "object",
        description: "Catalog coverage metrics",
        properties: {
          total_products: { type: "integer", description: "Total number of products in catalog" },
          products_with_current_price: { type: "integer", description: "Products with up-to-date pricing" },
          total_merchants: { type: "integer", description: "Total number of merchants tracked" },
          active_merchants: { type: "integer", description: "Merchants with active listings" },
          country: { type: "string", enum: ["SG", "MY", "TH", "PH", "VN", "ID", "US"] },
          category: { type: "string", description: "Category filter if applied (undefined for all)" }
        },
        required: ["total_products", "products_with_current_price", "total_merchants", "active_merchants", "country"]
      },
      timestamp: { type: "string", format: "date-time", description: "ISO timestamp when metrics were generated" }
    },
    required: ["latency", "accuracy", "freshness", "coverage", "timestamp"]
  };
  var METRICS_ENDPOINT_RESPONSE = {
    type: "object",
    example: {
      latency: {
        p50_ms: 45,
        p95_ms: 120,
        p99_ms: 250,
        avg_ms: 52
      },
      accuracy: {
        exact_match_rate: 0.78,
        relevance_score_avg: 0.85,
        zero_results_rate: 0.05
      },
      freshness: {
        prices_updated_last_1h: 15420,
        prices_updated_last_24h: 287540,
        avg_price_freshness_minutes: 12.5
      },
      coverage: {
        total_products: 1247583,
        products_with_current_price: 1189234,
        total_merchants: 67,
        active_merchants: 52,
        country: "SG",
        category: void 0
      },
      timestamp: "2026-04-27T12:00:00.000Z"
    }
  };

  // src/index.ts
  var BuyWhereSDK = class {
    constructor(config) {
      this._config = config;
      const client = new BuyWhereClient(config);
      this.client = client;
      this.search = new SearchClient(client);
      this.compare = createCompareNamespace(client);
      this.deals = new DealsClient(client);
      this.products = new ProductsClient(client);
      this.autocomplete = new AutocompleteClient(client);
      this.agents = new AgentsClient(client);
      this.webhooks = new WebhooksClient(client);
    }
    getClient() {
      return new BuyWhereClient(this._config);
    }
    async priceHistory(productId, options) {
      return this.client.priceHistory(productId, options);
    }
    async rotateApiKey() {
      return this.client.rotateApiKey();
    }
  };
  function createClient(config) {
    return new BuyWhereSDK(config);
  }
  var SupportedCountries = ["SG", "MY", "TH", "PH", "VN", "ID", "US"];
  var SupportedRegions = ["SG", "US", "MY", "TH", "PH", "VN", "ID"];
  return __toCommonJS(index_exports);
})();
//# sourceMappingURL=index.global.js.map