interface ProductPrice {
    amount: number | null;
    currency: string;
}
interface Product {
    id: string;
    title: string;
    price: ProductPrice;
    merchant: string;
    url: string;
    image_url: string | null;
    region: string | null;
    country_code: string | null;
    updated_at: string | null;
    metadata?: Record<string, unknown> | null;
    canonical_id?: string;
    normalized_price_usd?: number | null;
    structured_specs?: Record<string, unknown>;
    comparison_attributes?: Array<{
        key: string;
        label: string;
        value: unknown;
    }>;
    original_price?: number | null;
    discount_pct?: number | null;
}
type ProductDetail = Product;
interface GetProductParams {
    product_id: number;
}
interface SearchParams {
    query: string;
    country?: string;
    region?: string;
    currency?: string;
    limit?: number;
    offset?: number;
    price_min?: number;
    price_max?: number;
    platform?: string;
}
interface SearchResponse {
    results: Product[];
    total: number;
    page: {
        limit: number;
        offset: number;
    };
    response_time_ms: number;
    cached: boolean;
}
interface MerchantPrice$1 {
    merchant: string;
    price: string;
    currency: string;
    url: string;
    in_stock: boolean;
    rating?: number;
    last_updated: string;
    price_diff?: number;
    savings_pct?: number;
    best_value?: boolean;
}
interface CompareParams {
    product_ids: ProductId[];
    category?: string;
    region?: Region;
    country?: Country$1;
}
interface CompareResponse extends SearchResponse {
    currencies_mixed?: boolean;
    currency_warning?: string;
}
type DealProduct = Product;
interface DealsParams {
    country?: string;
    category?: string;
    limit?: number;
    offset?: number;
}
type DealsResponse = SearchResponse;
interface PriceHistoryPoint {
    date: string;
    price: number;
    currency: string;
    merchant?: string;
}
interface PriceHistoryResponse$1 {
    product_id: number;
    product_name: string;
    country: string;
    currency: string;
    period: string;
    price_history: PriceHistoryPoint[];
    lowest_price: number;
    highest_price: number;
    average_price: number;
    lowest_price_date: string;
    highest_price_date: string;
}
interface GetPriceHistoryParams {
    product_id: ProductId;
    country?: Country$1;
    period?: '7d' | '30d' | '90d' | '1y';
}
interface DealsFeedParams {
    country?: Country$1;
    category?: string;
    limit?: number;
    offset?: number;
    min_discount_pct?: number;
}
type DealsFeedResponse = SearchResponse;
type Region = 'SG' | 'US' | 'MY' | 'TH' | 'PH' | 'VN' | 'ID';
type Country$1 = 'SG' | 'MY' | 'TH' | 'PH' | 'VN' | 'ID' | 'US';
type ProductId = string | number;
interface ClientConfig {
    apiKey: string;
    baseUrl?: string;
    timeout?: number;
    defaultCurrency?: string;
    defaultCountry?: Country$1;
    retry?: RetryConfig;
    circuitBreaker?: CircuitBreakerConfig$1;
}
interface RetryConfig {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
}
interface CircuitBreakerConfig$1 {
    failureThreshold?: number;
    resetTimeoutMs?: number;
    halfOpenMaxAttempts?: number;
}
interface RequestOptions {
    headers?: Record<string, string>;
    timeout?: number;
    skipRetry?: boolean;
}
interface AuthMeResponse {
    key_id: string;
    tier: string;
    name?: string | null;
    developer_id?: string | null;
    rate_limit?: number | null;
    is_active?: boolean;
}
interface PriceHistoryOptions {
    limit?: number;
    since?: string;
    country?: Country$1;
    period?: '7d' | '30d' | '90d' | '1y';
}
interface RotateApiKeyResponse {
    newApiKey: string;
    oldKeyExpiresAt: string;
}
interface Webhook {
    id: string;
    url: string;
    product_ids: number[];
    events: string[];
    active: boolean;
    filter_category?: string | null;
    filter_brand?: string | null;
    filter_price_min?: string | null;
    filter_price_max?: string | null;
    created_at: string;
}
interface WebhookCreateResponse extends Webhook {
    message?: string;
}
interface WebhookListResponse {
    webhooks: Webhook[];
    total: number;
}
interface RetailerReview {
    retailer: string;
    rating: number;
    review_count: number;
    review_url: string;
    last_review_date?: string;
}
interface ReviewSummary$1 {
    product_id: number;
    product_name: string;
    overall_rating: number;
    total_reviews: number;
    retailer_reviews: RetailerReview[];
    summary: string;
    pros?: string[];
    cons?: string[];
    top_keywords: string[];
    last_updated: string;
}
interface GetProductReviewsParams {
    product_id: number;
    country?: Country$1;
}
interface ProductAlert {
    id: string;
    product_id: number;
    target_price: number;
    direction: 'above' | 'below';
    callback_url: string;
    active: boolean;
    created_at: string;
    triggered_at?: string;
}
interface GetProductAlertsParams {
    product_id: number;
    country?: Country$1;
}
interface UTMParams {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_term?: string;
    utm_content?: string;
}
interface BatchSearchParams {
    queries: Array<{
        query: string;
        country?: Country$1;
        limit?: number;
        price_min?: number;
        price_max?: number;
    }>;
}
interface BatchSearchResult {
    results: SearchResponse[];
    errors: Array<{
        index: number;
        error: string;
    }>;
}
interface AgentSearchResult {
    id: number;
    sku: string;
    source: string;
    title: string;
    price: number;
    currency: string;
    price_sgd: number;
    url: string;
    brand: string;
    category: string;
    image_url: string;
    rating: number;
    review_count: number;
    is_available: boolean;
    in_stock: boolean;
    stock_level: string;
    confidence_score: number;
    availability_prediction: 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown';
    competitor_count: number;
    buybox_price: number;
    affiliate_url: string;
    headline: string;
    data_freshness: string;
    freshness_score: number;
}
interface AgentSearchResponse {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
    query_processed: string;
    results: AgentSearchResult[];
    query_time_ms: number;
    cache_hit: boolean;
}
interface AgentSearchParams {
    q: string;
    limit?: number;
    offset?: number;
    cursor?: string;
    source?: string;
    platform?: string;
    min_price?: number;
    max_price?: number;
    price_min?: number;
    price_max?: number;
    availability?: boolean;
    sort_by?: 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'highest_rated' | 'most_reviewed';
    currency?: string;
    include_agent_insights?: boolean;
    include_price_history?: boolean;
    include_availability_prediction?: boolean;
}

