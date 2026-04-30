import { BuyWhereClient, BuyWhereError } from './client';
import { SearchClient } from './search';
import { createCompareNamespace } from './compare';
import { DealsClient } from './deals';
import { ProductsClient } from './products';
import { AutocompleteClient } from './autocomplete';
import { AgentsClient } from './agents';
import { WebhooksClient } from './webhooks';
import { CircuitBreaker, CircuitBreakerError } from './circuit-breaker';
import {
  ValidationError,
  validateSearchParams,
  validateCompareParams,
  validateDealsParams,
  validateDealsFeedParams,
  validateGetPriceHistoryParams,
  validateGetProductReviewsParams,
  validateGetProductAlertsParams,
  validatePriceHistoryOptions,
  validateBatchSearchParams,
  validateAgentSearchParams,
  validateProductId,
  validateWebhookUrl,
  validateWebhookEvents,
} from './validation';
import {
  OPENAI_TOOL_SCHEMAS,
  MCP_TOOL_DEFINITIONS,
  AGENT_RESULT_SCHEMA,
  QUERY_RESULT_SCHEMA,
} from './schemas';
import {
  MACHINE_RELEVANT_METRICS_SCHEMA,
  METRICS_ENDPOINT_RESPONSE,
} from './metrics-schema';
import {
  ApiError,
  createErrorResponse,
  createValidationErrorResponse,
  createRateLimitErrorResponse,
  createProductNotFoundResponse,
  createCategoryNotFoundResponse,
  createCircuitBreakerErrorResponse,
  parseApiErrorResponse,
  mapHttpStatusToErrorCode,
  isRetryableError,
  isAuthError,
  type ErrorCode,
  type ErrorResponse,
  type ValidationErrorDetail,
} from './errors';
import {
  BuyWhereScore,
  MerchantReliability,
  AvailabilityStatus,
  ResolveProductQueryInput,
  ResolveProductQueryOutput,
  FindBestPriceInput,
  FindBestPriceOutput,
  CompareProductsInput,
  CompareProductsOutput,
  GetProductDetailsInput,
  GetProductDetailsOutput,
  GetPurchaseOptionsInput,
  GetPurchaseOptionsOutput,
  MetricsInput,
  MetricsOutput,
} from './schemas';
import type {
  AuthMeResponse,
  Product,
  ProductDetail,
  SearchParams,
  SearchResponse,
  CompareParams,
  CompareResponse,
  DealsParams,
  DealsResponse,
  MerchantPrice,
  ComparisonProduct,
  DealProduct,
  ClientConfig,
  RetryConfig,
  Region,
  Country,
  ProductId,
  PriceHistoryResponse,
  GetPriceHistoryParams,
  PriceHistoryOptions,
  DealsFeedResponse,
  DealsFeedParams,
  GetProductReviewsParams,
  ReviewSummary,
  RetailerReview,
  RotateApiKeyResponse,
  UTMParams,
  BatchSearchParams,
  BatchSearchResult,
  AgentSearchParams,
  AgentSearchResponse,
  AgentSearchResult,
  CircuitBreakerConfig,
  Webhook,
  WebhookCreateResponse,
  WebhookListResponse,
  GetProductAlertsParams,
  ProductAlert,
} from './types';
import type {
  AutocompleteSuggestion,
  AutocompleteResult,
  AutocompleteOptions,
} from './autocomplete';
import type { CompareNamespace } from './compare';

export { BuyWhereError, CircuitBreaker, CircuitBreakerError };
export { ValidationError };
export {
  ApiError,
  createErrorResponse,
  createValidationErrorResponse,
  createRateLimitErrorResponse,
  createProductNotFoundResponse,
  createCategoryNotFoundResponse,
  createCircuitBreakerErrorResponse,
  parseApiErrorResponse,
  mapHttpStatusToErrorCode,
  isRetryableError,
  isAuthError,
  type ErrorCode,
  type ErrorResponse,
  type ValidationErrorDetail,
};

