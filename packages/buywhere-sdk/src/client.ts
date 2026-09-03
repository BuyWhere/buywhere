import type {
  AuthMeResponse,
  ClientConfig,
  CompareParams,
  CompareResponse,
  DealsParams,
  DealsResponse,
  BatchSearchParams,
  BatchSearchResult,
  DealsFeedParams,
  DealsFeedResponse,
  GetPriceHistoryParams,
  GetProductParams,
  GetProductReviewsParams,
  PriceHistoryOptions,
  PriceHistoryResponse,
  ProductDetail,
  ProductId,
  RequestOptions,
  RetryConfig,
  ReviewSummary,
  RotateApiKeyResponse,
  SearchParams,
  SearchResponse,
  Webhook,
  WebhookCreateResponse,
  GetProductAlertsParams,
  ProductAlert,
} from './types';
import { CircuitBreaker, DEFAULT_CIRCUIT_BREAKER_CONFIG } from './circuit-breaker';

const DEFAULT_BASE_URL = 'https://api.buywhere.ai';
const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

export class BuyWhereClient {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private defaultCurrency: string;
  private defaultCountry: string;
  private retryConfig: Required<RetryConfig>;
  private circuitBreaker: CircuitBreaker;
  private currentKeyId?: string;

  constructor(config: string | ClientConfig) {
    if (typeof config === 'string') {
      this.apiKey = config;
      this.baseUrl = DEFAULT_BASE_URL;
      this.timeout = 30000;
      this.defaultCurrency = 'SGD';
      this.defaultCountry = 'SG';
      this.retryConfig = DEFAULT_RETRY_CONFIG;
      this.circuitBreaker = new CircuitBreaker(DEFAULT_CIRCUIT_BREAKER_CONFIG);
    } else {
      this.apiKey = config.apiKey;
      this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
      this.timeout = config.timeout ?? 30000;
      this.defaultCurrency = config.defaultCurrency ?? 'SGD';
      this.defaultCountry = config.defaultCountry ?? 'SG';
      this.retryConfig = config.retry
        ? {
            maxRetries: config.retry.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries,
            initialDelayMs: config.retry.initialDelayMs ?? DEFAULT_RETRY_CONFIG.initialDelayMs,
            maxDelayMs: config.retry.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs,
            backoffMultiplier: config.retry.backoffMultiplier ?? DEFAULT_RETRY_CONFIG.backoffMultiplier,
          }
        : DEFAULT_RETRY_CONFIG;
      const cbConfig = config.circuitBreaker
        ? {
            failureThreshold: config.circuitBreaker.failureThreshold ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold,
            resetTimeoutMs: config.circuitBreaker.resetTimeoutMs ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs,
            halfOpenMaxAttempts: config.circuitBreaker.halfOpenMaxAttempts ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.halfOpenMaxAttempts,
          }
        : DEFAULT_CIRCUIT_BREAKER_CONFIG;
      this.circuitBreaker = new CircuitBreaker(cbConfig);
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async requestWithRetry<T>(
    requestFn: () => Promise<T>,
    options: RequestOptions = {}
  ): Promise<T> {
    if (options.skipRetry) {
      return requestFn();
    }

    let lastError: Error | null = null;
    let delay = this.retryConfig.initialDelayMs;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error as Error;

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

  private getRequestHeaders(options: RequestOptions = {}): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }

  private async buildError(response: Response): Promise<BuyWhereError> {
    const requestIdHeader = response.headers.get('x-request-id');
    const responseText = await response.text().catch(() => '');
    const parsed = parseJson(responseText);
    const errorObject = isRecord(parsed) ? parsed : undefined;

    const message = getString(errorObject, ['message', 'error_message'])
      ?? getValidationMessage(errorObject)
      ?? responseText
      ?? `HTTP ${response.status}: ${response.statusText}`;
    const errorCode = getString(errorObject, ['errorCode', 'error_code']);
    const requestId = getString(errorObject, ['requestId', 'request_id']) ?? requestIdHeader ?? undefined;

    return new BuyWhereError(message, response.status, responseText || undefined, errorCode, requestId);
  }

  private async fetchJson<T>(
    path: string,
    method: string,
    options: RequestOptions = {},
    body?: Record<string, unknown>
  ): Promise<T> {
    return this.requestWithRetry(async () => {
      const url = `${this.baseUrl}${path}`;
      const headers = this.getRequestHeaders(options);

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(options.timeout ?? this.timeout),
      });

      if (!response.ok) {
        throw await this.buildError(response);
      }

      return this.parseResponse<T>(response);
    }, options);
  }