type CircuitBreakerState = 'closed' | 'open' | 'half-open';
interface CircuitBreakerConfig {
    failureThreshold: number;
    resetTimeoutMs: number;
    halfOpenMaxAttempts: number;
}
declare class CircuitBreakerError extends Error {
    circuitState: CircuitBreakerState;
    constructor(circuitState: CircuitBreakerState, message: string);
}
declare class CircuitBreaker {
    private config;
    private state;
    private failureCount;
    private lastFailureTime;
    private halfOpenAttempts;
    constructor(config: Required<CircuitBreakerConfig>);
    private get timeSinceLastFailure();
    isOpen(): boolean;
    execute<T>(fn: () => Promise<T>): Promise<T>;
    private onSuccess;
    private onFailure;
    getState(): CircuitBreakerState;
    getFailureCount(): number;
    shouldFallback(): boolean;
    reset(): void;
}

declare class BuyWhereClient {
    private apiKey;
    private baseUrl;
    private timeout;
    private defaultCurrency;
    private defaultCountry;
    private retryConfig;
    private circuitBreaker;
    private currentKeyId?;
    constructor(config: string | ClientConfig);
    private sleep;
    private requestWithRetry;
    private getRequestHeaders;
    private parseResponse;
    private buildError;
    private fetchJson;
    request<T>(path: string, options?: RequestOptions): Promise<T>;
    private post;
    private delete;
    search(params: string | SearchParams): Promise<SearchResponse>;
    compare(params: ProductId[]): Promise<CompareResponse>;
    compare(params: string | CompareParams): Promise<CompareResponse>;
    private compareByIds;
    deals(params?: DealsParams): Promise<DealsResponse>;
    getProduct(productId: number): Promise<ProductDetail>;
    getProductByParams(params: GetProductParams): Promise<ProductDetail>;
    priceHistory(productId: ProductId, options?: PriceHistoryOptions): Promise<PriceHistoryResponse$1>;
    getPriceHistory(params: GetPriceHistoryParams): Promise<PriceHistoryResponse$1>;
    getDealsFeed(_params?: DealsFeedParams): Promise<DealsFeedResponse>;
    getProductReviewsSummary(_params: GetProductReviewsParams): Promise<ReviewSummary$1>;
    getProductAlerts(_params: GetProductAlertsParams): Promise<ProductAlert[]>;
    batchSearch(params: BatchSearchParams): Promise<BatchSearchResult>;
    appendUTMParams(url: string, utmParams: Record<string, string>): string;
    getApiKey(): string;
    getBaseUrl(): string;
    getCircuitBreaker(): CircuitBreaker;
    getAuthMe(): Promise<AuthMeResponse>;
    rotateApiKey(): Promise<RotateApiKeyResponse>;
    createWebhook(_url: string, _events: string[]): Promise<WebhookCreateResponse>;
    listWebhooks(): Promise<Webhook[]>;
    deleteWebhook(_id: string): Promise<void>;
}
declare class BuyWhereError extends Error {
    statusCode: number;
    body?: string | undefined;
    errorCode?: string;
    requestId?: string;
    constructor(message: string, statusCode: number, body?: string | undefined, errorCode?: string, requestId?: string);
}

declare class SearchClient {
    private client;
    constructor(client: BuyWhereClient);
    search(params: string | SearchParams): Promise<SearchResponse>;
    searchByCategory(category: string, options?: Omit<SearchParams, 'query'>): Promise<SearchResponse>;
    searchByCountry(query: string, country: string, options?: Omit<SearchParams, 'query' | 'country'>): Promise<SearchResponse>;
    searchByRegion(query: string, region: string, options?: Omit<SearchParams, 'query' | 'region'>): Promise<SearchResponse>;
}

declare class DealsClient {
    private client;
    constructor(client: BuyWhereClient);
    getDeals(params?: DealsParams): Promise<DealsResponse>;
    getDealsByCountry(country: string, options?: Omit<DealsParams, 'country'>): Promise<DealsResponse>;
    getDealsByCategory(category: string, options?: Omit<DealsParams, 'category'>): Promise<DealsResponse>;
    getDealsFeed(params?: DealsFeedParams): Promise<DealsFeedResponse>;
}

declare class ProductsClient {
    private client;
    constructor(client: BuyWhereClient);
    getProduct(productId: number): Promise<ProductDetail>;
    comparePrices(query: string, options?: {
        category?: string;
        limit?: number;
        region?: string;
        country?: string;
    }): Promise<CompareResponse>;
    compareProducts(productIds: number[]): Promise<CompareResponse>;
    getPriceHistory(params: GetPriceHistoryParams): Promise<PriceHistoryResponse$1>;
    getReviewsSummary(params: GetProductReviewsParams): Promise<ReviewSummary$1>;
    getAlerts(params: GetProductAlertsParams): Promise<ProductAlert[]>;
}

interface AutocompleteSuggestion {
    id: number;
    name: string;
    price: number | null;
    currency: string;
    source: string;
    brand: string | null;
    image_url: string | null;
}
interface AutocompleteResult {
    items: AutocompleteSuggestion[];
    query: string;
}
interface AutocompleteOptions {
    limit?: number;
    country?: string;
    region?: string;
    currency?: string;
}
declare class AutocompleteClient {
    private client;
    private debounceTimeout;
    private abortController;
    constructor(client: BuyWhereClient);
    autocomplete(query: string, options?: AutocompleteOptions): Promise<AutocompleteResult>;
    debouncedAutocomplete(query: string, delay: number, options?: AutocompleteOptions): Promise<AutocompleteResult>;
    cancelPendingRequest(): void;
    destroy(): void;
}

