from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field


class PlatformProductCount(BaseModel):
    source: str
    product_count: int
    last_updated: Optional[datetime] = None


class IngestionRunInfo(BaseModel):
    source: Optional[str] = None
    last_run_at: Optional[datetime] = None
    last_run_status: Optional[str] = None
    last_rows_inserted: Optional[int] = None
    last_rows_updated: Optional[int] = None


class CatalogStatus(BaseModel):
    total_unique_products: int
    platforms: List[PlatformProductCount]
    ingestion_runs: List[IngestionRunInfo]
    goal_million: float = 1.0
    progress_percent: float


class PlatformCompliance(BaseModel):
    source: str
    total: int
    compliant: int
    compliance_rate: float


class SchemaComplianceReport(BaseModel):
    total_products: int
    compliant_products: int
    compliance_rate: float
    by_platform: List[PlatformCompliance]
    missing_title: int
    missing_price: int
    missing_source: int
    missing_source_id: int
    missing_url: int
    incomplete_products: int


class DuplicateGroup(BaseModel):
    canonical_id: int
    product_ids: List[int]
    source_count: int
    sources: List[str]
    sample_title: str
    price_min: Decimal
    price_max: Decimal


class DeduplicationReport(BaseModel):
    total_products: int
    products_with_canonical: int
    duplicate_rate: float
    duplicate_groups: int
    sample_duplicates: List[DuplicateGroup]


class StaleProductInfo(BaseModel):
    product_id: int
    title: str
    source: str
    last_updated: datetime
    days_stale: int


class FreshnessReport(BaseModel):
    total_products: int
    stale_products: int
    stale_rate: float
    re_scrape_count: int
    by_platform: dict[str, int]
    sample_stale: List[StaleProductInfo]


class ProductCountSnapshot(BaseModel):
    source: str
    product_count: int
    snapshot_time: datetime
    hours_since: Optional[float] = None


class ProductCountTrendPoint(BaseModel):
    snapshot_time: datetime
    product_count: int
    hours_ago: Optional[float] = None


class ProductCountTrend(BaseModel):
    trend: List[ProductCountTrendPoint]
    is_stale: bool
    hours_flat: float


class StalledIngestionAlert(BaseModel):
    type: str
    source: str
    message: str
    hours_flat: float
    current_count: int
    snapshot_time: Optional[datetime] = None


class UnprocessedNdjsonFile(BaseModel):
    platform: str
    file_path: str
    file_size_mb: float
    last_modified: datetime
    hours_since_scrape: float
    last_ingestion: Optional[datetime] = None


class CatalogFreshnessMonitorReport(BaseModel):
    generated_at: datetime
    source: str
    flat_threshold_hours: int
    min_product_count_change: int
    latest_snapshot: Optional[ProductCountSnapshot] = None
    trend: ProductCountTrend
    stalled_ingestion: Optional[StalledIngestionAlert] = None
    unprocessed_ndjson_files: List[UnprocessedNdjsonFile]
    unprocessed_ndjson_count: int


class CatalogHealthReport(BaseModel):
    generated_at: datetime
    total_indexed: int
    by_platform: dict[str, int]
    compliance: SchemaComplianceReport
    deduplication: DeduplicationReport
    freshness: FreshnessReport
    freshness_monitor: Optional[CatalogFreshnessMonitorReport] = None


class ScraperHealth(BaseModel):
    source: str
    last_run_at: Optional[datetime] = None
    last_run_status: Optional[str] = None
    last_rows_inserted: Optional[int] = None
    last_rows_updated: Optional[int] = None
    last_rows_failed: Optional[int] = None
    product_count: int = 0
    is_healthy: bool = False
    hours_since_last_run: Optional[float] = None
    error_message: Optional[str] = None


class ScraperHealthReport(BaseModel):
    generated_at: datetime
    scrapers: List[ScraperHealth]
    total_scrapers: int
    healthy_count: int
    unhealthy_count: int


class CatalogStatsReport(BaseModel):
    generated_at: datetime
    total_products: int
    by_platform: dict[str, int]
    by_category: dict[str, int]


class FieldCompletenessSummary(BaseModel):
    image_url_pct: float
    description_pct: float
    price_pct: float
    brand_pct: float


class CatalogQualityOverview(BaseModel):
    total_products: int
    overall_quality_score: float
    avg_freshness_score: float
    avg_completeness_score: float
    avg_price_accuracy_score: float
    stale_products: int
    stale_rate: float
    field_completeness: FieldCompletenessSummary


