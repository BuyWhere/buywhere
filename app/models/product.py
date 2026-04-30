from sqlalchemy import (
    BigInteger, Boolean, Column, Date, DateTime, Numeric, String, Text,
    func, UniqueConstraint, Integer, ARRAY, Index
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from app.database import Base


class Merchant(Base):
    __tablename__ = "merchants"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    source = Column(String, nullable=False)
    country = Column(String(2), nullable=False, default="SG")
    domain = Column(Text, nullable=True)
    scraping_policy = Column(JSONB, nullable=True)
    contact_email = Column(Text, nullable=True)
    contact_phone = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    scraping_priority = Column(Text, nullable=True)
    proxy_config = Column(JSONB, nullable=True)
    last_scraped_at = Column(DateTime(timezone=True), nullable=True)
    scrape_error = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Product(Base):
    __tablename__ = "products"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    canonical_id = Column(BigInteger, nullable=True, index=True)
    sku = Column(Text, nullable=False)
    source = Column(Text, nullable=False)
    merchant_id = Column(Text, nullable=False)
    title = Column(Text, nullable=False)
    description = Column(Text)
    price = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(3), nullable=False, default="SGD")
    price_sgd = Column(Numeric(12, 2), nullable=True)
    region = Column(String(10), nullable=False, default="sg", server_default="sg")
    country_code = Column(String(2), nullable=False, default="SG", server_default="SG")
    url = Column(Text, nullable=False)
    brand = Column(Text)
    category = Column(Text)
    category_path = Column(ARRAY(Text))
    image_url = Column(Text)
    barcode = Column(Text, nullable=True, index=True)
    is_active = Column(Boolean, nullable=False, default=True)
    is_available = Column(Boolean, nullable=False, default=True)
    in_stock = Column(Boolean, nullable=True, default=True)
    stock_level = Column(String(10), nullable=True)
    last_checked = Column(DateTime(timezone=True), nullable=True)
    data_updated_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now(), onupdate=func.now())
    rating = Column(Numeric(3, 2), nullable=True)
    review_count = Column(Integer, nullable=True)
    avg_rating = Column(Numeric(3, 2), nullable=True)
    rating_source = Column(Text, nullable=True)
    metadata_ = Column("metadata", JSONB)
    specs = Column(JSONB, nullable=True)
    title_search_vector = Column(TSVECTOR)
    search_vector = Column(TSVECTOR)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("sku", "source", name="products_sku_source_unique"),
        Index("idx_products_canonical", "canonical_id"),
        Index("idx_products_is_active", "is_active"),
        Index("idx_products_source", "source"),
        Index("idx_products_url", "url"),
        Index("idx_products_title", "title"),
        Index("idx_products_price", "price"),
        Index("idx_products_price_sgd", "price_sgd"),
        Index("idx_products_merchant_id", "merchant_id"),
        Index("idx_products_brand", "brand"),
        Index("idx_products_barcode", "barcode"),
        Index("idx_products_in_stock", "in_stock"),
        Index("idx_products_stock_level", "stock_level"),
        Index("idx_products_active_source_updated", "is_active", "source", "updated_at"),
        Index("idx_products_active_price", "is_active", "price"),
        Index("idx_products_active_category", "is_active", "category"),
        Index("idx_products_active_source_price", "is_active", "source", "price"),
        Index("idx_products_active_source_available", "is_active", "source", "is_available"),
        Index("idx_products_active_price_available", "is_active", "price", "is_available"),
        # GEO/region indexes for multi-region catalog support
        Index("idx_products_region", "region"),
        Index("idx_products_country_code", "country_code"),
        Index("idx_products_active_region", "is_active", "region"),
        Index("idx_products_active_region_price", "is_active", "region", "price"),
        Index("idx_products_active_region_category", "is_active", "region", "category"),
        Index("idx_products_active_region_available", "is_active", "region", "is_available"),
        Index("idx_products_active_source_region", "is_active", "source", "region"),
        # Composite indexes for agent-native API performance - optimize common query patterns
        Index("idx_products_title_search", "title_search_vector"),
        Index("idx_products_search_vector", "search_vector"),
    )


class IngestionRun(Base):
    __tablename__ = "ingestion_runs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    source = Column(Text, nullable=False)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at = Column(DateTime(timezone=True))
    rows_inserted = Column(Integer)
    rows_updated = Column(Integer)
    rows_failed = Column(Integer)
    status = Column(Text, nullable=False, default="running")
    error_message = Column(Text)


class ScraperAssignment(Base):
    __tablename__ = "scraper_assignments"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    platform = Column(Text, nullable=False, unique=True)
    agent_id = Column(Text, nullable=False)
    priority = Column(Text, nullable=False, default="medium")
    interval_hours = Column(Integer, nullable=False, default=6)
    is_active = Column(Boolean, nullable=False, default=True)
    assigned_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_heartbeat = Column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_scraper_assignments_platform", "platform"),
        Index("idx_scraper_assignments_agent_id", "agent_id"),
    )