  async request<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    return this.fetchJson<T>(path, 'GET', options);
  }

  private async post<T>(
    path: string,
    body: Record<string, unknown>,
    options: RequestOptions = {}
  ): Promise<T> {
    return this.fetchJson<T>(path, 'POST', options, body);
  }

  private async delete<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    return this.fetchJson<T>(path, 'DELETE', options);
  }

  async search(params: string | SearchParams): Promise<SearchResponse> {
    const searchParams = typeof params === 'string'
      ? { query: params }
      : params;

    const query = new URLSearchParams();
    query.set('q', searchParams.query);

    if (searchParams.country) {
      query.set('country', searchParams.country);
    } else {
      query.set('country', this.defaultCountry);
    }

    if (searchParams.region) {
      query.set('region', searchParams.region);
    }

    if (searchParams.currency) {
      query.set('currency', searchParams.currency);
    } else {
      query.set('currency', this.defaultCurrency);
    }

    if (searchParams.limit) {
      query.set('limit', String(searchParams.limit));
    }

    if (searchParams.offset) {
      query.set('offset', String(searchParams.offset));
    }

    if (searchParams.price_min) {
      query.set('price_min', String(searchParams.price_min));
    }

    if (searchParams.price_max) {
      query.set('price_max', String(searchParams.price_max));
    }

    if (searchParams.platform) {
      query.set('platform', searchParams.platform);
    }

    if (searchParams.mode) {
      query.set('mode', searchParams.mode);
    }

    return this.request<SearchResponse>(`/v1/products/search?${query.toString()}`);
  }

  async compare(params: ProductId[]): Promise<CompareResponse>;
  async compare(params: string | CompareParams): Promise<CompareResponse>;
  async compare(params: ProductId[] | string | CompareParams): Promise<CompareResponse> {
    if (Array.isArray(params)) {
      return this.compareByIds(params);
    }

    if (typeof params === 'string') {
      const categorySlug = params;
      return this.request<CompareResponse>(`/v1/compare/${categorySlug}`);
    }

    if (params.category) {
      const query = new URLSearchParams();
      if (params.region) query.set('region', params.region);
      if (params.country) query.set('country', params.country);
      const queryStr = query.toString();
      const path = `/v1/compare/${params.category}${queryStr ? `?${queryStr}` : ''}`;
      return this.request<CompareResponse>(path);
    }

    return this.compareByIds(params.product_ids ?? []);
  }

  // BUY-70605: prod route is GET /v1/products/compare?ids=id1,id2 — not POST.
  // See api/src/routes/products.ts for the on-disk handler. This method also
  // validates client-side so callers get a clear error before the API 400s.
  private async compareByIds(productIds: ProductId[]): Promise<CompareResponse> {
    if (productIds.length < 2) {
      throw new BuyWhereError(
        'compare() requires at least 2 product IDs (prod returns "Provide at least 2 product IDs via ?ids=id1,id2" otherwise).',
        400,
        undefined,
        'compare_ids_too_few'
      );
    }

    const ids = productIds.map((id) => String(id)).join(',');
    return this.request<CompareResponse>(`/v1/products/compare?ids=${encodeURIComponent(ids)}`);
  }

  async deals(params?: DealsParams): Promise<DealsResponse> {
    const query = new URLSearchParams();

    if (params?.country) {
      query.set('country', params.country);
    } else {
      query.set('country', this.defaultCountry);
    }

    if (params?.category) {
      query.set('category', params.category);
    }

    if (params?.limit) {
      query.set('limit', String(params.limit));
    }

    if (params?.offset) {
      query.set('offset', String(params.offset));
    }

    // BUY-70605: prod route is /v1/products/deals (mounted under productsRouter),
    // NOT /v1/deals — that path has been 404 since at least 2026-08-16.
    return this.request<DealsResponse>(`/v1/products/deals?${query.toString()}`);
  }

  async getProduct(productId: number): Promise<ProductDetail> {
    const response = await this.request<SearchResponse>(`/v1/products/${productId}`);
    return response.results?.[0] ?? null as unknown as ProductDetail;
  }

  async getProductByParams(params: GetProductParams): Promise<ProductDetail> {
    const response = await this.request<SearchResponse>(`/v1/products/${params.product_id}`);
    return response.results?.[0] ?? null as unknown as ProductDetail;
  }

  async priceHistory(
    productId: ProductId,
    options: PriceHistoryOptions = {}
  ): Promise<PriceHistoryResponse> {
    const query = new URLSearchParams();
    if (options.country) {
      query.set('country', options.country);
    }

    if (options.period) {
      query.set('period', options.period);
    }

    if (options.limit !== undefined) {
      query.set('limit', String(options.limit));
    }

    if (options.since) {
      query.set('since', options.since);
    }

    const queryStr = query.toString();
    const path = `/v1/products/${productId}/price-history${queryStr ? `?${queryStr}` : ''}`;
    return this.request<PriceHistoryResponse>(path);
  }

  async getPriceHistory(params: GetPriceHistoryParams): Promise<PriceHistoryResponse> {
    return this.priceHistory(params.product_id, {
      country: params.country,
      period: params.period,
    });
  }

  async getDealsFeed(_params?: DealsFeedParams): Promise<DealsFeedResponse> {
    // BUY-70605: /v1/deals/feed was a phantom route — never implemented server-side
    // (api/src/routes/products.ts has no /deals/feed handler). Replaced with a clear
    // runtime error pointing callers at client.deals() instead.
    throw new BuyWhereError(
      'getDealsFeed() is no longer supported — the /v1/deals/feed route was never deployed. Use client.deals({ country, category, limit, offset }) instead. (BUY-70605)',
      410,
      undefined,
      'getDealsFeed_removed'
    );
  }

  // BUY-70872: /v1/products/{id}/reviews/summary was a phantom route — no handler
  // exists in api/src/routes/products.ts. The 429 daily-quota response on /v1/products/*
  // masks this in live probes, but the route is absent in source and 404s once quota resets.
  async getProductReviewsSummary(_params: GetProductReviewsParams): Promise<ReviewSummary> {
    throw new BuyWhereError(
      'getProductReviewsSummary() is not supported — the /v1/products/{id}/reviews/summary route was never deployed. (BUY-70872)',
      501,
      undefined,
      'reviewsSummary_unavailable'
    );
  }

  // BUY-70872: /v1/products/{id}/alerts was a phantom route — no handler exists in
  // api/src/routes/products.ts. Same 429-masking caveat as reviews/summary above.
  async getProductAlerts(_params: GetProductAlertsParams): Promise<ProductAlert[]> {
    throw new BuyWhereError(
      'getProductAlerts() is not supported — the /v1/products/{id}/alerts route was never deployed. (BUY-70872)',
      501,
      undefined,
      'productAlerts_unavailable'
    );
  }

  async batchSearch(params: BatchSearchParams): Promise<BatchSearchResult> {
    const results: SearchResponse[] = [];
    const errors: Array<{ index: number; error: string }> = [];

    const searchPromises = params.queries.map(async (query, index) => {
      try {
        const result = await this.search({
          query: query.query,
          country: query.country,
          limit: query.limit,
          price_min: query.price_min,
          price_max: query.price_max,
        });
        return { index, result, error: null };
      } catch (error) {
        return { index, result: null, error: (error as Error).message };
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
          cached: false,
        });
      } else if (result) {
        results.push(result);
      }
    }

    return { results, errors };
  }

  appendUTMParams(url: string, utmParams: Record<string, string>): string {
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

  getApiKey(): string {
    return this.apiKey;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  async getAuthMe(): Promise<AuthMeResponse> {
    const auth = await this.request<AuthMeResponse>('/v1/auth/me');
    this.currentKeyId = auth.key_id;
    return auth;
  }

  // BUY-70872: /v1/keys/{id}/rotate was a phantom route — api/src/routes/keys.ts
  // only implements POST /v1/keys (create). Rotation was never deployed, so this
  // call 404s against production. Create a fresh key with POST /v1/keys and retire
  // the old one out-of-band until a real rotation endpoint ships.
  async rotateApiKey(): Promise<RotateApiKeyResponse> {
    throw new BuyWhereError(
      'rotateApiKey() is not supported — the /v1/keys/{id}/rotate route was never deployed. Create a replacement key with POST /v1/keys instead. (BUY-70872)',
      501,
      undefined,
      'rotateApiKey_unavailable'
    );
  }

  // BUY-70872: /v1/webhooks was a phantom route — the API's only webhook surface is
  // the internal relay at /webhooks (uptime-robot, stripe), not a customer-facing
  // subscription API. All three methods 404 against production. Poll deals()/search()
  // until a real webhook API ships.
  async createWebhook(_url: string, _events: string[]): Promise<WebhookCreateResponse> {
    throw webhooksUnavailable('createWebhook');
  }

  async listWebhooks(): Promise<Webhook[]> {
    throw webhooksUnavailable('listWebhooks');
  }

  async deleteWebhook(_id: string): Promise<void> {
    throw webhooksUnavailable('deleteWebhook');
  }
}

export class BuyWhereError extends Error {
  public errorCode?: string;
  public requestId?: string;

  constructor(
    message: string,
    public statusCode: number,
    public body?: string,
    errorCode?: string,
    requestId?: string
  ) {
    super(message);
    this.name = 'BuyWhereError';
    this.errorCode = errorCode;
    this.requestId = requestId;
  }
}

export { BuyWhereClient as Client };
export type { SearchParams, CompareParams, DealsParams } from './types';

// BUY-70872: shared 501 for the phantom /v1/webhooks surface.
function webhooksUnavailable(method: string): BuyWhereError {
  return new BuyWhereError(
    `${method}() is not supported — the /v1/webhooks route was never deployed. BuyWhere has no customer-facing webhook API yet; poll client.deals() or client.search() instead. (BUY-70872)`,
    501,
    undefined,
    'webhooks_unavailable'
  );
}

function parseJson(value: string): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getString(
  value: Record<string, unknown> | undefined,
  keys: string[]
): string | undefined {
  if (!value) {
    return undefined;
  }

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function getValidationMessage(value: Record<string, unknown> | undefined): string | undefined {
  const detail = value?.detail;
  if (!Array.isArray(detail) || detail.length === 0) {
    return undefined;
  }

  const first = detail[0];
  if (!isRecord(first)) {
    return undefined;
  }

  return getString(first, ['msg']);
}
