from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict
from decimal import Decimal
from datetime import datetime
from enum import Enum



class PriceTrend(str):
    UP = "up"
    DOWN = "down"
    STABLE = "stable"


class PriceHistoryEntry(BaseModel):
    price: Decimal
    currency: str
    platform: str = Field(..., description="Source platform (e.g. shopee_sg, lazada_sg)")
    scraped_at: datetime = Field(..., description="Timestamp when price was scraped")

    model_config = {"from_attributes": True, "populate_by_name": True}


class PriceHistoryAggregationEntry(BaseModel):
    date: str = Field(..., description="Date in YYYY-MM-DD format")
    min_price: Decimal
    max_price: Decimal
    avg_price: Decimal
    price_count: int = Field(..., description="Number of price records on this date")
    currency: str
    platform: Optional[str] = Field(None, description="Source platform if aggregated by platform, else null for all platforms")

    model_config = {"from_attributes": True, "populate_by_name": True}


class PriceHistoryResponse(BaseModel):
    product_id: int
    entries: List[PriceHistoryEntry] = Field(default_factory=list)
    aggregated_entries: List[PriceHistoryAggregationEntry] = Field(default_factory=list, description="Aggregated daily time series when aggregate=daily is requested")
    total: int
    aggregate: Optional[str] = Field(None, description="Aggregation type: 'daily' if aggregated")
    period: Optional[str] = Field(None, description="Period requested (e.g. '30d')")


class PriceStats(BaseModel):
    current_price: Decimal
    average_price: Decimal
    min_price: Decimal
    max_price: Decimal
    price_change_24h: Optional[Decimal] = None
    price_change_7d: Optional[Decimal] = None
    price_change_30d: Optional[Decimal] = None


class PricePredictionResponse(BaseModel):
    product_id: int
    predicted_price: Decimal
    confidence: float
    prediction_date: datetime
    factors: List[str]


class ProductResponse(BaseModel):
    id: int
    sku: str
    source: str
    merchant_id: str
    name: str = Field(..., description="Product title")
    description: Optional[str] = None
    price: Decimal
    currency: str
    price_sgd: Optional[Decimal] = Field(None, description="Price normalized to SGD")
    converted_price: Optional[Decimal] = Field(None, description="Price converted to requested currency (when ?currency= param is used)")
    converted_currency: Optional[str] = Field(None, description="Currency of converted_price")
    buy_url: str = Field(..., description="Direct purchase URL")
    affiliate_url: Optional[str] = Field(None, description="Tracked affiliate URL (use this to send traffic)")
    image_url: Optional[str] = None
    barcode: Optional[str] = Field(None, description="UPC/EAN barcode for the product")
    brand: Optional[str] = None
    category: Optional[str] = None
    category_path: Optional[List[str]] = None
    rating: Optional[Decimal] = None
    review_count: Optional[int] = Field(None, description="Number of reviews from aggregated sources")
    avg_rating: Optional[Decimal] = Field(None, description="Average rating from aggregated sources (0-5)")
    rating_source: Optional[str] = Field(None, description="Source of the aggregated rating (e.g. 'scraped', 'platform_api')")
    region: str = Field("sg", description="Geographic region (e.g. sg, us, sea, eu, au)")
    country_code: str = Field("SG", description="ISO 3166-1 alpha-2 country code")
    is_available: bool = Field(..., description="Whether product is currently in stock and available for purchase")
    in_stock: Optional[bool] = Field(None, description="Whether product is in stock")
    stock_level: Optional[str] = Field(None, description="Stock level: low, medium, or high")
    last_checked: Optional[datetime] = Field(None, description="Timestamp when availability was last checked")
    data_updated_at: Optional[datetime] = Field(None, description="Timestamp when product data was last updated")
    availability_prediction: Optional[str] = Field(None, description="Predicted availability based on historical patterns (e.g., 'likely_in_stock', 'likely_out_of_stock')")
    competitor_count: Optional[int] = Field(None, description="Number of platforms selling the same product")
    confidence_score: Optional[float] = Field(None, description="Confidence score of search match (0-1)")
    specs: Optional[Dict[str, Any]] = Field(None, description="Product specifications as key-value pairs for comparison (e.g. {color: 'Black', storage: '256GB'})")
    metadata: Optional[Any] = None
    updated_at: datetime
    price_trend: Optional[str] = Field(None, description="30-day price trend: 'up', 'down', or 'stable'")
    json_ld: Optional[str] = Field(None, description="JSON-LD structured data script tag for SEO/AI agents. Contains Schema.org Product and Offer data.")