class ScraperAlertConfig(Base):
    __tablename__ = "scraper_alert_configs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    source = Column(Text, nullable=True)
    alert_type = Column(Text, nullable=False)
    threshold_hours = Column(Integer, nullable=False, default=24)
    webhook_url = Column(Text, nullable=True)
    email = Column(Text, nullable=True)
    is_enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_alert_configs_source", "source"),
        Index("idx_alert_configs_enabled", "is_enabled"),
    )


class ScraperAlertLog(Base):
    __tablename__ = "scraper_alert_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    source = Column(Text, nullable=False)
    alert_type = Column(Text, nullable=False)
    message = Column(Text, nullable=False)
    severity = Column(Text, nullable=False, default="warning")
    rows_inserted = Column(Integer, nullable=True)
    rows_updated = Column(Integer, nullable=True)
    rows_failed = Column(Integer, nullable=True)
    is_sent = Column(Boolean, nullable=False, default=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_alert_logs_source", "source"),
        Index("idx_alert_logs_created", "created_at"),
        Index("idx_alert_logs_severity", "severity"),
    )


class CatalogGrowthSnapshot(Base):
    __tablename__ = "catalog_growth_snapshots"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    total_products = Column(Integer, nullable=False)
    source = Column(Text, nullable=True)
    snapshot_date = Column(Date, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("source", "snapshot_date", name="growth_snapshots_unique"),
        Index("idx_growth_snapshots_date", "snapshot_date"),
    )


class ProductDataFreshness(Base):
    __tablename__ = "product_data_freshness"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    source = Column(Text, nullable=False)
    product_count = Column(Integer, nullable=False)
    snapshot_time = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("source", "snapshot_time", name="uq_product_data_freshness_source_time"),
        Index("idx_product_data_freshness_source", "source"),
        Index("idx_product_data_freshness_time", "snapshot_time"),
    )


class Developer(Base):
    __tablename__ = "developers"

    id = Column(String, primary_key=True)
    email = Column(String, nullable=False, unique=True)
    plan = Column(String, nullable=False, default="free")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(String, primary_key=True)
    key_hash = Column(String, nullable=False, unique=True)
    developer_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    tier = Column(String, nullable=False, default="basic")
    role = Column(String, nullable=True, server_default="developer")
    is_active = Column(Boolean, nullable=False, default=True)
    rate_limit = Column(Integer, nullable=True)
    allowed_origins = Column(JSONB, nullable=True)
    rotated_from_key_id = Column(String, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    request_count = Column(BigInteger, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_used_at = Column(DateTime(timezone=True))
    signup_channel = Column(String, nullable=True, server_default=None)

    __table_args__ = (
        Index("idx_api_keys_developer_id", "developer_id"),
        Index("idx_api_keys_signup_channel_name", "signup_channel", "name"),
    )


class PriceHistory(Base):
    __tablename__ = "price_history"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    product_id = Column(BigInteger, nullable=False)
    price = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(3), nullable=False, default="SGD")
    source = Column(Text, nullable=False)
    recorded_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_price_history_product_recorded", "product_id", "recorded_at"),
        UniqueConstraint("product_id", "source", "recorded_at", name="price_history_product_source_unique"),
    )


class Click(Base):
    __tablename__ = "clicks"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    tracking_id = Column(Text, nullable=False, unique=True)
    product_id = Column(BigInteger, nullable=False)
    platform = Column(Text, nullable=False)
    destination_url = Column(Text, nullable=False)
    api_key_id = Column(Text, nullable=True)
    agent_id = Column(Text, nullable=True, index=True)
    user_agent = Column(Text, nullable=True)
    referrer = Column(Text, nullable=True)
    clicked_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_clicks_tracking_id", "tracking_id"),
        Index("idx_clicks_product_id", "product_id"),
        Index("idx_clicks_clicked_at", "clicked_at"),
        Index("idx_clicks_agent_id", "agent_id"),
    )


class ProductView(Base):
    __tablename__ = "product_views"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    product_id = Column(BigInteger, nullable=False)
    source = Column(Text, nullable=False)
    query_hash = Column(Text, nullable=True)
    viewed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_product_views_product_id", "product_id"),
        Index("idx_product_views_viewed_at", "viewed_at"),
        Index("idx_product_views_product_viewed", "product_id", "viewed_at"),
    )


class ImageHash(Base):
    __tablename__ = "image_hashes"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    hash = Column(Text, nullable=False, unique=True, index=True)
    original_url = Column(Text, nullable=False)
    content_type = Column(Text, nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    file_size = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_image_hashes_hash", "hash"),
    )