class CatalogQualityAggregate(BaseModel):
    name: str
    product_count: int
    stale_products: int
    stale_rate: float
    avg_freshness_score: float
    avg_completeness_score: float
    avg_price_accuracy_score: float
    avg_overall_score: float


class CatalogQualityAggregates(BaseModel):
    by_source: list[CatalogQualityAggregate]
    by_region: list[CatalogQualityAggregate]
    by_category: list[CatalogQualityAggregate]


class CatalogQualityThresholds(BaseModel):
    stale_after_days: int
    low_quality_score: float
    price_history_lookback_days: int


class CatalogQualityProductSample(BaseModel):
    product_id: int
    source: str
    region: str
    category: str
    title: str
    url: str
    updated_at: Optional[datetime] = None
    overall_score: float
    missing_fields: list[str]


class LowQualityProductSample(CatalogQualityProductSample):
    freshness_score: float
    completeness_score: float
    price_accuracy_score: float
    is_stale: bool


class CatalogRescrapeRecommendation(BaseModel):
    name: str
    product_count: int
    stale_products: int
    stale_rate: float
    avg_freshness_score: float
    avg_completeness_score: float
    avg_price_accuracy_score: float
    avg_overall_score: float


class CatalogRescrapeSummary(BaseModel):
    count: int
    sources: list[CatalogRescrapeRecommendation]


class CatalogStaleProductSummary(BaseModel):
    count: int
    sample: list[CatalogQualityProductSample]


class CatalogQualityReport(BaseModel):
    generated_at: datetime
    snapshot_date: datetime | date
    thresholds: CatalogQualityThresholds
    overview: CatalogQualityOverview
    aggregates: CatalogQualityAggregates
    re_scrape_recommendations: CatalogRescrapeSummary
    stale_products: CatalogStaleProductSummary
    low_quality_products: list[LowQualityProductSample]


class DBConnectionHealth(BaseModel):
    ok: bool
    latency_ms: float
    error: Optional[str] = None


class DBPoolHealth(BaseModel):
    size: int
    checked_in: int
    checked_out: int
    overflow: int
    invalid: int = 0


class DBHealthReport(BaseModel):
    ok: bool
    connection: DBConnectionHealth
    pool: DBPoolHealth
    checked_at: datetime


class SystemHealthReport(BaseModel):
    generated_at: datetime
    db: DBHealthReport
    scrapers: ScraperHealthReport


class PlatformHealth(BaseModel):
    source: str
    last_scrape_at: Optional[datetime] = None
    product_count: int = 0
    avg_freshness_minutes: Optional[float] = None
    error_rate: Optional[float] = None
    is_stale: bool = False
    last_run_status: Optional[str] = None
    rows_inserted: Optional[int] = None
    rows_updated: Optional[int] = None
    rows_failed: Optional[int] = None


class PlatformHealthReport(BaseModel):
    generated_at: datetime
    platforms: List[PlatformHealth]
    total_platforms: int
    healthy_platforms: int
    stale_platforms: int
    overall_health_score: float


class DiskSpaceHealth(BaseModel):
    total_bytes: int
    used_bytes: int
    available_bytes: int
    usage_percent: float
    ok: bool


class APIResponseTimeHealth(BaseModel):
    endpoint: str
    latency_ms: float
    ok: bool


class ComprehensiveHealthReport(BaseModel):
    generated_at: datetime
    overall_status: str = Field(..., description="Overall status: healthy, degraded, or unhealthy")
    db: DBHealthReport
    disk: DiskSpaceHealth
    api_self_test: APIResponseTimeHealth
    scrapers: ScraperHealthReport


class SimpleHealthResponse(BaseModel):
    status: str = Field(..., description="Overall status: ok, degraded, or down")
    environment: str = Field(..., description="Runtime environment: development, staging, or production")
    database_connected: bool = Field(..., description="Database connection ok")
    cache_connected: bool = Field(..., description="Cache (Redis) connection ok")
    uptime_seconds: float = Field(..., description="Process uptime in seconds")
    version: str = Field(..., description="Application version")
    product_count: int = Field(..., description="Total active product count")
    last_ingestion_time: Optional[datetime] = Field(None, description="Most recent ingestion run completion time")


class DependencyHealth(BaseModel):
    ok: bool
    latency_ms: float
    error: Optional[str] = None


class DetailedHealthResponse(BaseModel):
    status: str = Field(..., description="Overall status: ok, degraded, or unhealthy")
    db: DependencyHealth
    cache: DependencyHealth
    uptime_seconds: float = Field(..., description="Process uptime in seconds")
    version: str = Field(..., description="Application version")
    product_count: int = Field(..., description="Total active product count")
    generated_at: datetime