class SearchFiltersResponse(BaseModel):
    categories: List[Any]
    brands: List[Any]
    platforms: List[Any]
    countries: List[Any]
    price_ranges: List[Any]
    rating_ranges: List[Any]
    price_min: Decimal
    price_max: Decimal


class ProductListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: List[ProductResponse]
    has_more: bool = False
    next_cursor: Optional[int] = None
    facets: Optional[Any] = None
    highlights: Optional[Dict[str, str]] = None


class V1ProductSearchItem(BaseModel):
    id: int
    sku: str
    source: str
    merchant_id: str
    name: str
    description: Optional[str] = None
    price: Decimal
    currency: str
    region: str = Field("sg", description="Geographic region")
    country_code: str = Field("SG", description="ISO 3166-1 alpha-2 country code")
    buy_url: str
    affiliate_url: Optional[str] = None
    image_url: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    category_path: Optional[List[str]] = None
    rating: Optional[Decimal] = None
    review_count: Optional[int] = None
    is_available: bool = True
    in_stock: Optional[bool] = None
    stock_level: Optional[str] = None
    last_checked: Optional[datetime] = None
    metadata_: Optional[Any] = None
    updated_at: datetime
    price_trend: Optional[str] = None
    confidence_score: Optional[float] = None


class V1ProductSearchMeta(BaseModel):
    query: Optional[str] = None
    filters_applied: Dict[str, Any] = Field(default_factory=dict)
    total_results: int
    page_info: Dict[str, Any] = Field(default_factory=dict)


class V1ProductSearchResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: List[V1ProductSearchItem]
    has_more: bool
    meta: V1ProductSearchMeta


class ProductFeedCursorResponse(BaseModel):
    items: List[ProductResponse]
    next_cursor: Optional[str]
    has_more: bool


class SearchSuggestionResponse(BaseModel):
    suggestions: List[str]
    total: int


class AutocompleteResponse(BaseModel):
    query: str
    suggestions: List[Any]
    total: int


class TaxonomyResponse(BaseModel):
    categories: List['TaxonomyCategory']
    total: int
    version: str


class CategoryNode(BaseModel):
    id: str
    name: str
    slug: str
    parent_id: Optional[str] = None
    count: int
    children: List['CategoryNode'] = Field(default_factory=list)


class CategoryResponse(BaseModel):
    categories: List[CategoryNode]
    total: int


class TaxonomyCategory(BaseModel):
    id: str
    name: str
    product_count: int
    subcategories: List[Dict[str, Any]] = Field(default_factory=list)


class ProductIngestResponse(BaseModel):
    ingested: int
    updated: int
    failed: int
    errors: List[str]


class CompareSearchResponse(BaseModel):
    query: str
    items: List[Any]
    total: int
    cheapest_product_id: Optional[int] = None
    best_rated_product_id: Optional[int] = None
    fastest_shipping_product_id: Optional[int] = None


class PriceMissingReason(str, Enum):
    RETAILER_API_ERROR = "retailer_api_error"
    RETAILER_TIMEOUT = "retailer_timeout"
    PRODUCT_UNAVAILABLE = "product_unavailable"
    PRICE_NOT_DISCLOSED = "price_not_disclosed"
    CRAWL_ERROR = "crawl_error"


