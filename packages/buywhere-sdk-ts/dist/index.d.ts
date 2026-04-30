interface Product {
    id: number;
    sku: string;
    source: string;
    merchant_id: string;
    name: string;
    description: string;
    price: number;
    currency: string;
    buy_url: string;
    affiliate_url: string | null;
    image_url: string | null;
    category: string;
    category_path: string[];
    is_available: boolean;
    metadata: Record<string, unknown>;
    updated_at: string;
    match_score?: number;
    price_rank?: number;
    original_price?: number;
    discount_pct?: number;
    savings_vs_most_expensive?: number;
    savings_pct?: number;
}
interface ProductListResponse {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
    items: Product[];
}
interface ProductResponse {
    id: number;
    sku: string;
    source: string;
    merchant_id: string;
    name: string;
    description: string;
    price: number;
    currency: string;
    buy_url: string;
    affiliate_url: string | null;
    image_url: string | null;
    category: string;
    category_path: string[];
    is_available: boolean;
    metadata: Record<string, unknown>;
    updated_at: string;
}
interface CompareMatch {
    id: number;
    sku: string;
    source: string;
    merchant_id: string;
    name: string;
    description: string | null;
    price: number;
    currency: string;
    buy_url: string;
    affiliate_url: string | null;
    image_url: string | null;
    brand: string | null;
    category: string | null;
    category_path: string[] | null;
    rating: number | null;
    is_available: boolean;
    last_checked: string | null;
    metadata: Record<string, unknown> | null;
    updated_at: string;
    match_score: number;
    savings_vs_most_expensive?: number;
    savings_pct?: number;
}
interface CompareHighlights {
    cheapest: CompareMatch | null;
    best_rated: CompareMatch | null;
    fastest_shipping: CompareMatch | null;
}
interface CompareResponse {
    source_product_id: number;
    source_product_name: string;
    total_matches: number;
    matches: CompareMatch[];
    highlights: CompareHighlights | null;
}
interface CompareMatrixResponse {
    total_products: number;
    comparisons: CompareResponse[];
}
interface FieldDiff {
    field: string;
    values: unknown[];
    all_identical: boolean;
}
interface CompareDiffResponse {
    products: Product[];
    field_diffs: FieldDiff[];
    identical_fields: string[];
    cheapest_product_id: number;
    most_expensive_product_id: number;
    price_spread: number;
    price_spread_pct: number;
}
interface TrendingResponse {
    category: string | null;
    total: number;
    items: Product[];
}
interface Category {
    name: string;
    count: number;
    children: Category[];
}
interface CategoryResponse {
    categories: Category[];
    total: number;
}
interface DealItem {
    id: number;
    name: string;
    price: number;
    original_price: number;
    discount_pct: number;
    currency: string;
    source: string;
    category: string;
    buy_url: string;
    affiliate_url: string | null;
    image_url: string | null;
    metadata: Record<string, unknown>;
}
interface DealsResponse {
    total: number;
    limit: number;
    offset: number;
    items: DealItem[];
}
interface IngestProduct {
    sku: string;
    merchant_id?: string;
    title: string;
    description?: string;
    price: number;
    currency?: string;
    url: string;
    image_url?: string;
    category?: string;
    category_path?: string[];
    brand?: string;
    is_active?: boolean;
    metadata?: Record<string, unknown>;
}
interface IngestRequest {
    source: string;
    products: IngestProduct[];
}
interface IngestResponse {
    ingested: number;
    updated: number;
    failed: number;
    errors: string[];
}
interface ChangelogRelease {
    version: string;
    date: string;
    changes: {
        category: string;
        group: string | null;
        description: string;
    }[];
}
interface ChangelogResponse {
    api_version: string;
    releases: ChangelogRelease[];
}
interface HealthStatus {
    status: string;
    version: string;
    environment: string;
}
interface ApiInfo {
    api: string;
    version: string;
    endpoints: Record<string, string>;
    auth: string;
    docs: string;
}
interface RateLimitInfo {
    limit: number;
    remaining: number;
    reset: number;
}
interface SearchOptions {
    q?: string;
    category?: string;
    min_price?: number;
    max_price?: number;
    source?: string;
    in_stock?: boolean;
    limit?: number;
    offset?: number;
}
interface CompareOptions {
    product_id: number;
    min_price?: number;
    max_price?: number;
}
interface CompareByIdOptions {
    min_price?: number;
    max_price?: number;
}
interface CompareDiffOptions {
    product_ids: number[];
    include_image_similarity?: boolean;
}
interface CompareMatrixOptions {
    product_ids: number[];
    min_price?: number;
    max_price?: number;
}
interface DealsOptions {
    category?: string;
    min_discount_pct?: number;
    limit?: number;
    offset?: number;
}
interface ExportOptions {
    format?: "csv" | "json";
    category?: string;
    source?: string;
    min_price?: number;
    max_price?: number;
    limit?: number;
    offset?: number;
}

