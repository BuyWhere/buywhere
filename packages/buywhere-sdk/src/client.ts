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
  WebhookListResponse,
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

    return this.request<SearchResponse>(`/v1/search?${query.toString()}`);
  }

  async compare(params: ProductId[]): Promise<CompareResponse>;
  async compare(params: string | CompareParams): Promise<CompareResponse>;
  async compare(params: ProductId[] | string | CompareParams): Promise<CompareResponse> {
    if (Array.isArray(params)) {
      return this.post<CompareResponse>('/v1/products/compare', {
        product_ids: params,
      });
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

    return this.post<CompareResponse>('/v1/products/compare', {
      product_ids: params.product_ids,
    });
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

    return this.request<DealsResponse>(`/v1/deals?${query.toString()}`);
  }

  async getProduct(productId: number): Promise<ProductDetail> {
    return this.request<ProductDetail>(`/v1/products/${productId}`);
  }

  async getProductByParams(params: GetProductParams): Promise<ProductDetail> {
    return this.request<ProductDetail>(`/v1/products/${params.product_id}`);
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

  async getDealsFeed(params?: DealsFeedParams): Promise<DealsFeedResponse> {
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

    if (params?.min_discount_pct) {
      query.set('min_discount_pct', String(params.min_discount_pct));
    }

    return this.request<DealsFeedResponse>(`/v1/deals/feed?${query.toString()}`);
  }

  async getProductReviewsSummary(params: GetProductReviewsParams): Promise<ReviewSummary> {
    const query = new URLSearchParams();
    query.set('product_id', String(params.product_id));

    if (params.country) {
      query.set('country', params.country);
    }

    return this.request<ReviewSummary>(`/v1/products/${params.product_id}/reviews/summary?${query.toString()}`);
  }

  async getProductAlerts(params: GetProductAlertsParams): Promise<ProductAlert[]> {
    const query = new URLSearchParams();
    if (params.country) {
      query.set('country', params.country);
    }

    const queryStr = query.toString();
    const path = `/v1/products/${params.product_id}/alerts${queryStr ? `?${queryStr}` : ''}`;
    const response = await this.request<{ alerts: ProductAlert[] }>(path);
    return response.alerts ?? [];
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
          total: 0,
          limit: 0,
          offset: 0,
          has_more: false,
          items: [],
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

  async rotateApiKey(): Promise<RotateApiKeyResponse> {
    const keyId = this.currentKeyId ?? (await this.getAuthMe()).key_id;
    const response = await this.post<Record<string, unknown>>(`/v1/keys/${keyId}/rotate`, {});
    const newApiKey = getString(response, ['newApiKey', 'new_api_key', 'apiKey', 'api_key', 'key']);
    const oldKeyExpiresAt = getString(response, ['oldKeyExpiresAt', 'old_key_expires_at', 'expiresAt', 'expires_at']);

    if (!newApiKey || !oldKeyExpiresAt) {
      throw new BuyWhereError(
        'Key rotation response did not include the expected fields.',
        500,
        JSON.stringify(response)
      );
    }

    return {
      newApiKey,
      oldKeyExpiresAt,
    };
  }

  async createWebhook(url: string, events: string[]): Promise<WebhookCreateResponse> {
    return this.post<WebhookCreateResponse>('/v1/webhooks', { url, events });
  }

  async listWebhooks(): Promise<Webhook[]> {
    const response = await this.request<WebhookListResponse>('/v1/webhooks');
    return response.webhooks;
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.delete<void>(`/v1/webhooks/${id}`);
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