class CompareMatch(BaseModel):
    id: int
    sku: str
    source: str
    merchant_id: str
    merchant_name: Optional[str] = Field(None, description="Human-readable merchant/store name")
    name: str
    description: Optional[str] = None
    price: Decimal
    currency: str
    buy_url: str
    affiliate_url: Optional[str] = None
    image_url: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    category_path: Optional[List[str]] = None
    rating: Optional[Decimal] = None
    is_available: bool
    last_checked: Optional[datetime] = None
    metadata: Optional[Any] = None
    updated_at: datetime
    match_score: float
    savings_vs_most_expensive: Optional[float] = None
    savings_pct: Optional[float] = None
    price_missing: bool = Field(False, description="True when price is not available from this retailer")
    price_missing_reason: Optional[PriceMissingReason] = Field(None, description="Reason why price is missing")
    zero_price: bool = Field(False, description="True when product is free (price is 0)")
    data_freshness: Optional[str] = Field(None, description="Data freshness tier: fresh (<24h), recent (24h-7d), stale (7-30d), very_stale (>30d)")
    merchant_edge_case: Optional[str] = Field(
        None,
        description="Edge case flag for merchant issues: 'duplicate_merchant', 'empty_merchant_id', 'unknown_merchant', 'cross_border_merchant', or null if no issues"
    )


class CompareHighlights(BaseModel):
    cheapest: Optional[CompareMatch] = None
    best_rated: Optional[CompareMatch] = None
    fastest_shipping: Optional[CompareMatch] = None


class CompareResponse(BaseModel):
    source_product_id: int
    source_product_name: str
    matches: List[Any]
    total_matches: int
    highlights: CompareHighlights
    meta: Optional[Dict[str, Any]] = Field(None, description="Metadata including price_coverage_pct, stale_count, very_stale_count")


class ProductMatchResponse(BaseModel):
    id: int
    name: str
    price: Decimal
    currency: str
    match_score: float


class ProductMatchesResponse(BaseModel):
    product_id: int
    matches: List[CompareMatch]
    total_matches: int


class SimilarProductsResponse(BaseModel):
    product_id: int
    items: List[Any]
    total: int


class SimilarMatch(BaseModel):
    id: int
    sku: str
    source: str
    merchant_id: str
    name: str
    description: Optional[str] = None
    price: Decimal
    currency: str
    buy_url: str
    affiliate_url: Optional[str] = None
    image_url: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    category_path: Optional[List[str]] = None
    rating: Optional[Decimal] = None
    is_available: bool = True
    in_stock: Optional[bool] = None
    stock_level: Optional[str] = None
    last_checked: Optional[datetime] = None
    metadata: Optional[Any] = None
    updated_at: Optional[datetime] = None
    similarity_score: float
    match_reasons: List[str] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class RatingDistributionBucket(BaseModel):
    stars: int = Field(..., description="Star rating (1-5)")
    count: int = Field(..., description="Number of reviews with this star rating")
    percentage: float = Field(..., description="Percentage of total reviews")

    model_config = {"from_attributes": True}


class CompareMatrixResponse(BaseModel):
    comparisons: List[Any]
    total_products: int
    highlights: Optional[Any] = None


class CompareMatrixRequest(BaseModel):
    product_ids: List[int]
    min_price: Optional[float] = None
    max_price: Optional[float] = None


class CompareMatrixEntry(BaseModel):
    source_product_id: int
    source_product_name: str
    matches: List[Any]
    total_matches: int


class CompareDiffRequest(BaseModel):
    product_ids: List[int]
    include_image_similarity: Optional[bool] = None


class CompareDiffEntry(BaseModel):
    id: int
    sku: str
    source: str
    merchant_id: str
    name: str
    description: Optional[str] = None
    price: Decimal
    currency: str
    buy_url: str
    affiliate_url: Optional[str] = None
    image_url: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    category_path: Optional[List[str]] = None
    is_available: bool
    specs: Optional[Dict[str, Any]] = Field(None, description="Product specifications as key-value pairs for comparison")
    metadata: Optional[Any] = None
    updated_at: datetime
    price_rank: Optional[int] = None