class ProductMatch(Base):
    __tablename__ = "product_matches"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    source_product_id = Column(BigInteger, nullable=False, index=True)
    matched_product_id = Column(BigInteger, nullable=False, index=True)
    confidence_score = Column(Numeric(5, 4), nullable=False)
    match_method = Column(Text, nullable=False)
    name_similarity = Column(Numeric(5, 4), nullable=True)
    image_similarity = Column(Numeric(5, 4), nullable=True)
    price_diff_pct = Column(Numeric(8, 4), nullable=True)
    source = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("source_product_id", "matched_product_id", "source", name="product_matches_unique"),
        Index("idx_product_matches_source_product", "source_product_id"),
        Index("idx_product_matches_matched_product", "matched_product_id"),
        Index("idx_product_matches_confidence", "confidence_score"),
    )


class DataQualityMetrics(Base):
    __tablename__ = "data_quality_metrics"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    snapshot_date = Column(Date, nullable=False, index=True)
    total_products = Column(Integer, nullable=False)
    products_with_image_pct = Column(Numeric(5, 2), nullable=False)
    products_with_description_pct = Column(Numeric(5, 2), nullable=False)
    products_with_price_pct = Column(Numeric(5, 2), nullable=False)
    products_with_brand_pct = Column(Numeric(5, 2), nullable=False)
    overall_quality_score = Column(Numeric(5, 2), nullable=False)
    per_platform_scores = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("snapshot_date", name="data_quality_metrics_date_unique"),
    )


class UsageRecord(Base):
    __tablename__ = "usage_records"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    api_key_id = Column(String, nullable=False)
    date = Column(Date, nullable=False)
    request_count = Column(BigInteger, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("api_key_id", "date", name="usage_records_unique_key_date"),
        Index("idx_usage_records_api_key_id", "api_key_id"),
        Index("idx_usage_records_date", "date"),
        Index("idx_usage_records_api_key_date", "api_key_id", "date"),
    )


class ProductReview(Base):
    __tablename__ = "reviews"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    product_id = Column(BigInteger, nullable=False, index=True)
    source = Column(Text, nullable=False)
    author_name = Column(Text, nullable=True)
    author_id = Column(Text, nullable=True)
    rating = Column(Numeric(2, 1), nullable=False)
    title = Column(Text, nullable=True)
    content = Column(Text, nullable=True)
    verified_purchase = Column(Boolean, nullable=False, default=False)
    helpfulness_votes = Column(Integer, nullable=False, default=0)
    review_url = Column(Text, nullable=True)
    review_date = Column(DateTime(timezone=True), nullable=True)
    scraped_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_reviews_product_id", "product_id"),
        Index("idx_reviews_source", "source"),
        Index("idx_reviews_rating", "rating"),
        Index("idx_reviews_review_date", "review_date"),
        Index("idx_reviews_product_source", "product_id", "source"),
    )


class ProductQuestion(Base):
    __tablename__ = "product_questions"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    product_id = Column(BigInteger, nullable=False, index=True)
    author_id = Column(Text, nullable=True)
    author_type = Column(Text, nullable=False, default="agent")
    question = Column(Text, nullable=False)
    answer_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_questions_product_id", "product_id"),
        Index("idx_questions_author_id", "author_id"),
        Index("idx_questions_created_at", "created_at"),
    )


class ProductAnswer(Base):
    __tablename__ = "product_answers"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    question_id = Column(BigInteger, nullable=False, index=True)
    product_id = Column(BigInteger, nullable=False, index=True)
    author_id = Column(Text, nullable=True)
    author_type = Column(Text, nullable=False, default="agent")
    answer = Column(Text, nullable=False)
    is_accepted = Column(Boolean, nullable=False, default=False)
    helpfulness_votes = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_answers_question_id", "question_id"),
        Index("idx_answers_product_id", "product_id"),
        Index("idx_answers_author_id", "author_id"),
        Index("idx_answers_is_accepted", "is_accepted"),
        Index("idx_answers_helpfulness_votes", "helpfulness_votes"),
    )


class ComparisonPage(Base):
    __tablename__ = "comparison_pages"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    slug = Column(Text, nullable=False, unique=True)
    category = Column(Text, nullable=False, default="general")
    status = Column(Text, nullable=False, default="draft")
    product_ids = Column(ARRAY(BigInteger), nullable=False, default=list)
    expert_summary = Column(Text, nullable=True)
    hero_image_url = Column(Text, nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

class ApiKeyAuditLog(Base):
    __tablename__ = "api_key_audit_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    api_key_id = Column(Text, nullable=False, index=True)
    action = Column(Text, nullable=False)
    detail = Column(Text, nullable=True)
    ip_address = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