declare class AgentsClient {
    private client;
    constructor(client: BuyWhereClient);
    search(params: string | AgentSearchParams): Promise<AgentSearchResponse>;
}

declare class WebhooksClient {
    private client;
    constructor(client: BuyWhereClient);
    create(url: string, events: string[]): Promise<WebhookCreateResponse>;
    list(): Promise<Webhook[]>;
    delete(id: string): Promise<void>;
}

declare class ValidationError extends Error {
    field?: string | undefined;
    value?: unknown | undefined;
    constructor(message: string, field?: string | undefined, value?: unknown | undefined);
}
declare function validateSearchParams(params: SearchParams): void;
declare function validateCompareParams(params: CompareParams): void;
declare function validateDealsParams(params?: DealsParams): void;
declare function validateDealsFeedParams(params?: DealsFeedParams): void;
declare function validateGetPriceHistoryParams(params: GetPriceHistoryParams): void;
declare function validateGetProductReviewsParams(params: GetProductReviewsParams): void;
declare function validateGetProductAlertsParams(params: GetProductAlertsParams): void;
declare function validatePriceHistoryOptions(options?: PriceHistoryOptions): void;
declare function validateBatchSearchParams(params: BatchSearchParams): void;
declare function validateAgentSearchParams(params: AgentSearchParams): void;
declare function validateProductId(productId: number | string, fieldName?: string): void;
declare function validateWebhookUrl(url: string): void;
declare function validateWebhookEvents(events: string[]): void;

type ErrorCode = 'INVALID_API_KEY' | 'MISSING_API_KEY' | 'RATE_LIMIT_EXCEEDED' | 'INVALID_COUNTRY' | 'INVALID_REGION' | 'INVALID_PERIOD' | 'INVALID_SORT' | 'INVALID_LIMIT' | 'INVALID_OFFSET' | 'INVALID_PRICE_RANGE' | 'MISSING_REQUIRED_FIELD' | 'PRODUCT_NOT_FOUND' | 'CATEGORY_NOT_FOUND' | 'VALIDATION_ERROR' | 'CIRCUIT_BREAKER_OPEN' | 'NETWORK_ERROR' | 'TIMEOUT_ERROR' | 'SERVER_ERROR' | 'INTERNAL_ERROR' | 'UNKNOWN_ERROR';
interface ErrorResponse {
    error: string;
    code: ErrorCode;
    details?: Record<string, unknown>;
    request_id?: string;
    retry_after?: number;
}
interface ValidationErrorDetail {
    field: string;
    message: string;
    value?: unknown;
}
declare function createErrorResponse(message: string, code: ErrorCode, options?: {
    details?: Record<string, unknown>;
    requestId?: string;
    retryAfter?: number;
}): ErrorResponse;
declare function createValidationErrorResponse(errors: ValidationErrorDetail[], requestId?: string): ErrorResponse & {
    details: {
        validation_errors: ValidationErrorDetail[];
    };
};
declare function createRateLimitErrorResponse(retryAfter: number, requestId?: string): ErrorResponse;
declare function createProductNotFoundResponse(productId: number | string, requestId?: string): ErrorResponse;
declare function createCategoryNotFoundResponse(category: string, requestId?: string): ErrorResponse;
declare function createCircuitBreakerErrorResponse(state: 'closed' | 'open' | 'half-open', requestId?: string): ErrorResponse;
declare function parseApiErrorResponse(response: Response, bodyText: string): ErrorResponse;
declare function mapHttpStatusToErrorCode(status: number): ErrorCode;
declare class ApiError extends Error {
    readonly code: ErrorCode;
    readonly statusCode: number;
    readonly requestId?: string;
    readonly retryAfter?: number;
    readonly details?: Record<string, unknown>;
    constructor(message: string, code: ErrorCode, statusCode?: number, options?: {
        requestId?: string;
        retryAfter?: number;
        details?: Record<string, unknown>;
    });
    toJSON(): ErrorResponse;
    static fromResponse(response: Response, body: string): ApiError;
}
declare function isRetryableError(error: Error): boolean;
declare function isAuthError(error: Error): boolean;

declare class CompareClient {
    private client;
    constructor(client: BuyWhereClient);
    compare(params: ProductId[]): Promise<CompareResponse>;
    compare(params: string | CompareParams): Promise<CompareResponse>;
    compareByCategory(categorySlug: string): Promise<CompareResponse>;
    compareProducts(productIds: ProductId[]): Promise<CompareResponse>;
    getBestPrices(productIds: ProductId[]): Promise<CompareResponse>;
}
type CompareNamespace = CompareClient & ((productIds: ProductId[]) => Promise<CompareResponse>);