class FieldDiff(BaseModel):
    field: str
    values: List[Any]
    all_identical: bool


class TrendingMatch(BaseModel):
    product_id: int
    title: str
    source: str
    price: Decimal
    currency: str
    view_count: int
    click_count: int
    updated_at: datetime


class RecommendationMatch(BaseModel):
    id: int
    sku: str
    source: str
    merchant_id: str
    name: str
    description: Optional[str] = None
    price: Decimal
    currency: str
    buy_url: str
    affiliate_url: Optional[str] = None
    image_url: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    category_path: Optional[List[str]] = None
    rating: Optional[Decimal] = None
    review_count: Optional[int] = None
    is_available: bool = True
    in_stock: Optional[bool] = None
    stock_level: Optional[str] = None
    last_checked: Optional[datetime] = None
    metadata: Optional[Any] = None
    updated_at: Optional[datetime] = None
    relevance_score: Optional[float] = None


class BundleMatch(BaseModel):
    id: int
    sku: str
    source: str
    merchant_id: str
    name: str
    description: Optional[str] = None
    price: Decimal
    currency: str
    buy_url: str
    affiliate_url: Optional[str] = None
    image_url: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    category_path: Optional[List[str]] = None
    rating: Optional[Decimal] = None
    review_count: Optional[int] = None
    is_available: bool = True
    in_stock: Optional[bool] = None
    stock_level: Optional[str] = None
    last_checked: Optional[datetime] = None
    bundle_with: List[int] = Field(default_factory=list)
    savings: Decimal
    savings_pct: float


class CompareSearchMatch(BaseModel):
    id: int
    sku: str
    source: str
    merchant_id: str
    name: str
    description: Optional[str] = None
    price: Decimal
    currency: str
    buy_url: str
    affiliate_url: Optional[str] = None
    image_url: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    category_path: Optional[List[str]] = None
    rating: Optional[Decimal] = None
    is_available: bool = True
    in_stock: Optional[bool] = None
    stock_level: Optional[str] = None
    last_checked: Optional[datetime] = None
    metadata: Optional[Any] = None
    updated_at: Optional[datetime] = None
    match_score: float


class StockStatus(str, Enum):
    IN_STOCK = "in_stock"
    LOW_STOCK = "low_stock"
    OUT_OF_STOCK = "out_of_stock"
    PRE_ORDER = "pre_order"


class PlatformAvailability(BaseModel):
    platform: str = Field(..., description="Source platform (e.g. shopee_sg, lazada_sg)")
    status: StockStatus = Field(..., description="Stock status: in_stock, low_stock, out_of_stock, pre_order")
    last_checked_at: Optional[datetime] = Field(None, description="Timestamp when availability was last checked")
    raw_stock_info: Optional[Any] = Field(None, description="Raw stock info from metadata if available")

    model_config = {"from_attributes": True}


class PlatformDistribution(BaseModel):
    platform: str = Field(..., description="Platform identifier (e.g. shopee_sg, lazada_sg)")
    count: int = Field(..., description="Number of products from this platform")
    percentage: float = Field(..., description="Percentage of total products (0-100)")

    model_config = {"from_attributes": True}


class CategoryBreakdown(BaseModel):
    category: str = Field(..., description="Category name")
    count: int = Field(..., description="Number of products in this category")
    percentage: float = Field(..., description="Percentage of total products (0-100)")

    model_config = {"from_attributes": True}


class CompareDiffResponse(BaseModel):
    products: List[Any]
    field_diffs: List[Any]
    identical_fields: List[str]
    cheapest_product_id: int
    most_expensive_product_id: int
    price_spread: Decimal
    price_spread_pct: float


class CompactCompareResponse(BaseModel):
    products: List[Any]
    total: int
    field_labels: List[str] = Field(default_factory=list, description="Ordered list of spec field names present across all products")
    cheapest_product_id: Optional[int] = None
    best_rated_product_id: Optional[int] = None


