from pydantic import Field
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://buywhere:buywhere@172.18.0.4:5432/buywhere"
    database_replica_url: str = ""
    pgbouncer_url: str = ""

    db_pool_size: int = 100
    db_max_overflow: int = 50
    db_pool_pre_ping: bool = True
    db_pool_recycle: int = 3600
    db_pool_timeout: int = 30

    jwt_secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    rate_limit_per_minute: int = 1000
    redis_url: str = ""
    redis_host: str = ""
    redis_port: int = 6379
    redis_password: str = ""

    # US Launch Rate Limiting Configuration
    us_rate_limit_multiplier: float = 1.5  # Higher limits for US traffic
    us_search_rate_limit: int = 150  # requests/minute for US search
    us_product_rate_limit: int = 300  # requests/minute for US product detail
    us_default_rate_limit: int = 100  # requests/minute for US default
    us_watchlist_rate_limit: int = 30  # requests/minute for US watchlist

    # Global rate limits (fallback)
    global_search_rate_limit: int = 100
    global_product_rate_limit: int = 200
    global_default_rate_limit: int = 60
    global_watchlist_rate_limit: int = 20

    # Burst/throttling configuration
    burst_allowance: int = 20  # Additional requests allowed in burst
    burst_window_seconds: int = 10  # Time window for burst allowance
    rate_limit_burst_enabled: bool = True  # Enable burst handling

    # Feature Flags
    feature_us_launch_enabled: bool = False  # Enable US launch features
    feature_us_referral_enabled: bool = False  # Enable US referral program
    feature_us_data_ingestion_enabled: bool = False  # Enable US source data ingestion

    app_version: str = "1.0.0"
    debug: bool = False
    environment: str = "production"

    public_url: str = "http://localhost:8000"
    glama_maintainer_email: str = "api@buywhere.ai"

    smtp_host: str = "localhost"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    email_from_address: str = "alerts@buywhere.ai"
    email_from_name: str = "BuyWhere"

    sendgrid_api_key: str = ""
    sendgrid_enabled: bool = False

    web_push_vapid_public_key: str = ""
    web_push_vapid_private_key: str = ""
    web_push_vapid_subject: str = "mailto:alerts@buywhere.ai"
    web_push_enabled: bool = False

    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_endpoint: str = ""
    r2_bucket: str = ""

    typesense_url: str = ""
    typesense_api_key: str = ""

    sentry_dsn: str = ""
    sentry_environment: str = "production"

    # OpenTelemetry Configuration
    otel_enabled: bool = False
    otel_exporter_otlp_endpoint: str = ""
    otel_service_name: str = "buywhere-mcp-server"

    image_cache_dir: str = "/tmp/buywhere_image_cache"
    image_thumb_width: int = 300
    image_thumb_height: int = 300
    image_full_width: int = 800
    image_full_height: int = 800

    affiliate_allowed_domains: str = "lazada.sg,shopee.sg,bestdenki.com.sg,amazon.sg,courts.com.sg,harvey-norman.com.sg,challenger.sg,qoo10.sg"

    scraper_api_key: str = Field(default="", validation_alias="SCRAPERAPI_KEY")
    scraper_refresh_url: str = Field(default="", validation_alias="SCRAPER_REFRESH_URL")
    model_config = {"env_file": ".env", "case_sensitive": False, "extra": "allow"}


@lru_cache
def get_settings() -> Settings:
    return Settings()


def build_redis_url(redis_url: str, redis_password: str) -> str:
    if not redis_url:
        settings = get_settings()
        if settings.redis_host:
            redis_url = f"redis://{settings.redis_host}:{settings.redis_port}/0"
        else:
            redis_url = "redis://redis:6379/0"
    if not redis_password:
        return redis_url
    try:
        from urllib.parse import urlparse, urlunparse
        parsed = urlparse(redis_url)
        netloc = f":{redis_password}@{parsed.hostname}"
        if parsed.port:
            netloc += f":{parsed.port}"
        return urlunparse((
            parsed.scheme,
            netloc,
            parsed.path,
            parsed.params,
            parsed.query,
            parsed.fragment
        ))
    except Exception:
        return redis_url