interface BuyWhereScore {
    score: number;
    rank: number;
    reason_for_rank: string;
}
interface MerchantReliability {
    score: number;
    tier: 'platinum' | 'gold' | 'silver' | 'standard';
    fulfillment_rating: number;
    last_fulfillment_at?: string;
}
interface AvailabilityStatus {
    status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'preorder' | 'unknown';
    stock_level?: number;
    restock_eta?: string;
}
interface ResolveProductQueryInput {
    query: string;
    country?: Country;
    region?: 'us' | 'sea';
    limit?: number;
    price_min?: number;
    price_max?: number;
    include_out_of_stock?: boolean;
}
interface ResolveProductQueryOutput {
    query_processed: string;
    total: number;
    results: Array<{
        product_id: number;
        title: string;
        buywhere_score: BuyWhereScore;
        confidence: number;
        merchant_reliability_score: MerchantReliability;
        availability_status: AvailabilityStatus;
        price_last_checked: string;
        exact_match: boolean;
        prices: Array<{
            merchant: string;
            price: number;
            currency: string;
            buy_url: string;
            affiliate_url?: string;
        }>;
    }>;
    query_time_ms: number;
    cache_hit: boolean;
}
interface FindBestPriceInput {
    product_name: string;
    category?: string;
    country?: Country;
    region?: 'us' | 'sea';
}
interface FindBestPriceOutput {
    product_name: string;
    best_price: {
        merchant: string;
        price: number;
        currency: string;
        buy_url: string;
        affiliate_url?: string;
    };
    all_prices: Array<{
        merchant: string;
        price: number;
        currency: string;
        price_diff?: number;
        savings_pct?: number;
    }>;
    buywhere_score: BuyWhereScore;
    confidence: number;
    merchant_reliability_score: MerchantReliability;
    price_last_checked: string;
    exact_match: boolean;
}
interface CompareProductsInput {
    product_ids?: number[];
    category?: string;
    country?: Country;
    limit?: number;
}
interface CompareProductsOutput {
    category?: {
        id: string;
        name: string;
        slug: string;
    };
    products: Array<{
        id: number;
        name: string;
        brand: string;
        buywhere_score: BuyWhereScore;
        confidence: number;
        merchant_reliability_score: MerchantReliability;
        availability_status: AvailabilityStatus;
        price_last_checked: string;
        exact_match: boolean;
        prices: MerchantPrice[];
        lowest_price: string;
        lowest_price_merchant: string;
    }>;
    meta: {
        total_products: number;
        total_merchants: number;
        last_updated: string;
    };
}
interface GetProductDetailsInput {
    product_id: number;
    country?: Country;
    include_reviews?: boolean;
    include_price_history?: boolean;
}
interface GetProductDetailsOutput {
    product: {
        id: number;
        name: string;
        brand: string;
        description: string;
        category: string;
        buywhere_score: BuyWhereScore;
        confidence: number;
        merchant_reliability_score: MerchantReliability;
        availability_status: AvailabilityStatus;
        price_last_checked: string;
        exact_match: boolean;
        prices: MerchantPrice[];
        lowest_price: string;
        lowest_price_merchant: string;
        image_url?: string;
        rating?: number;
        reviews_count?: number;
        last_updated: string;
    };
    reviews?: ReviewSummary;
    price_history?: PriceHistoryResponse;
}
interface GetPurchaseOptionsInput {
    product_id: number;
    country?: Country;
    filter_merchant?: string;
    filter_price_min?: number;
    filter_price_max?: number;
    sort_by?: 'price_asc' | 'price_desc' | 'reliability' | 'rating';
}
interface GetPurchaseOptionsOutput {
    product_id: number;
    product_name: string;
    buywhere_score: BuyWhereScore;
    confidence: number;
    options: Array<{
        merchant: string;
        price: number;
        currency: string;
        buy_url: string;
        affiliate_url?: string;
        in_stock: boolean;
        merchant_reliability_score: MerchantReliability;
        availability_status: AvailabilityStatus;
        price_last_checked: string;
        rating?: number;
        fulfillment_rating?: number;
    }>;
    recommended_merchant?: string;
    recommended_buy_url?: string;
}
interface MetricsInput {
    country?: Country;
    category?: string;
    period?: '1h' | '24h' | '7d' | '30d';
}
interface MetricsOutput {
    latency: {
        p50_ms: number;
        p95_ms: number;
        p99_ms: number;
        avg_ms: number;
    };
    accuracy: {
        exact_match_rate: number;
        relevance_score_avg: number;
        zero_results_rate: number;
    };
    freshness: {
        prices_updated_last_1h: number;
        prices_updated_last_24h: number;
        avg_price_freshness_minutes: number;
    };
    coverage: {
        total_products: number;
        products_with_current_price: number;
        total_merchants: number;
        active_merchants: number;
        country: Country;
        category?: string;
    };
    timestamp: string;
}
type Country = 'SG' | 'MY' | 'TH' | 'PH' | 'VN' | 'ID' | 'US';
interface MerchantPrice {
    merchant: string;
    price: string;
    currency: string;
    url: string;
    in_stock: boolean;
    rating?: number;
    last_updated: string;
    price_diff?: number;
    savings_pct?: number;
    best_value?: boolean;
}
interface ReviewSummary {
    product_id: number;
    product_name: string;
    overall_rating: number;
    total_reviews: number;
    retailer_reviews: Array<{
        retailer: string;
        rating: number;
        review_count: number;
        review_url: string;
    }>;
    last_updated: string;
}
interface PriceHistoryResponse {
    product_id: number;
    product_name: string;
    country: string;
    currency: string;
    period: string;
    price_history: Array<{
        date: string;
        price: number;
        currency: string;
        merchant?: string;
    }>;
    lowest_price: number;
    highest_price: number;
    average_price: number;
}
declare const OPENAI_TOOL_SCHEMAS: {
    readonly tools: readonly [{
        readonly type: "function";
        readonly function: {
            readonly name: "resolve_product_query";
            readonly description: "Use this whenever a user asks to find, search, or look up products — especially when they want product recommendations or need to discover options for a shopping decision. Examples: \"find me a laptop under $1000\", \"what are the best wireless headphones\", \"show me phones available in Singapore\".";
            readonly parameters: {
                readonly type: "object";
                readonly properties: {
                    readonly query: {
                        readonly type: "string";
                        readonly description: "Natural language search query for products (e.g., \"mechanical keyboard\", \"iphone 15 case\")";
                    };
                    readonly country: {
                        readonly type: "string";
                        readonly enum: readonly ["SG", "MY", "TH", "PH", "VN", "ID", "US"];
                        readonly description: "Country to search in (defaults to SG)";
                    };
                    readonly region: {
                        readonly type: "string";
                        readonly enum: readonly ["us", "sea"];
                        readonly description: "Region filter - use \"us\" for United States or \"sea\" for Southeast Asia";
                    };
                    readonly limit: {
                        readonly type: "integer";
                        readonly minimum: 1;
                        readonly maximum: 50;
                        readonly default: 10;
                        readonly description: "Maximum number of results to return";
                    };
                    readonly price_min: {
                        readonly type: "number";
                        readonly description: "Minimum price filter";
                    };
                    readonly price_max: {
                        readonly type: "number";
                        readonly description: "Maximum price filter";
                    };
                    readonly include_out_of_stock: {
                        readonly type: "boolean";
                        readonly default: false;
                        readonly description: "Whether to include out-of-stock products in results";
                    };
                };
                readonly required: readonly ["query"];
            };
        };
    }, {
        readonly type: "function";
        readonly function: {
            readonly name: "find_best_price";
            readonly description: "Use this whenever a user asks about prices, wants to find the cheapest option, or asks \"what's the best price for X\" or \"where can I buy X for the lowest price\". This finds the best current price across all merchants.";
            readonly parameters: {
                readonly type: "object";
                readonly properties: {
                    readonly product_name: {
                        readonly type: "string";
                        readonly description: "Product name to find best price for (e.g., \"iphone 15 pro 256gb\", \"samsung galaxy s24\")";
                    };
                    readonly q: {
                        readonly type: "string";
                        readonly description: "Alias for product_name (deprecated, use product_name).";
                    };
                    readonly category: {
                        readonly type: "string";
                        readonly description: "Category to filter by (e.g., \"electronics\", \"fashion\")";
                    };
                    readonly country: {
                        readonly type: "string";
                        readonly enum: readonly ["SG", "MY", "TH", "PH", "VN", "ID", "US"];
                        readonly description: "Country to search in (defaults to SG)";
                    };
                    readonly region: {
                        readonly type: "string";
                        readonly enum: readonly ["us", "sea"];
                        readonly description: "Region filter - use \"us\" for United States or \"sea\" for Southeast Asia";
                    };
                };
                readonly required: readonly ["product_name"];
            };
        };
    }, {
        readonly type: "function";
        readonly function: {
            readonly name: "compare_products";
            readonly description: "Use this whenever a user wants to compare multiple products, see side-by-side price comparisons, or understand the differences between product options. Returns products sorted by price with merchant listings.";
            readonly parameters: {
                readonly type: "object";
                readonly properties: {
                    readonly product_ids: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "integer";
                        };
                        readonly description: "Array of product IDs to compare";
                    };
                    readonly category: {
                        readonly type: "string";
                        readonly description: "Category slug to filter products for comparison (e.g., \"electronics\", \"fashion\")";
                    };
                    readonly country: {
                        readonly type: "string";
                        readonly enum: readonly ["SG", "MY", "TH", "PH", "VN", "ID", "US"];
                        readonly description: "Country to search in (defaults to SG)";
                    };
                    readonly limit: {
                        readonly type: "integer";
                        readonly minimum: 1;
                        readonly maximum: 50;
                        readonly default: 10;
                        readonly description: "Maximum number of products to compare";
                    };
                };
            };
        };
    }, {
        readonly type: "function";
        readonly function: {
            readonly name: "get_product_details";
            readonly description: "Use this whenever a user wants detailed information about a specific product, needs to see all available prices from different merchants, or wants to see product reviews and price history. Requires a product_id from a previous search.";
            readonly parameters: {
                readonly type: "object";
                readonly properties: {
                    readonly product_id: {
                        readonly type: "integer";
                        readonly description: "The unique product ID to get details for";
                    };
                    readonly country: {
                        readonly type: "string";
                        readonly enum: readonly ["SG", "MY", "TH", "PH", "VN", "ID", "US"];
                        readonly description: "Country to get product details for (defaults to SG)";
                    };
                    readonly include_reviews: {
                        readonly type: "boolean";
                        readonly default: false;
                        readonly description: "Include review summary in response";
                    };
                    readonly include_price_history: {
                        readonly type: "boolean";
                        readonly default: false;
                        readonly description: "Include price history in response";
                    };
                };
                readonly required: readonly ["product_id"];
            };
        };
    }, {
        readonly type: "function";
        readonly function: {
            readonly name: "get_purchase_options";
            readonly description: "Use this whenever a user is ready to buy and wants to see all purchase options, needs merchant choices for a product, or wants to compare fulfillment ratings and reliability across merchants. Returns all merchants with pricing and reliability scores.";
            readonly parameters: {
                readonly type: "object";
                readonly properties: {
                    readonly product_id: {
                        readonly type: "integer";
                        readonly description: "The unique product ID to get purchase options for";
                    };
                    readonly country: {
                        readonly type: "string";
                        readonly enum: readonly ["SG", "MY", "TH", "PH", "VN", "ID", "US"];
                        readonly description: "Country to get purchase options for (defaults to SG)";
                    };
                    readonly filter_merchant: {
                        readonly type: "string";
                        readonly description: "Filter results to a specific merchant";
                    };
                    readonly filter_price_min: {
                        readonly type: "number";
                        readonly description: "Minimum price filter";
                    };
                    readonly filter_price_max: {
                        readonly type: "number";
                        readonly description: "Maximum price filter";
                    };
                    readonly sort_by: {
                        readonly type: "string";
                        readonly enum: readonly ["price_asc", "price_desc", "reliability", "rating"];
                        readonly default: "price_asc";
                        readonly description: "How to sort purchase options";
                    };
                };
                readonly required: readonly ["product_id"];
            };
        };
    }];
};
declare const MCP_TOOL_DEFINITIONS: readonly [{
    readonly name: "resolve_product_query";
    readonly description: "Use this whenever a user asks to find, search, or look up products — especially when they want product recommendations or need to discover options for a shopping decision. Examples: \"find me a laptop under $1000\", \"what are the best wireless headphones\", \"show me phones available in Singapore\".";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly query: {
                readonly type: "string";
                readonly description: "Natural language search query for products";
            };
            readonly country: {
                readonly type: "string";
                readonly enum: readonly ["SG", "MY", "TH", "PH", "VN", "ID", "US"];
            };
            readonly region: {
                readonly type: "string";
                readonly enum: readonly ["us", "sea"];
            };
            readonly limit: {
                readonly type: "integer";
                readonly minimum: 1;
                readonly maximum: 50;
                readonly default: 10;
            };
            readonly price_min: {
                readonly type: "number";
            };
            readonly price_max: {
                readonly type: "number";
            };
            readonly include_out_of_stock: {
                readonly type: "boolean";
                readonly default: false;
            };
        };
        readonly required: readonly ["query"];
    };
}, {
    readonly name: "find_best_price";
    readonly description: "Use this whenever a user asks about prices, wants to find the cheapest option, or asks \"what's the best price for X\". This finds the best current price across all merchants.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly product_name: {
                readonly type: "string";
                readonly description: "Product name to find best price for";
            };
            readonly q: {
                readonly type: "string";
                readonly description: "Alias for product_name (deprecated, use product_name).";
            };
            readonly category: {
                readonly type: "string";
            };
            readonly country: {
                readonly type: "string";
                readonly enum: readonly ["SG", "MY", "TH", "PH", "VN", "ID", "US"];
            };
            readonly region: {
                readonly type: "string";
                readonly enum: readonly ["us", "sea"];
            };
        };
        readonly required: readonly ["product_name"];
    };
}, {
    readonly name: "compare_products";
    readonly description: "Use this whenever a user wants to compare multiple products or see side-by-side price comparisons.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly product_ids: {
                readonly type: "array";
                readonly items: {
                    readonly type: "integer";
                };
            };
            readonly category: {
                readonly type: "string";
            };
            readonly country: {
                readonly type: "string";
                readonly enum: readonly ["SG", "MY", "TH", "PH", "VN", "ID", "US"];
            };
            readonly limit: {
                readonly type: "integer";
                readonly minimum: 1;
                readonly maximum: 50;
                readonly default: 10;
            };
        };
    };
}, {
    readonly name: "get_product_details";
    readonly description: "Use this whenever a user wants detailed information about a specific product or needs to see all available prices from different merchants.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly product_id: {
                readonly type: "integer";
            };
            readonly country: {
                readonly type: "string";
                readonly enum: readonly ["SG", "MY", "TH", "PH", "VN", "ID", "US"];
            };
            readonly include_reviews: {
                readonly type: "boolean";
                readonly default: false;
            };
            readonly include_price_history: {
                readonly type: "boolean";
                readonly default: false;
            };
        };
        readonly required: readonly ["product_id"];
    };
}, {
    readonly name: "get_purchase_options";
    readonly description: "Use this whenever a user is ready to buy and wants to see all purchase options or compare merchants.";
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly product_id: {
                readonly type: "integer";
            };
            readonly country: {
                readonly type: "string";
                readonly enum: readonly ["SG", "MY", "TH", "PH", "VN", "ID", "US"];
            };
            readonly filter_merchant: {
                readonly type: "string";
            };
            readonly filter_price_min: {
                readonly type: "number";
            };
            readonly filter_price_max: {
                readonly type: "number";
            };
            readonly sort_by: {
                readonly type: "string";
                readonly enum: readonly ["price_asc", "price_desc", "reliability", "rating"];
                readonly default: "price_asc";
            };
        };
        readonly required: readonly ["product_id"];
    };
}];
declare const AGENT_RESULT_SCHEMA: {
    readonly type: "object";
    readonly properties: {
        readonly buywhere_score: {
            readonly type: "object";
            readonly properties: {
                readonly score: {
                    readonly type: "number";
                    readonly description: "Overall BuyWhere quality score (0-100)";
                };
                readonly rank: {
                    readonly type: "integer";
                    readonly description: "Ranking position among results";
                };
                readonly reason_for_rank: {
                    readonly type: "string";
                    readonly description: "Explanation of why this product was ranked this way";
                };
            };
            readonly required: readonly ["score", "rank", "reason_for_rank"];
        };
        readonly confidence: {
            readonly type: "number";
            readonly minimum: 0;
            readonly maximum: 1;
            readonly description: "Confidence score for the match quality (0-1)";
        };
        readonly merchant_reliability_score: {
            readonly type: "object";
            readonly properties: {
                readonly score: {
                    readonly type: "number";
                    readonly description: "Merchant reliability score (0-100)";
                };
                readonly tier: {
                    readonly type: "string";
                    readonly enum: readonly ["platinum", "gold", "silver", "standard"];
                };
                readonly fulfillment_rating: {
                    readonly type: "number";
                    readonly description: "Fulfillment rating (0-5)";
                };
                readonly last_fulfillment_at: {
                    readonly type: "string";
                    readonly description: "ISO timestamp of last successful fulfillment";
                };
            };
            readonly required: readonly ["score", "tier"];
        };
        readonly availability_status: {
            readonly type: "object";
            readonly properties: {
                readonly status: {
                    readonly type: "string";
                    readonly enum: readonly ["in_stock", "low_stock", "out_of_stock", "preorder", "unknown"];
                };
                readonly stock_level: {
                    readonly type: "integer";
                    readonly description: "Estimated units available";
                };
                readonly restock_eta: {
                    readonly type: "string";
                    readonly description: "Estimated restock date if out of stock";
                };
            };
            readonly required: readonly ["status"];
        };
        readonly price_last_checked: {
            readonly type: "string";
            readonly format: "date-time";
            readonly description: "ISO timestamp of when the price was last verified";
        };
        readonly exact_match: {
            readonly type: "boolean";
            readonly description: "Whether this is an exact match to the query or an approximate/fuzzy match";
        };
    };
    readonly required: readonly ["buywhere_score", "confidence", "merchant_reliability_score", "availability_status", "price_last_checked", "exact_match"];
};
declare const QUERY_RESULT_SCHEMA: {
    readonly type: "object";
    readonly properties: {
        readonly query_processed: {
            readonly type: "string";
            readonly description: "The search query after processing/normalization";
        };
        readonly total: {
            readonly type: "integer";
            readonly description: "Total number of matching products";
        };
        readonly results: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly properties: {
                    readonly product_id: {
                        readonly type: "integer";
                    };
                    readonly title: {
                        readonly type: "string";
                    };
                    readonly buywhere_score: {
                        readonly type: "object";
                        readonly properties: {
                            readonly score: {
                                readonly type: "number";
                                readonly description: "Overall BuyWhere quality score (0-100)";
                            };
                            readonly rank: {
                                readonly type: "integer";
                                readonly description: "Ranking position among results";
                            };
                            readonly reason_for_rank: {
                                readonly type: "string";
                                readonly description: "Explanation of why this product was ranked this way";
                            };
                        };
                        readonly required: readonly ["score", "rank", "reason_for_rank"];
                    };
                    readonly confidence: {
                        readonly type: "number";
                        readonly minimum: 0;
                        readonly maximum: 1;
                        readonly description: "Confidence score for the match quality (0-1)";
                    };
                    readonly merchant_reliability_score: {
                        readonly type: "object";
                        readonly properties: {
                            readonly score: {
                                readonly type: "number";
                                readonly description: "Merchant reliability score (0-100)";
                            };
                            readonly tier: {
                                readonly type: "string";
                                readonly enum: readonly ["platinum", "gold", "silver", "standard"];
                            };
                            readonly fulfillment_rating: {
                                readonly type: "number";
                                readonly description: "Fulfillment rating (0-5)";
                            };
                            readonly last_fulfillment_at: {
                                readonly type: "string";
                                readonly description: "ISO timestamp of last successful fulfillment";
                            };
                        };
                        readonly required: readonly ["score", "tier"];
                    };
                    readonly availability_status: {
                        readonly type: "object";
                        readonly properties: {
                            readonly status: {
                                readonly type: "string";
                                readonly enum: readonly ["in_stock", "low_stock", "out_of_stock", "preorder", "unknown"];
                            };
                            readonly stock_level: {
                                readonly type: "integer";
                                readonly description: "Estimated units available";
                            };
                            readonly restock_eta: {
                                readonly type: "string";
                                readonly description: "Estimated restock date if out of stock";
                            };
                        };
                        readonly required: readonly ["status"];
                    };
                    readonly price_last_checked: {
                        readonly type: "string";
                        readonly format: "date-time";
                        readonly description: "ISO timestamp of when the price was last verified";
                    };
                    readonly exact_match: {
                        readonly type: "boolean";
                        readonly description: "Whether this is an exact match to the query or an approximate/fuzzy match";
                    };
                    readonly prices: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "object";
                            readonly properties: {
                                readonly merchant: {
                                    readonly type: "string";
                                };
                                readonly price: {
                                    readonly type: "number";
                                };
                                readonly currency: {
                                    readonly type: "string";
                                };
                                readonly buy_url: {
                                    readonly type: "string";
                                };
                                readonly affiliate_url: {
                                    readonly type: "string";
                                };
                            };
                        };
                    };
                };
            };
        };
        readonly query_time_ms: {
            readonly type: "integer";
            readonly description: "Query processing time in milliseconds";
        };
        readonly cache_hit: {
            readonly type: "boolean";
            readonly description: "Whether the result was served from cache";
        };
    };
    readonly required: readonly ["query_processed", "total", "results", "query_time_ms"];
};