class TrendingResponse(BaseModel):
    period: str
    category: Optional[str] = None
    items: List[Any]
    total: int
    platform_distribution: List[Any] = Field(default_factory=list)
    category_breakdown: List[Any] = Field(default_factory=list)


class ApiKeyResponse(BaseModel):
    id: str
    name: str
    tier: str
    is_active: bool
    created_at: datetime
    last_used_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ApiKeyCreateRequest(BaseModel):
    name: str
    rate_limit: Optional[int] = None
    allowed_origins: Optional[List[str]] = None


class ApiKeyCreateResponse(BaseModel):
    key_id: str
    raw_key: str
    name: str
    tier: str
    message: str = "Store this key securely — it will not be shown again."

    model_config = {"from_attributes": True}


class ApiKeyRotateResponse(BaseModel):
    key_id: str
    raw_key: str
    name: str
    tier: str
    expires_at: datetime
    message: str = "Old key remains valid for 24 hours. Rotate again if you do not see it invalidated."

    model_config = {"from_attributes": True}


# Search-related schemas
class SearchSuggestion(BaseModel):
    suggestion: str
    product_count: int


class AutocompleteSuggestion(BaseModel):
    suggestion: str
    product_count: int


class FacetBucket(BaseModel):
    value: str
    count: int


class PriceFacetBucket(BaseModel):
    range: str
    count: int


class RatingFacetBucket(BaseModel):
    range: str
    count: int


class FacetCounts(BaseModel):
    categories: List[FacetBucket] = Field(default_factory=list)
    platforms: List[FacetBucket] = Field(default_factory=list)
    brands: List[FacetBucket] = Field(default_factory=list)
    rating_ranges: List[RatingFacetBucket] = Field(default_factory=list)
    price_ranges: List[PriceFacetBucket] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class ApiKeyListResponse(BaseModel):
    keys: List[ApiKeyResponse]
    total: int


class DeveloperSignupRequest(BaseModel):
    email: str
    name: str
    experiment_variant: Optional[str] = None
    discovery_path: Optional[str] = None
    referrer: Optional[str] = None
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    utm_content: Optional[str] = None
    utm_term: Optional[str] = None


class DeveloperSignupResponse(BaseModel):
    developer_id: Optional[str] = None
    email: str
    plan: Optional[str] = None
    key_id: Optional[str] = None
    raw_key: Optional[str] = None
    name: Optional[str] = None
    tier: Optional[str] = None
    message: str = ""


class DeveloperResponse(BaseModel):
    id: str
    email: str
    plan: str
    created_at: datetime

    model_config = {"from_attributes": True}


class DeveloperMeResponse(BaseModel):
    developer: DeveloperResponse
    api_keys: List[ApiKeyResponse]
    total_keys: int


class EndpointUsage(BaseModel):
    endpoint: str
    method: str
    count: int
    avg_response_time_ms: float


class UsageStats(BaseModel):
    requests_today: int
    requests_this_week: int
    requests_this_month: int
    total_requests: int
    quota_limit: int
    quota_remaining: int
    quota_used_pct: float
    top_endpoints: List[EndpointUsage]
    avg_response_time_ms: float
    alert_triggered: bool


class DeveloperUsageResponse(BaseModel):
    developer_id: str
    key_id: str
    key_name: str
    tier: str
    usage: UsageStats
    alert_config: dict


class BundleResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    price: Decimal
    currency: str
    savings: Decimal
    savings_pct: float
    products: List[Any]
    total_products: int


class RecommendationsResponse(BaseModel):
    source_product_id: int
    source_product_name: str
    items: List[Any]
    total: int


class ProductAvailabilityResponse(BaseModel):
    product_id: int
    canonical_id: Optional[int] = None
    platforms: List[Any] = Field(default_factory=list)
    overall_status: str
    last_checked_at: Optional[datetime] = None
    is_stale: bool = False


class BulkAvailabilityRequest(BaseModel):
    product_ids: List[int] = Field(..., min_length=1, max_length=100, description="List of product IDs to check (1-100)")


