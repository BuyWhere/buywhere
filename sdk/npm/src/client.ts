import {
  Product,
  ProductListResponse,
  ProductResponse,
  CompareResponse,
  CompareSearchResponse,
  CompareMatrixResponse,
  CompareDiffResponse,
  TrendingResponse,
  CategoryResponse,
  DealsResponse,
  IngestRequest,
  IngestResponse,
  ChangelogResponse,
  HealthStatus,
  ApiInfo,
  RateLimitInfo,
  SearchOptions,
  CompareOptions,
  CompareSearchOptions,
  CompareDiffOptions,
  CompareMatrixOptions,
  DealsOptions,
  ExportOptions,
  AffiliateResolution,
  DealItem,
  SubscribeCallback,
  SubscribeOptions,
} from "./types.js";
import {
  BuyWhereError,
  AuthenticationError,
  RateLimitError,
  NotFoundError,
  ValidationError,
  ServerError,
} from "./errors.js";

const DEFAULT_BASE_URL = "https://api.buywhere.ai";
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  backoffMultiplier: number;
}

export class BuyWhereClient {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;
  private maxRetries: number;
  private retryDelay: number;
  private backoffMultiplier: number;

  constructor(
    apiKey: string,
    options: {
      baseUrl?: string;
      timeout?: number;
      maxRetries?: number;
      retryDelay?: number;
      backoffMultiplier?: number;
    } = {}
  ) {
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

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "User-Agent": "@buywhere/sdk/1.0.0",
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchWithRetry<T>(
    url: string,
    options: RequestInit = {},
    retryConfig?: Partial<RetryConfig>
  ): Promise<{ data: T; rateLimit: RateLimitInfo }> {
    const maxRetries = retryConfig?.maxRetries ?? this.maxRetries;
    const retryDelay = retryConfig?.retryDelay ?? this.retryDelay;
    const backoffMultiplier = retryConfig?.backoffMultiplier ?? 2;

    let lastError: Error | null = null;
    let currentDelay = retryDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          ...options,
          headers: {
            ...this.getHeaders(),
            ...options.headers,
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const rateLimit: RateLimitInfo = {
          limit: parseInt(response.headers.get("X-RateLimit-Limit") || "1000"),
          remaining: parseInt(response.headers.get("X-RateLimit-Remaining") || "999"),
          reset: parseInt(response.headers.get("X-RateLimit-Reset") || "0"),
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
        return { data: data as T, rateLimit };
      } catch (error) {
        lastError = error as Error;

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

  private async fetchResponseWithRetry(
    url: string,
    options: RequestInit = {},
    retryConfig?: Partial<RetryConfig>
  ): Promise<Response> {
    const maxRetries = retryConfig?.maxRetries ?? this.maxRetries;
    const retryDelay = retryConfig?.retryDelay ?? this.retryDelay;
    const backoffMultiplier = retryConfig?.backoffMultiplier ?? 2;

    let lastError: Error | null = null;
    let currentDelay = retryDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url, {
          ...options,
          headers: {
            ...this.getHeaders(),
            ...options.headers,
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

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

        return response;
      } catch (error) {
        lastError = error as Error;

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

  async health(): Promise<HealthStatus> {
    const { data } = await this.fetchWithRetry<HealthStatus>(
      `${this.baseUrl}/health`
    );
    return data;
  }

  async apiInfo(): Promise<ApiInfo> {
    const { data } = await this.fetchWithRetry<ApiInfo>(`${this.baseUrl}/v1`);
    return data;
  }

  async changelog(): Promise<ChangelogResponse> {
    const { data } = await this.fetchWithRetry<ChangelogResponse>(
      `${this.baseUrl}/v1/changelog`
    );
    return data;
  }

  async search(options: SearchOptions = {}): Promise<ProductListResponse> {
    const params = new URLSearchParams();
    if (options.q) params.set("q", options.q);
    if (options.category) params.set("category", options.category);
    if (options.min_price !== undefined)
      params.set("min_price", options.min_price.toString());
    if (options.max_price !== undefined)
      params.set("max_price", options.max_price.toString());
    if (options.source) params.set("source", options.source);
    if (options.in_stock !== undefined)
      params.set("in_stock", options.in_stock.toString());
    if (options.limit !== undefined)
      params.set("limit", options.limit.toString());
    if (options.offset !== undefined)
      params.set("offset", options.offset.toString());

    const { data } = await this.fetchWithRetry<ProductListResponse>(
      `${this.baseUrl}/v1/search?${params.toString()}`
    );
    return data;
  }

  async getProduct(productId: number): Promise<ProductResponse> {
    const { data } = await this.fetchWithRetry<ProductResponse>(
      `${this.baseUrl}/v1/products/${productId}`
    );
    return data;
  }

  async resolveAffiliate(
    productId: number,
    options: { trackClick?: boolean } = {}
  ): Promise<AffiliateResolution> {
    const product = await this.getProduct(productId);
    let resolvedUrl = product.affiliate_url || product.buy_url;

    if (options.trackClick) {
      const response = await this.fetchResponseWithRetry(
        `${this.baseUrl}/v1/products/${productId}/click`,
        {
          method: "POST",
          redirect: "manual",
        },
        { maxRetries: 1 }
      );
      resolvedUrl = response.headers.get("location") || resolvedUrl;
    }

    return {
      product_id: product.id,
      buy_url: product.buy_url,
      affiliate_url: product.affiliate_url,
      resolved_url: resolvedUrl,
      tracked_click: options.trackClick ?? false,
    };
  }

  async compare(options: CompareOptions): Promise<CompareResponse> {
    const params = new URLSearchParams({
      product_id: options.product_id.toString(),
    });
    if (options.min_price !== undefined)
      params.set("min_price", options.min_price.toString());
    if (options.max_price !== undefined)
      params.set("max_price", options.max_price.toString());

    const { data } = await this.fetchWithRetry<CompareResponse>(
      `${this.baseUrl}/v1/products/compare?${params.toString()}`
    );
    return data;
  }

  async compareSearch(
    options: CompareSearchOptions
  ): Promise<CompareSearchResponse> {
    const params = new URLSearchParams({ q: options.q });
    if (options.limit !== undefined) {
      params.set("limit", options.limit.toString());
    }

    const { data } = await this.fetchWithRetry<CompareSearchResponse>(
      `${this.baseUrl}/v1/products/compare?${params.toString()}`
    );
    return data;
  }

  async compareProductById(
    productId: number,
    options: { min_price?: number; max_price?: number } = {}
  ): Promise<CompareResponse> {
    const params = new URLSearchParams();
    if (options.min_price !== undefined)
      params.set("min_price", options.min_price.toString());
    if (options.max_price !== undefined)
      params.set("max_price", options.max_price.toString());

    const { data } = await this.fetchWithRetry<CompareResponse>(
      `${this.baseUrl}/v1/compare/${productId}${params.toString() ? `?${params.toString()}` : ""}`
    );
    return data;
  }

  async compareProducts(
    options: CompareMatrixOptions
  ): Promise<CompareMatrixResponse> {
    const body = {
      product_ids: options.product_ids,
      min_price: options.min_price,
      max_price: options.max_price,
    };

    const { data } = await this.fetchWithRetry<CompareMatrixResponse>(
      `${this.baseUrl}/v1/products/compare`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
    return data;
  }

  async compareProductsDiff(
    options: CompareDiffOptions
  ): Promise<CompareDiffResponse> {
    const body = {
      product_ids: options.product_ids,
      include_image_similarity: options.include_image_similarity ?? false,
    };

    const { data } = await this.fetchWithRetry<CompareDiffResponse>(
      `${this.baseUrl}/v1/products/compare/diff`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
    return data;
  }

  async getDeals(options: DealsOptions = {}): Promise<DealsResponse> {
    const params = new URLSearchParams();
    if (options.category) params.set("category", options.category);
    if (options.min_discount_pct !== undefined)
      params.set("min_discount_pct", options.min_discount_pct.toString());
    if (options.limit !== undefined)
      params.set("limit", options.limit.toString());
    if (options.offset !== undefined)
      params.set("offset", options.offset.toString());

    const { data } = await this.fetchWithRetry<DealsResponse>(
      `${this.baseUrl}/v1/deals?${params.toString()}`
    );
    return data;
  }

  async trending(period: '24h' | '7d' = '7d', category?: string, limit: number = 50): Promise<TrendingResponse> {
    const params = new URLSearchParams();
    params.set('period', period);
    if (category) params.set("category", category);
    params.set("limit", limit.toString());

    const { data } = await this.fetchWithRetry<TrendingResponse>(
      `${this.baseUrl}/v1/products/trending?${params.toString()}`
    );
    return data;
  }

  async categories(): Promise<CategoryResponse> {
    const { data } = await this.fetchWithRetry<CategoryResponse>(
      `${this.baseUrl}/v1/categories`
    );
    return data;
  }

  async ingest(request: IngestRequest): Promise<IngestResponse> {
    const { data } = await this.fetchWithRetry<IngestResponse>(
      `${this.baseUrl}/v1/ingest/products`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
      { maxRetries: 1 }
    );
    return data;
  }

  async exportProducts(
    options: ExportOptions = {}
  ): Promise<Product[] | string> {
    const params = new URLSearchParams();
    if (options.format) params.set("format", options.format);
    if (options.category) params.set("category", options.category);
    if (options.source) params.set("source", options.source);
    if (options.min_price !== undefined)
      params.set("min_price", options.min_price.toString());
    if (options.max_price !== undefined)
      params.set("max_price", options.max_price.toString());
    if (options.limit !== undefined)
      params.set("limit", options.limit.toString());
    if (options.offset !== undefined)
      params.set("offset", options.offset.toString());

    const url = `${this.baseUrl}/v1/products/export?${params.toString()}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    const response = await fetch(url, {
      headers: this.getHeaders(),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (options.format === "csv") {
      return await response.text();
    }

    return (await response.json()) as Product[];
  }

  async subscribe(
    callback: SubscribeCallback,
    options: SubscribeOptions = {},
    intervalMs: number = 60000
  ): Promise<{ stop: () => void }> {
    let stopped = false;

    const run = async () => {
      while (!stopped) {
        try {
          const deals = await this.getDeals({
            category: options.category,
            min_discount_pct: options.min_discount_pct,
            limit: 50,
          });
          for (const deal of deals.items) {
            if (stopped) break;
            await callback(deal);
          }
        } catch (e) {
          // Continue polling even on error
        }
        if (!stopped) {
          await this.sleep(intervalMs);
        }
      }
    };

    run();

    return {
      stop: () => {
        stopped = true;
      },
    };
  }
}

export default BuyWhereClient;
