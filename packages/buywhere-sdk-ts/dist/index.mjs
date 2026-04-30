// src/errors.ts
var BuyWhereError = class extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.name = "BuyWhereError";
  }
  statusCode;
};
var AuthenticationError = class extends BuyWhereError {
  constructor(message, statusCode) {
    super(message, statusCode);
    this.name = "AuthenticationError";
  }
};
var RateLimitError = class extends BuyWhereError {
  constructor(message, statusCode) {
    super(message, statusCode);
    this.name = "RateLimitError";
  }
};
var NotFoundError = class extends BuyWhereError {
  constructor(message, statusCode) {
    super(message, statusCode);
    this.name = "NotFoundError";
  }
};
var ValidationError = class extends BuyWhereError {
  constructor(message, statusCode) {
    super(message, statusCode);
    this.name = "ValidationError";
  }
};
var ServerError = class extends BuyWhereError {
  constructor(message, statusCode) {
    super(message, statusCode);
    this.name = "ServerError";
  }
};

// src/client.ts
var DEFAULT_BASE_URL = "https://api.buywhere.ai";
var DEFAULT_TIMEOUT = 3e4;
var DEFAULT_MAX_RETRIES = 3;
var DEFAULT_RETRY_DELAY = 1e3;
var BuyWhereClient = class {
  baseUrl;
  apiKey;
  timeout;
  maxRetries;
  retryDelay;
  backoffMultiplier;
  constructor(apiKey, options = {}) {
    if (!apiKey) {
      throw new Error("API key is required");
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.maxRetries = options.maxRetries || DEFAULT_MAX_RETRIES;
    this.retryDelay = options.retryDelay || DEFAULT_RETRY_DELAY;
    this.backoffMultiplier = options.backoffMultiplier || 2;
  }
  getHeaders() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "User-Agent": "buywhere-sdk-ts/1.0.0",
      Accept: "application/json",
      "Content-Type": "application/json"
    };
  }
  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async fetchWithRetry(url, options = {}, retryConfig) {
    const maxRetries = retryConfig?.maxRetries ?? this.maxRetries;
    const retryDelay = retryConfig?.retryDelay ?? this.retryDelay;
    const backoffMultiplier = retryConfig?.backoffMultiplier ?? 2;
    let lastError = null;
    let currentDelay = retryDelay;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        const response = await fetch(url, {
          ...options,
          headers: {
            ...this.getHeaders(),
            ...options.headers
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        const rateLimit = {
          limit: parseInt(response.headers.get("X-RateLimit-Limit") || "1000"),
          remaining: parseInt(response.headers.get("X-RateLimit-Remaining") || "999"),
          reset: parseInt(response.headers.get("X-RateLimit-Reset") || "0")
        };
        if (response.status === 401 || response.status === 403) {
          const detail = await response.text();
          throw new AuthenticationError(
            `Authentication failed: ${detail}`,
            response.status
          );
        }
        if (response.status === 404) {
          const detail = await response.text();
          throw new NotFoundError(`Resource not found: ${detail}`, response.status);
        }
        if (response.status === 429) {
          const detail = await response.text();
          throw new RateLimitError(
            `Rate limit exceeded: ${detail}`,
            response.status
          );
        }
        if (response.status === 422) {
          const detail = await response.text();
          throw new ValidationError(`Validation error: ${detail}`, response.status);
        }
        if (response.status >= 500) {
          const detail = await response.text();
          throw new ServerError(`Server error: ${detail}`, response.status);
        }
        if (response.status >= 400) {
          const detail = await response.text();
          throw new BuyWhereError(`Unexpected error: ${detail}`, response.status);
        }
        const data = await response.json();
        return { data, rateLimit };
      } catch (error) {
        lastError = error;
        if (error instanceof AuthenticationError) {
          throw error;
        }
        if (attempt < maxRetries) {
          await this.sleep(currentDelay);
          currentDelay *= backoffMultiplier;
        }
      }
    }
    throw lastError || new BuyWhereError("Request failed after retries");
  }
  async health() {
    const { data } = await this.fetchWithRetry(
      `${this.baseUrl}/health`
    );
    return data;
  }
  async apiInfo() {
    const { data } = await this.fetchWithRetry(`${this.baseUrl}/v1`);
    return data;
  }
  async changelog() {
    const { data } = await this.fetchWithRetry(
      `${this.baseUrl}/v1/changelog`
    );
    return data;
  }
  async search(options = {}) {
    const params = new URLSearchParams();
    if (options.q) params.set("q", options.q);
    if (options.category) params.set("category", options.category);
    if (options.min_price !== void 0)
      params.set("min_price", options.min_price.toString());
    if (options.max_price !== void 0)
      params.set("max_price", options.max_price.toString());
    if (options.source) params.set("platform", options.source);
    if (options.in_stock !== void 0)
      params.set("in_stock", options.in_stock.toString());
    if (options.limit !== void 0)
      params.set("limit", options.limit.toString());
    if (options.offset !== void 0)
      params.set("offset", options.offset.toString());
    const { data } = await this.fetchWithRetry(
      `${this.baseUrl}/v1/search?${params.toString()}`
    );
    return data;
  }
  async searchProducts(options = {}) {
    return this.search(options);
  }
  async bestPrice(query, category) {
    const params = new URLSearchParams({ q: query });
    if (category) params.set("category", category);
    const { data } = await this.fetchWithRetry(
      `${this.baseUrl}/v1/products/best-price?${params.toString()}`
    );
    return data;
  }
  async compare(options) {
    const params = new URLSearchParams({
      product_id: options.product_id.toString()
    });
    if (options.min_price !== void 0)
      params.set("min_price", options.min_price.toString());
    if (options.max_price !== void 0)
      params.set("max_price", options.max_price.toString());
    const { data } = await this.fetchWithRetry(
      `${this.baseUrl}/v1/products/compare?${params.toString()}`
    );
    return data;
  }
  async compareProductById(productId, options = {}) {
    const params = new URLSearchParams();
    if (options.min_price !== void 0)
      params.set("min_price", options.min_price.toString());
    if (options.max_price !== void 0)
      params.set("max_price", options.max_price.toString());
    const { data } = await this.fetchWithRetry(
      `${this.baseUrl}/v1/compare/${productId}${params.toString() ? `?${params.toString()}` : ""}`
    );
    return data;
  }
  async compareProducts(options) {
    const body = {
      product_ids: options.product_ids,
      min_price: options.min_price,
      max_price: options.max_price
    };
    const { data } = await this.fetchWithRetry(
      `${this.baseUrl}/v1/products/compare`,
      {
        method: "POST",
        body: JSON.stringify(body)
      }
    );
    return data;
  }
  async compareProductsDiff(options) {
    const body = {
      product_ids: options.product_ids,
      include_image_similarity: options.include_image_similarity ?? false
    };
    const { data } = await this.fetchWithRetry(
      `${this.baseUrl}/v1/products/compare/diff`,
      {
        method: "POST",
        body: JSON.stringify(body)
      }
    );
    return data;
  }
  async trending(category, limit = 50) {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    params.set("limit", limit.toString());
    const { data } = await this.fetchWithRetry(
      `${this.baseUrl}/v1/products/trending?${params.toString()}`
    );
    return data;
  }
  async getProduct(productId) {
    const { data } = await this.fetchWithRetry(
      `${this.baseUrl}/v1/products/${productId}`
    );
    return data;
  }
  async exportProducts(options = {}) {
    const params = new URLSearchParams();
    if (options.format) params.set("format", options.format);
    if (options.category) params.set("category", options.category);
    if (options.source) params.set("source", options.source);
    if (options.min_price !== void 0)
      params.set("min_price", options.min_price.toString());
    if (options.max_price !== void 0)
      params.set("max_price", options.max_price.toString());
    if (options.limit !== void 0)
      params.set("limit", options.limit.toString());
    if (options.offset !== void 0)
      params.set("offset", options.offset.toString());
    const url = `${this.baseUrl}/v1/products/export?${params.toString()}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const response = await fetch(url, {
      headers: this.getHeaders(),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (options.format === "csv") {
      return await response.text();
    }
    return await response.json();
  }
  async categories() {
    const { data } = await this.fetchWithRetry(
      `${this.baseUrl}/v1/categories`
    );
    return data;
  }
  async deals(options = {}) {
    const params = new URLSearchParams();
    if (options.category) params.set("category", options.category);
    if (options.min_discount_pct !== void 0)
      params.set("min_discount_pct", options.min_discount_pct.toString());
    if (options.limit !== void 0)
      params.set("limit", options.limit.toString());
    if (options.offset !== void 0)
      params.set("offset", options.offset.toString());
    const { data } = await this.fetchWithRetry(
      `${this.baseUrl}/v1/deals?${params.toString()}`
    );
    return data;
  }
  async ingest(request) {
    const { data } = await this.fetchWithRetry(
      `${this.baseUrl}/v1/ingest/products`,
      {
        method: "POST",
        body: JSON.stringify(request)
      },
      { maxRetries: 1 }
    );
    return data;
  }
};
export {
  AuthenticationError,
  BuyWhereClient,
  BuyWhereError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError
};