class BulkAvailabilityResponse(BaseModel):
    results: List[Any]
    total: int
    available: int
    unavailable: int


class BulkLookupRequest(BaseModel):
    identifiers: List[str] = Field(..., min_length=1, max_length=100, description="List of SKU, UPC, or product URL to look up (max 100)")


class ProductStockResponse(BaseModel):
    id: int
    stock_level: str
    quantity: Optional[int] = None
    in_stock: bool
    last_checked: Optional[datetime] = None


class ProductURLAvailabilityResponse(BaseModel):
    url: str
    is_available: bool
    status_code: Optional[int] = None
    response_time_ms: Optional[int] = None
    checked_at: datetime


class PriceComparisonItem(BaseModel):
    id: int
    source: str
    merchant_id: str
    name: str
    description: Optional[str] = None
    price: Decimal
    currency: str
    shipping_cost: Optional[Decimal] = None
    total_cost: Optional[Decimal] = None
    buy_url: str
    affiliate_url: Optional[str] = None
    image_url: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    category_path: Optional[List[str]] = None
    is_available: bool
    metadata: Optional[Any] = None
    updated_at: datetime
    match_score: Optional[float] = None

    model_config = {"from_attributes": True}


class PriceComparisonResponse(BaseModel):
    source_product_id: int
    source_product_name: str
    items: List[Any]
    total: int
    cheapest_product_id: Optional[int] = None
    fastest_delivery_product_id: Optional[int] = None
    best_rated_product_id: Optional[int] = None


class MerchantSummary(BaseModel):
    merchant_id: str = Field(..., description="Unique merchant identifier")
    merchant_name: str = Field(..., description="Merchant/store name")
    platform: str = Field(..., description="Source platform (e.g. shopee_sg, lazada_sg)")
    product_count: int = Field(..., description="Number of active products from this merchant")
    categories: List[str] = Field(default_factory=list, description="Distinct product categories from this merchant")
    avg_rating: Optional[float] = Field(None, description="Average product rating across merchant's products (0-5 scale)")
    last_scraped_at: Optional[datetime] = Field(None, description="Timestamp of most recently scraped product from this merchant")


class MerchantListResponse(BaseModel):
    merchants: List[MerchantSummary]
    total: int
    limit: int
    offset: int
    has_more: bool = False


class BulkLookupMatch(BaseModel):
    id: int
    sku: str
    source: str
    merchant_id: str
    name: str
    price: Decimal
    currency: str
    buy_url: str
    is_available: bool
    updated_at: datetime
    match_score: Optional[float] = None

    model_config = {"from_attributes": True}


class BulkLookupResultItem(BaseModel):
    identifier: str = Field(..., description="The identifier that was looked up")
    identifier_type: str = Field(..., description="Type: 'sku', 'upc', or 'url'")
    status: str = Field(..., description="Result status: 'found', 'not_found', or 'multiple'")
    match: Optional[BulkLookupMatch] = Field(None, description="Match details if found")
    match_count: int = Field(default=0, description="Number of matches found (0 if not found, >1 if multiple)")

    model_config = {"from_attributes": True}


class BulkLookupResponse(BaseModel):
    results: List[Any]
    total: int
    found: int
    not_found: int
    multiple: int


class BatchProductRequest(BaseModel):
    product_ids: List[int] = Field(..., min_length=1, max_length=100, description="List of product IDs to look up (max 100)")


class BatchProductResponse(BaseModel):
    products: List[ProductResponse]
    total: int
    found: int
    not_found: int


class BulkIdsRequest(BaseModel):
    ids: List[int] = Field(..., min_length=1, max_length=100, description="List of product IDs to look up (max 100)")


class BulkIdsResponse(BaseModel):
    products: List[ProductResponse]
    total: int
    found: int
    not_found: int


class ProductReviewsResponse(BaseModel):
    product_id: int
    reviews: List[Any]
    total: int


class BrandListResponse(BaseModel):
    brands: List[Any]
    total: int