export class BuyWhereSDK {
  readonly search: SearchClient;
  readonly compare: CompareNamespace;
  readonly deals: DealsClient;
  readonly products: ProductsClient;
  readonly autocomplete: AutocompleteClient;
  readonly agents: AgentsClient;
  readonly webhooks: WebhooksClient;
  private _config: string | ClientConfig;
  private client: BuyWhereClient;

  constructor(config: string | ClientConfig) {
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

  getClient(): BuyWhereClient {
    return new BuyWhereClient(this._config);
  }

  async priceHistory(
    productId: ProductId,
    options?: PriceHistoryOptions
  ): Promise<PriceHistoryResponse> {
    return this.client.priceHistory(productId, options);
  }

  async rotateApiKey(): Promise<RotateApiKeyResponse> {
    return this.client.rotateApiKey();
  }
}

export function createClient(config: string | ClientConfig): BuyWhereSDK {
  return new BuyWhereSDK(config);
}

export type {
  Product,
  ProductDetail,
  SearchParams,
  SearchResponse,
  CompareParams,
  CompareResponse,
  DealsParams,
  DealsResponse,
  MerchantPrice,
  ComparisonProduct,
  DealProduct,
  ClientConfig,
  RetryConfig,
  CircuitBreakerConfig,
  ProductId,
  Region,
  Country,
  AutocompleteSuggestion,
  AutocompleteResult,
  AutocompleteOptions,
  AuthMeResponse,
  PriceHistoryResponse,
  GetPriceHistoryParams,
  PriceHistoryOptions,
  DealsFeedResponse,
  DealsFeedParams,
  GetProductReviewsParams,
  ReviewSummary,
  RetailerReview,
  RotateApiKeyResponse,
  UTMParams,
  BatchSearchParams,
  BatchSearchResult,
  AgentSearchParams,
  AgentSearchResponse,
  AgentSearchResult,
  Webhook,
  WebhookCreateResponse,
  WebhookListResponse,
};

export type { CircuitBreakerState } from './circuit-breaker';
export type { CompareNamespace } from './compare';
export type { GetProductAlertsParams, ProductAlert } from './types';

export {
  validateSearchParams,
  validateCompareParams,
  validateDealsParams,
  validateDealsFeedParams,
  validateGetPriceHistoryParams,
  validateGetProductReviewsParams,
  validateGetProductAlertsParams,
  validatePriceHistoryOptions,
  validateBatchSearchParams,
  validateAgentSearchParams,
  validateProductId,
  validateWebhookUrl,
  validateWebhookEvents,
} from './validation';

export { BuyWhereClient, WebhooksClient };
export { ProductsClient };
export { AutocompleteClient };
export { AgentsClient };

export const SupportedCountries: Country[] = ['SG', 'MY', 'TH', 'PH', 'VN', 'ID', 'US'];
export const SupportedRegions: Region[] = ['SG', 'US', 'MY', 'TH', 'PH', 'VN', 'ID'];

export {
  OPENAI_TOOL_SCHEMAS,
  MCP_TOOL_DEFINITIONS,
  AGENT_RESULT_SCHEMA,
  QUERY_RESULT_SCHEMA,
} from './schemas';

export {
  MACHINE_RELEVANT_METRICS_SCHEMA,
  METRICS_ENDPOINT_RESPONSE,
} from './metrics-schema';

export type {
  BuyWhereScore,
  MerchantReliability,
  AvailabilityStatus,
  ResolveProductQueryInput,
  ResolveProductQueryOutput,
  FindBestPriceInput,
  FindBestPriceOutput,
  CompareProductsInput,
  CompareProductsOutput,
  GetProductDetailsInput,
  GetProductDetailsOutput,
  GetPurchaseOptionsInput,
  GetPurchaseOptionsOutput,
  MetricsInput,
  MetricsOutput,
} from './schemas';