declare const MACHINE_RELEVANT_METRICS_SCHEMA: {
    readonly type: "object";
    readonly properties: {
        readonly latency: {
            readonly type: "object";
            readonly description: "API response latency metrics";
            readonly properties: {
                readonly p50_ms: {
                    readonly type: "number";
                    readonly description: "50th percentile latency in milliseconds";
                };
                readonly p95_ms: {
                    readonly type: "number";
                    readonly description: "95th percentile latency in milliseconds";
                };
                readonly p99_ms: {
                    readonly type: "number";
                    readonly description: "99th percentile latency in milliseconds";
                };
                readonly avg_ms: {
                    readonly type: "number";
                    readonly description: "Average latency in milliseconds";
                };
            };
            readonly required: readonly ["p50_ms", "p95_ms", "p99_ms", "avg_ms"];
        };
        readonly accuracy: {
            readonly type: "object";
            readonly description: "Result quality and relevance metrics";
            readonly properties: {
                readonly exact_match_rate: {
                    readonly type: "number";
                    readonly minimum: 0;
                    readonly maximum: 1;
                    readonly description: "Rate of exact query matches (0-1)";
                };
                readonly relevance_score_avg: {
                    readonly type: "number";
                    readonly minimum: 0;
                    readonly maximum: 1;
                    readonly description: "Average relevance score across results (0-1)";
                };
                readonly zero_results_rate: {
                    readonly type: "number";
                    readonly minimum: 0;
                    readonly maximum: 1;
                    readonly description: "Rate of queries returning no results (0-1)";
                };
            };
            readonly required: readonly ["exact_match_rate", "relevance_score_avg", "zero_results_rate"];
        };
        readonly freshness: {
            readonly type: "object";
            readonly description: "Data freshness metrics";
            readonly properties: {
                readonly prices_updated_last_1h: {
                    readonly type: "integer";
                    readonly description: "Number of prices updated in the last hour";
                };
                readonly prices_updated_last_24h: {
                    readonly type: "integer";
                    readonly description: "Number of prices updated in the last 24 hours";
                };
                readonly avg_price_freshness_minutes: {
                    readonly type: "number";
                    readonly description: "Average age of price data in minutes";
                };
            };
            readonly required: readonly ["prices_updated_last_1h", "prices_updated_last_24h", "avg_price_freshness_minutes"];
        };
        readonly coverage: {
            readonly type: "object";
            readonly description: "Catalog coverage metrics";
            readonly properties: {
                readonly total_products: {
                    readonly type: "integer";
                    readonly description: "Total number of products in catalog";
                };
                readonly products_with_current_price: {
                    readonly type: "integer";
                    readonly description: "Products with up-to-date pricing";
                };
                readonly total_merchants: {
                    readonly type: "integer";
                    readonly description: "Total number of merchants tracked";
                };
                readonly active_merchants: {
                    readonly type: "integer";
                    readonly description: "Merchants with active listings";
                };
                readonly country: {
                    readonly type: "string";
                    readonly enum: readonly ["SG", "MY", "TH", "PH", "VN", "ID", "US"];
                };
                readonly category: {
                    readonly type: "string";
                    readonly description: "Category filter if applied (undefined for all)";
                };
            };
            readonly required: readonly ["total_products", "products_with_current_price", "total_merchants", "active_merchants", "country"];
        };
        readonly timestamp: {
            readonly type: "string";
            readonly format: "date-time";
            readonly description: "ISO timestamp when metrics were generated";
        };
    };
    readonly required: readonly ["latency", "accuracy", "freshness", "coverage", "timestamp"];
};
declare const METRICS_ENDPOINT_RESPONSE: {
    readonly type: "object";
    readonly example: {
        readonly latency: {
            readonly p50_ms: 45;
            readonly p95_ms: 120;
            readonly p99_ms: 250;
            readonly avg_ms: 52;
        };
        readonly accuracy: {
            readonly exact_match_rate: 0.78;
            readonly relevance_score_avg: 0.85;
            readonly zero_results_rate: 0.05;
        };
        readonly freshness: {
            readonly prices_updated_last_1h: 15420;
            readonly prices_updated_last_24h: 287540;
            readonly avg_price_freshness_minutes: 12.5;
        };
        readonly coverage: {
            readonly total_products: 1247583;
            readonly products_with_current_price: 1189234;
            readonly total_merchants: 67;
            readonly active_merchants: 52;
            readonly country: "SG";
            readonly category: undefined;
        };
        readonly timestamp: "2026-04-27T12:00:00.000Z";
    };
};