class ReviewSource(BaseModel):
    source: str = Field(..., description="Source of the review (e.g. 'shopee', 'lazada', 'platform_api')")
    review_count: Optional[int] = Field(None, description="Number of reviews from this source")
    avg_rating: Optional[float] = Field(None, description="Average rating from this source (0-5)")
    last_scraped: Optional[datetime] = Field(None, description="When this review data was last scraped")

    model_config = {"from_attributes": True}


class SourceListResponse(BaseModel):
    sources: List[Any]
    total: int


class BulkImportRequest(BaseModel):
    source: str = Field(..., description="Source platform (e.g., merchant_own, shopee_sg)")
    products: List[Any] = Field(..., min_length=1, max_length=1000, description="Products to import")


class BulkImportResponse(BaseModel):
    imported: int
    failed: int
    errors: List[Any]


class BulkImportError(BaseModel):
    index: int = Field(..., description="Index of the failed product in the input list")
    sku: str = Field(..., description="SKU of the product that failed")
    error: str = Field(..., description="Human-readable error message")
    code: str = Field(default="UNKNOWN_ERROR", description="Machine-readable error code")

    model_config = {"from_attributes": True}


class CatalogStats(BaseModel):
    total_products: int = Field(..., description="Total number of active products in catalog")
    by_source: Dict[str, int] = Field(..., description="Product count per source platform")
    by_category: Dict[str, int] = Field(..., description="Product count per category")
    avg_price: Optional[float] = Field(None, description="Average price across all products (in SGD)")
    min_price: Optional[float] = Field(None, description="Minimum product price (in SGD)")
    max_price: Optional[float] = Field(None, description="Maximum product price (in SGD)")

    model_config = {"from_attributes": True}


class SampleReview(BaseModel):
    id: int
    source: str
    author_name: Optional[str] = None
    rating: str
    title: Optional[str] = None
    content: Optional[str] = None
    verified_purchase: bool
    helpfulness_votes: int = 0
    review_url: Optional[str] = None
    review_date: Optional[datetime] = None
    scraped_at: datetime

    model_config = {"from_attributes": True}


class QuestionResponse(BaseModel):
    id: int
    product_id: int
    question: str
    asked_by: str
    asked_at: datetime
    is_answered: bool
    answer: Optional[str] = None
    answered_at: Optional[datetime] = None
    answered_by: Optional[str] = None


class AnswerResponse(BaseModel):
    id: int
    question_id: int
    answer: str
    answered_by: str
    answered_at: datetime


class QuestionDetailResponse(BaseModel):
    id: int
    product_id: int
    question: str
    asked_by: str
    asked_at: datetime
    answer: Optional[str] = None
    answered_by: Optional[str] = None
    answered_at: Optional[datetime] = None
    is_helpful: int
    not_helpful: int


class QuestionListResponse(BaseModel):
    questions: List[QuestionResponse]
    total: int
    page: int
    page_size: int


# V2 Agent-Optimized Schemas
class V2ProductResponse(BaseModel):
    id: int
    sku: str
    source: str
    merchant_id: str
    name: str
    description: Optional[str] = None
    price: Decimal
    currency: str
    price_sgd: Optional[Decimal] = None
    region: str = Field("sg", description="Geographic region (e.g. sg, us, sea, eu, au)")
    country_code: str = Field("SG", description="ISO 3166-1 alpha-2 country code")
    buy_url: str
    affiliate_url: Optional[str] = None
    image_url: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    category_path: Optional[List[str]] = None
    rating: Optional[Decimal] = None
    review_count: Optional[int] = None
    is_available: bool = True
    in_stock: Optional[bool] = None
    stock_level: Optional[str] = None
    last_checked: Optional[datetime] = None
    data_updated_at: Optional[datetime] = Field(None, description="Timestamp when product data was last updated")
    availability_prediction: Optional[str] = Field(None, description="Predicted availability based on historical patterns (e.g., 'likely_in_stock', 'likely_out_of_stock')")
    competitor_count: Optional[int] = Field(None, description="Number of platforms selling the same product")
    specs: Optional[Dict[str, Any]] = Field(None, description="Product specifications as key-value pairs for comparison (e.g. {color: 'Black', storage: '256GB'})")
    metadata: Optional[dict] = None
    updated_at: datetime
    price_trend: Optional[str] = None
    confidence_score: Optional[float] = Field(None, description="Confidence score of search match (0-1)")
    data_freshness: Optional[str] = Field(None, description="Data freshness indicator (e.g., 'fresh', 'stale', 'very_stale')")

    model_config = {"from_attributes": True}