declare class BuyWhereClient {
    private baseUrl;
    private apiKey;
    private timeout;
    private maxRetries;
    private retryDelay;
    private backoffMultiplier;
    constructor(apiKey: string, options?: {
        baseUrl?: string;
        timeout?: number;
        maxRetries?: number;
        retryDelay?: number;
        backoffMultiplier?: number;
    });
    private getHeaders;
    private sleep;
    private fetchWithRetry;
    health(): Promise<HealthStatus>;
    apiInfo(): Promise<ApiInfo>;
    changelog(): Promise<ChangelogResponse>;
    search(options?: SearchOptions): Promise<ProductListResponse>;
    searchProducts(options?: SearchOptions): Promise<ProductListResponse>;
    bestPrice(query: string, category?: string): Promise<ProductResponse>;
    compare(options: CompareOptions): Promise<CompareResponse>;
    compareProductById(productId: number, options?: {
        min_price?: number;
        max_price?: number;
    }): Promise<CompareResponse>;
    compareProducts(options: CompareMatrixOptions): Promise<CompareMatrixResponse>;
    compareProductsDiff(options: CompareDiffOptions): Promise<CompareDiffResponse>;
    trending(category?: string, limit?: number): Promise<TrendingResponse>;
    getProduct(productId: number): Promise<ProductResponse>;
    exportProducts(options?: ExportOptions): Promise<Product[] | string>;
    categories(): Promise<CategoryResponse>;
    deals(options?: DealsOptions): Promise<DealsResponse>;
    ingest(request: IngestRequest): Promise<IngestResponse>;
}

declare class BuyWhereError extends Error {
    statusCode?: number | undefined;
    constructor(message: string, statusCode?: number | undefined);
}
declare class AuthenticationError extends BuyWhereError {
    constructor(message: string, statusCode?: number);
}
declare class RateLimitError extends BuyWhereError {
    constructor(message: string, statusCode?: number);
}
declare class NotFoundError extends BuyWhereError {
    constructor(message: string, statusCode?: number);
}
declare class ValidationError extends BuyWhereError {
    constructor(message: string, statusCode?: number);
}
declare class ServerError extends BuyWhereError {
    constructor(message: string, statusCode?: number);
}

export { type ApiInfo, AuthenticationError, BuyWhereClient, BuyWhereError, type Category, type CategoryResponse, type ChangelogRelease, type ChangelogResponse, type CompareByIdOptions, type CompareDiffOptions, type CompareDiffResponse, type CompareHighlights, type CompareMatch, type CompareMatrixOptions, type CompareMatrixResponse, type CompareOptions, type CompareResponse, type DealItem, type DealsOptions, type DealsResponse, type ExportOptions, type FieldDiff, type HealthStatus, type IngestProduct, type IngestRequest, type IngestResponse, NotFoundError, type Product, type ProductListResponse, type ProductResponse, RateLimitError, type RateLimitInfo, type SearchOptions, ServerError, type TrendingResponse, ValidationError };