declare class BuyWhereSDK {
    readonly search: SearchClient;
    readonly compare: CompareNamespace;
    readonly deals: DealsClient;
    readonly products: ProductsClient;
    readonly autocomplete: AutocompleteClient;
    readonly agents: AgentsClient;
    readonly webhooks: WebhooksClient;
    private _config;
    private client;
    constructor(config: string | ClientConfig);
    getClient(): BuyWhereClient;
    priceHistory(productId: ProductId, options?: PriceHistoryOptions): Promise<PriceHistoryResponse$1>;
    rotateApiKey(): Promise<RotateApiKeyResponse>;
}
declare function createClient(config: string | ClientConfig): BuyWhereSDK;

declare const SupportedCountries: Country$1[];
declare const SupportedRegions: Region[];

export { AGENT_RESULT_SCHEMA, type AgentSearchParams, type AgentSearchResponse, type AgentSearchResult, AgentsClient, ApiError, type AuthMeResponse, AutocompleteClient, type AutocompleteOptions, type AutocompleteResult, type AutocompleteSuggestion, type AvailabilityStatus, type BatchSearchParams, type BatchSearchResult, BuyWhereClient, BuyWhereError, BuyWhereSDK, type BuyWhereScore, CircuitBreaker, type CircuitBreakerConfig$1 as CircuitBreakerConfig, CircuitBreakerError, type CircuitBreakerState, type ClientConfig, type CompareNamespace, type CompareParams, type CompareProductsInput, type CompareProductsOutput, type CompareResponse, type Country$1 as Country, type DealProduct, type DealsFeedParams, type DealsFeedResponse, type DealsParams, type DealsResponse, type ErrorCode, type ErrorResponse, type FindBestPriceInput, type FindBestPriceOutput, type GetPriceHistoryParams, type GetProductAlertsParams, type GetProductDetailsInput, type GetProductDetailsOutput, type GetProductReviewsParams, type GetPurchaseOptionsInput, type GetPurchaseOptionsOutput, MACHINE_RELEVANT_METRICS_SCHEMA, MCP_TOOL_DEFINITIONS, METRICS_ENDPOINT_RESPONSE, type MerchantPrice$1 as MerchantPrice, type MerchantReliability, type MetricsInput, type MetricsOutput, OPENAI_TOOL_SCHEMAS, type PriceHistoryOptions, type PriceHistoryResponse$1 as PriceHistoryResponse, type Product, type ProductAlert, type ProductDetail, type ProductId, type ProductPrice, ProductsClient, QUERY_RESULT_SCHEMA, type Region, type ResolveProductQueryInput, type ResolveProductQueryOutput, type RetailerReview, type RetryConfig, type ReviewSummary$1 as ReviewSummary, type RotateApiKeyResponse, type SearchParams, type SearchResponse, SupportedCountries, SupportedRegions, type UTMParams, ValidationError, type ValidationErrorDetail, type Webhook, type WebhookCreateResponse, type WebhookListResponse, WebhooksClient, createCategoryNotFoundResponse, createCircuitBreakerErrorResponse, createClient, createErrorResponse, createProductNotFoundResponse, createRateLimitErrorResponse, createValidationErrorResponse, isAuthError, isRetryableError, mapHttpStatusToErrorCode, parseApiErrorResponse, validateAgentSearchParams, validateBatchSearchParams, validateCompareParams, validateDealsFeedParams, validateDealsParams, validateGetPriceHistoryParams, validateGetProductAlertsParams, validateGetProductReviewsParams, validatePriceHistoryOptions, validateProductId, validateSearchParams, validateWebhookEvents, validateWebhookUrl };