class V2BatchProductResponse(BaseModel):
    """Optimized batch response for agent decision-making with minimal required fields"""
    products: List[Any]
    total: int
    found: int
    not_found: int
    # Agent-specific metadata
    cache_hit_rate: Optional[float] = None
    query_time_ms: Optional[float] = None

    model_config = {"from_attributes": True}


class QuestionCreateRequest(BaseModel):
    question: str = Field(..., min_length=10, max_length=1000, description="The question text")
    author_id: Optional[str] = Field(None, description="ID of the asking agent or user")


class AnswerCreateRequest(BaseModel):
    answer: str = Field(..., min_length=5, max_length=5000, description="The answer text")
    author_id: Optional[str] = Field(None, description="ID of the answering agent or user")


class V2ProductListResponse(BaseModel):
    total: int
    limit: int
    offset: Optional[int] = None
    items: List[V2ProductResponse]
    has_more: bool = False
    next_cursor: Optional[str] = None


class BulkProductItem(BaseModel):
    platform_id: str = Field(..., description="Platform-specific product ID (unique within platform)")
    platform: str = Field(..., description="Source platform (e.g., shopee_sg, lazada_sg)")
    sku: Optional[str] = Field(None, description="SKU within the retailer's system")
    merchant_id: str = Field(..., description="Merchant/platform shop identifier")
    title: str = Field(..., description="Product title/name")
    description: Optional[str] = Field(None, description="Product description")
    price: Decimal = Field(..., description="Product price")
    currency: str = Field(default="SGD", description="ISO 4217 currency code")
    region: Optional[str] = Field(default="sg", description="Geographic region: sg, my, th, ph, vn, id, us, eu, etc.")
    country_code: Optional[str] = Field(default="SG", description="ISO 3166-1 alpha-2 country code")
    url: str = Field(..., description="Direct product URL")
    image_url: Optional[str] = Field(None, description="Product image URL")
    category: Optional[str] = Field(None, description="Primary category")
    category_path: Optional[List[str]] = Field(None, description="Category hierarchy")
    brand: Optional[str] = Field(None, description="Brand name")
    is_active: bool = Field(default=True, description="Whether product is active/listed")
    is_available: Optional[bool] = Field(None, description="Whether product is in stock and available")
    in_stock: Optional[bool] = Field(None, description="Whether product is currently in stock")
    stock_level: Optional[str] = Field(None, description="Stock level: low, medium, or high")
    rating: Optional[Decimal] = Field(None, description="Product rating (0-5)")
    review_count: Optional[int] = Field(None, description="Number of reviews")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional product metadata")

    model_config = {"extra": "allow"}


class BulkProductRequest(BaseModel):
    products: List[BulkProductItem] = Field(..., min_length=1, max_length=500, description="Products to upsert (max 500)")


class BulkUpsertResult(BaseModel):
    platform_id: str
    platform: str
    status: str = Field(..., description="Status: inserted, updated, failed")
    product_id: Optional[int] = Field(None, description="Database product ID if successful")
    error: Optional[str] = Field(None, description="Error message if failed")


class BulkProductResponse(BaseModel):
    total: int = Field(..., description="Total products in request")
    success_count: int = Field(..., description="Number of successful upserts")
    failure_count: int = Field(..., description="Number of failed upserts")
    results: List[BulkUpsertResult] = Field(default_factory=list, description="Individual upsert results")
