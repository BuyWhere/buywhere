import type {
  Product,
  SearchOptions,
  SearchResponse,
  Category,
  Deal,
  PricePoint,
  ApiError as ApiErrorType,
} from "./types.js";

import {
  AuthenticationError,
  RateLimitError,
  NotFoundError,
  ApiError,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.buywhere.com";
const DEFAULT_TIMEOUT = 30000;

export interface BuyWhereClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export class BuyWhereClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(options: BuyWhereClientOptions) {
    if (!options.apiKey) {
      throw new Error("apiKey is required");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
  }

  private async request<T>(
    method: string,
    path: string,
    params?: Record<string, string | number | undefined>,
    body?: unknown
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "buywhere-js/1.0.0",
      "Accept": "application/json",
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeout),
    };

    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (response.status === 401) {
      throw new AuthenticationError("Invalid API key");
    }

    if (response.status === 429) {
      throw new RateLimitError("Rate limit exceeded");
    }

    if (response.status === 404) {
      throw new NotFoundError(`Resource not found: ${path}`);
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as ApiErrorType;
      throw new ApiError(
        errorData.error?.message ?? `HTTP ${response.status}`,
        errorData.error?.code ?? "UNKNOWN_ERROR",
        response.status,
        errorData.error?.details
      );
    }

    return response.json() as Promise<T>;
  }

  async search(options: SearchOptions): Promise<SearchResponse> {
    const params: Record<string, string | number | undefined> = {
      q: options.query,
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
    };

    if (options.category) params.category = options.category;
    if (options.min_price !== undefined) params["min_price"] = options.min_price;
    if (options.max_price !== undefined) params["max_price"] = options.max_price;
    if (options.source) params.source = options.source;

    return this.request<SearchResponse>("GET", "/v1/search", params);
  }

  async getProduct(id: number): Promise<Product> {
    return this.request<Product>("GET", `/v1/products/${id}`);
  }

  async bestPrice(query: string): Promise<Product> {
    const result = await this.search({ query, limit: 1 });
    if (result.items.length === 0) {
      throw new NotFoundError(`No products found matching: ${query}`);
    }
    return result.items[0];
  }

  async compareProducts(query: string): Promise<Product[]> {
    const result = await this.search({ query, limit: 50 });
    return result.items;
  }

  async listCategories(): Promise<{ categories: Category[] }> {
    return this.request<{ categories: Category[] }>("GET", "/v1/categories");
  }

  async getDeals(options?: {
    category?: string;
    min_discount_pct?: number;
    limit?: number;
  }): Promise<{ deals: Deal[] }> {
    const params: Record<string, string | number | undefined> = {};
    if (options?.category) params.category = options.category;
    if (options?.min_discount_pct !== undefined) {
      params.min_discount_pct = options.min_discount_pct;
    }
    if (options?.limit !== undefined) params.limit = options.limit;

    return this.request<{ deals: Deal[] }>("GET", "/v1/deals", params);
  }

  async getPriceHistory(productId: number): Promise<{ price_history: PricePoint[] }> {
    return this.request<{ price_history: PricePoint[] }>(
      "GET",
      `/v1/products/${productId}/price-history`
    );
  }

  async trackClick(productId: number, platform: string): Promise<{ tracking_id: string }> {
    return this.request<{ tracking_id: string }>(
      "POST",
      `/v1/products/${productId}/click`,
      undefined,
      { platform }
    );
  }
}

export class AsyncBuyWhereClient extends BuyWhereClient {
  async search(options: SearchOptions): Promise<SearchResponse> {
    return super.search(options);
  }

  async getProduct(id: number): Promise<Product> {
    return super.getProduct(id);
  }

  async bestPrice(query: string): Promise<Product> {
    return super.bestPrice(query);
  }

  async compareProducts(query: string): Promise<Product[]> {
    return super.compareProducts(query);
  }

  async listCategories(): Promise<{ categories: Category[] }> {
    return super.listCategories();
  }

  async getDeals(options?: {
    category?: string;
    min_discount_pct?: number;
    limit?: number;
  }): Promise<{ deals: Deal[] }> {
    return super.getDeals(options);
  }

  async getPriceHistory(productId: number): Promise<{ price_history: PricePoint[] }> {
    return super.getPriceHistory(productId);
  }

  async trackClick(productId: number, platform: string): Promise<{ tracking_id: string }> {
    return super.trackClick(productId, platform);
  }
}

export default BuyWhereClient;