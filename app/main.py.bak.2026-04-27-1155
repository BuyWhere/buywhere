import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Union

from fastapi import FastAPI, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.wrappers import Limit
from slowapi.middleware import SlowAPIMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import get_settings
from app.rate_limit import limiter, TierRateLimitMiddleware, RedisPerMinuteRateLimitMiddleware
from app.request_logging import RequestLoggingMiddleware
from app.usage_metering import UsageMeteringMiddleware
from app.routers import products, categories, keys, deals, ingestion, ingest, search, status, catalog, agents, analytics, admin, developers, webhooks, metrics, alerts, images, changelog, feed, merchants, trending, export, enrichment, health, brands, watchlist, dedup, compare, billing, countries, sitemap, v2, merchant_analytics, affiliate, preferences, import_csv, saved_searches, usage, referrals, coupons, linkless_attribution, scraper_assignments, scraper_alerts, scraper_refresh, agent_native, newsletter, user_watchlist, user_alerts, users, referral_landing, push_notifications, user_notification_preferences, price_drops, growth, feature_flags, signup, stats, public_alerts, alertmanager_webhooks, auth_compat
from app import clickthrough
from app.graphql import graphql_router
from app.versioning import VersionRoutingMiddleware
from app.services.health import get_db_health, check_disk_space, check_api_self_test
from app.services.scraper_health import get_scraper_health
from app.schemas.status import ComprehensiveHealthReport, DiskSpaceHealth, APIResponseTimeHealth
from app.sentry import init_sentry, is_sentry_enabled, capture_exception_with_context, SentrySlowQueryMiddleware
from app.logging_centralized import get_logger

logger = get_logger("api-service")

settings = get_settings()

MAX_QUERY_LENGTH = 500


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.jwt_secret_key == "change-me-in-production":
        import secrets as _secrets
        settings.jwt_secret_key = _secrets.token_urlsafe(64)
        logger.warning("JWT_SECRET_KEY not set — generated ephemeral key. Set JWT_SECRET_KEY env var for persistent sessions.")
    init_sentry()
    try:
        from app.services.feature_flags_configmap import get_configmap_syncer
        get_configmap_syncer()
    except Exception:
        pass
    yield
    try:
        from app.services.feature_flags_configmap import stop_configmap_syncer
        stop_configmap_syncer()
    except Exception:
        pass


app = FastAPI(
    title="BuyWhere Catalog API",
    description=(
        "Agent-native product catalog API for AI agent commerce. "
        "Query millions of products across Southeast Asia."
    ),
    version=settings.app_version,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# CORS - allow all origins for AI agents calling from anywhere
app.add_middleware(
    __import__("fastapi.middleware.cors", fromlist=["CORSMiddleware"]).CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(RedisPerMinuteRateLimitMiddleware)
app.add_middleware(TierRateLimitMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(UsageMeteringMiddleware)

if is_sentry_enabled():
    app.add_middleware(SentrySlowQueryMiddleware)

# API versioning middleware
app.add_middleware(VersionRoutingMiddleware)

# Routers — v1 under /v1 prefix, v2 under /v2 prefix
app.include_router(products.router, prefix="/v1")
app.include_router(search.router, prefix="/v1")
app.include_router(categories.router)
app.include_router(keys.router)
app.include_router(deals.router)
app.include_router(price_drops.router)
app.include_router(coupons.router, prefix="/v1")
app.include_router(graphql_router, prefix="/api/graphql")
app.include_router(ingestion.router, prefix="/v1")
app.include_router(ingest.router, prefix="/v1")
app.include_router(status.router, prefix="/v1")
app.include_router(catalog.router, prefix="/v1")
app.include_router(merchants.router, prefix="/v1")
app.include_router(merchant_analytics.router, prefix="/v1")
app.include_router(brands.router, prefix="/v1")
app.include_router(brands.sources_router, prefix="/v1")
app.include_router(agents.router)
app.include_router(developers.router, prefix="/v1")
app.include_router(auth_compat.router, prefix="/v1")
app.include_router(analytics.router, prefix="/v1")
app.include_router(admin.router, prefix="/v1")
from app.routers.admin_comparison_pages import router as admin_comparison_pages_router
app.include_router(admin_comparison_pages_router, prefix="/v1")
app.include_router(feature_flags.router)
app.include_router(webhooks.router, prefix="/v1")
app.include_router(alertmanager_webhooks.router)
app.include_router(metrics.router, prefix="/v1")
app.include_router(alerts.router, prefix="/v1")
app.include_router(images.router, prefix="/v1")
app.include_router(changelog.router, prefix="/v1")
app.include_router(feed.router, prefix="/v1")
app.include_router(trending.router, prefix="/v1")
app.include_router(export.router, prefix="/v1")
app.include_router(enrichment.router, prefix="/v1")
app.include_router(health.router, prefix="/v1")
app.include_router(watchlist.router, prefix="/v1")
app.include_router(import_csv.router, prefix="/v1")
app.include_router(preferences.router, prefix="/v1")
app.include_router(countries.router, prefix="/v1")
app.include_router(dedup.router, prefix="/v1")
app.include_router(dedup.dedup_ingest_router, prefix="/v1")
app.include_router(compare.router, prefix="/v1")
app.include_router(affiliate.router, prefix="/v1")
app.include_router(billing.router, prefix="/v1")
app.include_router(usage.router, prefix="/v1")
app.include_router(agent_native.router)
app.include_router(sitemap.router)
app.include_router(v2.router)
app.include_router(saved_searches.router, prefix="/v1")
app.include_router(clickthrough.router)
app.include_router(referrals.router, prefix="/v1")
app.include_router(referral_landing.router)
app.include_router(linkless_attribution.router, prefix="/v1")
app.include_router(scraper_assignments.router, prefix="/v1")
app.include_router(scraper_alerts.router, prefix="/v1")
app.include_router(scraper_refresh.router, prefix="/v1")
app.include_router(newsletter.router, prefix="/v1")
app.include_router(user_watchlist.router)
app.include_router(user_alerts.router)
app.include_router(public_alerts.router)
app.include_router(users.router)
app.include_router(push_notifications.router)
app.include_router(user_notification_preferences.router)
app.include_router(growth.router)
app.include_router(signup.router)
app.include_router(stats.router)

# /health alias — monitors and Docker HEALTHCHECK use this; actual logic is at /v1/health
@app.get("/health", include_in_schema=False)
async def health_alias():
    return {"status": "ok"}


@app.head("/health", include_in_schema=False)
async def health_alias_head():
    return Response(status_code=200)


@app.get("/health/db", tags=["health"], summary="Database connection health")
async def health_db_root():
    from app.database import get_db
    from app.routers.health import health_db
    async for db in get_db():
        try:
            return await health_db(db)
        finally:
            pass


@app.get("/health/redis", tags=["health"], summary="Redis connection health")
async def health_redis_root():
    from app.routers.health import health_redis
    return await health_redis()


def error_response(code: str, message: str, details: Union[dict, list, None] = None, status_code: int = 400):
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message, "details": details or {}}},
    )


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    return response


# AI crawler / Perplexity-friendly headers on public endpoints
AI_INDEXABLE_PREFIXES = ("/products", "/categories", "/search", "/deals", "/v2/products", "/v2/search", "/api/docs", "/api/redoc", "/llms.txt")

@app.middleware("http")
async def add_ai_crawler_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if any(path.startswith(p) for p in AI_INDEXABLE_PREFIXES):
        response.headers["X-Robots-Tag"] = "ai-index"
        response.headers["Cache-Control"] = "public, max-age=3600, s-maxage=86400"
    return response


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code == 404:
        return error_response("NOT_FOUND", "The requested resource was not found", status_code=404)
    return error_response(
        f"HTTP_{exc.status_code}",
        exc.detail if hasattr(exc, "detail") else "An error occurred",
        status_code=exc.status_code,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = []
    for error in exc.errors():
        field = ".".join(str(loc) for loc in error["loc"] if loc not in ("body", "query", "path"))
        
        msg = error["msg"]
        error_type = error["type"]
        
        if error_type == "string_too_long":
            ctx = error.get("ctx", {})
            limit = ctx.get("limit_value", MAX_QUERY_LENGTH) if ctx else MAX_QUERY_LENGTH
            msg = f"String exceeds maximum length of {limit} characters"
        elif error_type == "missing":
            msg = f"Required parameter '{field}' is missing"
        elif error_type == "greater_than_equal":
            ctx = error.get("ctx", {})
            limit = ctx.get("limit_value", "") if ctx else ""
            msg = f"Value must be greater than or equal to {limit}"
        elif error_type == "less_than_equal":
            ctx = error.get("ctx", {})
            limit = ctx.get("limit_value", "") if ctx else ""
            msg = f"Value must be less than or equal to {limit}"
        elif error_type == "less_than":
            ctx = error.get("ctx", {})
            limit = ctx.get("limit_value", "") if ctx else ""
            msg = f"Value must be less than {limit}"
        elif error_type == "enum":
            ctx = error.get("ctx", {})
            expected = ctx.get("expected", []) if ctx else []
            msg = f"Invalid value. Expected one of: {', '.join(expected)}"
        
        errors.append({
            "field": field or "unknown",
            "message": msg,
            "type": error_type,
        })
    return error_response(
        "VALIDATION_ERROR",
        "Request validation failed",
        details={"errors": errors, "count": len(errors)},
        status_code=422
    )


MAX_QUERY_LENGTH = 500

COUNTRY_HEADER_PATTERNS = [
    "CF-IPCountry",
    "X-Vercel-IP-Country",
    "X-Geo-Country",
    "X-Geo-IP-Country",
]


def _get_country_from_request(request: Request) -> str:
    for header in COUNTRY_HEADER_PATTERNS:
        country = request.headers.get(header)
        if country:
            return country.upper()
    return "unknown"


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled exception: {exc}")
    
    if is_sentry_enabled():
        request_id = request.headers.get("X-Request-Id", "unknown")
        path = request.url.path
        method = request.method
        country = _get_country_from_request(request)
        
        is_p0 = isinstance(exc, (ConnectionError, TimeoutError, OSError)) or "timeout" in str(exc).lower()
        
        capture_exception_with_context(
            exc=exc,
            request_id=request_id,
            path=path,
            method=method,
            country=country,
            is_p0=is_p0,
        )
    
    return error_response("INTERNAL_ERROR", "An internal server error occurred", status_code=500)


@app.exception_handler(RateLimitExceeded)
async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    # Add retry-after information for agents to know when they can retry
    retry_after = 60  # Default fallback
    try:
        if hasattr(exc, 'limit') and exc.limit is not None:
            # Get the window size in seconds from the limit
            limit_obj = exc.limit
            if hasattr(limit_obj, 'GRANULARITY'):
                granularity = getattr(limit_obj, 'GRANULARITY', None)
                if granularity and hasattr(granularity, 'seconds'):
                    retry_after = getattr(granularity, 'seconds', 60)
                    # For safety, cap at a reasonable maximum (1 hour)
                    retry_after = min(retry_after, 3600)
    except Exception:
        # If we can't extract retry info, use default
        pass
    
    details = {"retry_after": retry_after}
    return error_response(
        "RATE_LIMIT_EXCEEDED", 
        "Rate limit exceeded", 
        details=details, 
        status_code=429
    )


@app.get("/chatgpt-openapi.json", tags=["integrations"], summary="ChatGPT-compatible OpenAPI spec for GPT Builder")
async def chatgpt_openapi():
    import json
    from pathlib import Path
    spec_path = Path(__file__).resolve().parent.parent / "chatgpt-openapi.json"
    return JSONResponse(
        content=json.loads(spec_path.read_text()),
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.get("/v1/health", response_model=ComprehensiveHealthReport, tags=["system"], summary="Comprehensive health check with dependency status")
async def health_check(request: Request):
    from app.database import AsyncSessionLocal
    from app.schemas.status import ScraperHealthReport, DBHealthReport

    async with AsyncSessionLocal() as db:
        db_health_data = await get_db_health(db)
        disk_data = await check_disk_space()
        api_self_test = await check_api_self_test(db)
        scraper_data = await get_scraper_health(db)

    db_report = DBHealthReport(**db_health_data)
    disk_report = DiskSpaceHealth(**disk_data)
    api_report = APIResponseTimeHealth(**api_self_test)
    scraper_report = ScraperHealthReport(**scraper_data)

    overall_status = "healthy"
    if not db_report.ok or not disk_report.ok or not api_report.ok:
        overall_status = "unhealthy"
    elif not scraper_report.healthy_count == scraper_report.total_scrapers:
        overall_status = "degraded"

    return ComprehensiveHealthReport(
        generated_at=datetime.now(timezone.utc),
        overall_status=overall_status,
        db=db_report,
        disk=disk_report,
        api_self_test=api_report,
        scrapers=scraper_report,
    )


@app.get("/v1", tags=["system"])
async def api_root():
    return {
        "api": "BuyWhere Catalog API",
        "version": "v1",
        "endpoints": {
            "search": "GET /v1/search",
            "search_semantic": "GET /v1/search/semantic",
            "search_filters": "GET /v1/search/filters",
            "products": "GET /v1/products",
            "best_price": "GET /v1/products/best-price",
            "compare_search": "GET /v1/products/compare?q=<query>",
            "compare_matrix": "POST /v1/products/compare",
            "compare_diff": "POST /v1/products/compare/diff",
            "trending": "GET /v1/products/trending",
            "export": "GET /v1/products/export?format=csv|json",
            "feed": "GET /v1/products/feed?updatedSince=ISO8601",
            "feed_new": "GET /v1/feed/new",
            "feed_deals": "GET /v1/feed/deals",
            "feed_changes_sse": "GET /v1/feed/changes",
            "product": "GET /v1/products/{id}",
            "price_history": "GET /v1/products/{id}/price-history",
            "price_stats": "GET /v1/products/{id}/price-stats",
            "price_comparison": "GET /v1/products/{id}/price-comparison",
            "track_click": "POST /v1/products/{id}/click",
            "similar": "GET /v1/products/{id}/similar",
            "categories": "GET /categories",
            "categories_taxonomy": "GET /categories/taxonomy",
            "categories_products": "GET /categories/{id}/products",
            "brands": "GET /v1/brands",
            "brands_products": "GET /v1/brands/{brand_name}/products",
            "countries": "GET /v1/countries",
            "sources": "GET /v1/sources",
            "deals": "GET /v1/deals",
            "deals_price_drops": "GET /v1/deals/price-drops",
            "graphql": "POST /api/graphql",
            "graphql_playground": "GET /api/graphql",
            "ingestion": "POST /v1/ingestion",
            "ingest": "POST /v1/ingest/products",
            "import_csv": "POST /v1/import/csv",
            "status": "GET /v1/status",
            "metrics": "GET /v1/metrics",
            "metrics_quality": "GET /v1/metrics/quality",
            "catalog_health": "GET /v1/catalog/health",
            "click_analytics": "GET /v1/analytics/clicks",
            "usage_analytics": "GET /v1/analytics/usage",
            "admin_stats": "GET /v1/admin/stats",
            "developer_signup": "POST /v1/developers/signup",
            "developer_me": "GET /v1/developers/me",
            "keys_create": "POST /v1/keys",
            "keys_list": "GET /v1/keys",
            "keys_revoke": "DELETE /v1/keys/{id}",
            "keys_rotate": "POST /v1/keys/{id}/rotate",
            "webhooks_create": "POST /v1/webhooks",
            "webhooks_list": "GET /v1/webhooks",
            "webhooks_delete": "DELETE /v1/webhooks/{id}",
            "webhooks_test": "POST /v1/webhooks/test",
            "alerts_create": "POST /v1/alerts",
            "alerts_list": "GET /v1/alerts",
            "alerts_delete": "DELETE /v1/alerts/{id}",
            "image_register": "POST /v1/images?url=...",
            "image_proxy": "GET /v1/images/{hash}?w=&h=&format=",
            "image_info": "GET /v1/images/{hash}/info",
            "changelog": "GET /v1/changelog",
            "billing_subscribe": "POST /v1/billing/subscribe",
            "billing_status": "GET /v1/billing/status",
            "billing_tiers": "GET /v1/billing/tiers",
            "usage": "GET /v1/usage",
            "sitemap": "GET /sitemap.xml",
            "robots": "GET /robots.txt",
        },
        "auth": "Bearer token required (API key)",
        "docs": "/api/docs",
        "versioning": "URI-based (/v1/*). Accept-Version header optional. v1 is deprecated - use v2.",
    }


@app.get("/dashboard", tags=["system"])
async def dashboard():
    from starlette.responses import FileResponse
    return FileResponse("templates/dashboard.html")

@app.get("/playground", tags=["system"])
async def playground():
    from starlette.responses import FileResponse
    return FileResponse("templates/playground.html")


@app.get("/docs", include_in_schema=False)
async def custom_swagger_ui():
    from starlette.responses import FileResponse
    return FileResponse("templates/swagger.html")


@app.get("/api/docs", include_in_schema=False)
async def api_swagger_ui():
    from starlette.responses import RedirectResponse
    return RedirectResponse(url="/docs")


@app.get("/quickstart", include_in_schema=False)
async def quickstart_redirect():
    """Redirect /quickstart to /docs/guides/mcp for clean public URL."""
    from starlette.responses import RedirectResponse
    return RedirectResponse(url="/docs/guides/mcp", status_code=301)


@app.get("/docs/guides/mcp", include_in_schema=False)
async def mcp_integration_guide():
    """MCP integration guide — canonical URL referenced in public materials (BUY-579)."""
    from starlette.responses import HTMLResponse
    api_base = getattr(settings, "app_base_url", "https://api.buywhere.ai")
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BuyWhere MCP Integration Guide</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 860px; margin: 48px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.6; }}
  h1 {{ font-size: 2rem; margin-bottom: .25em; }}
  h2 {{ font-size: 1.3rem; margin-top: 2em; border-bottom: 1px solid #e5e5e5; padding-bottom: .3em; }}
  h3 {{ font-size: 1.05rem; margin-top: 1.5em; }}
  pre {{ background: #f6f8fa; border: 1px solid #e5e5e5; border-radius: 6px; padding: 16px; overflow-x: auto; }}
  code {{ font-family: "SFMono-Regular", Consolas, monospace; font-size: .9em; }}
  p code, li code {{ background: #f6f8fa; border: 1px solid #e5e5e5; border-radius: 3px; padding: 2px 5px; }}
  table {{ border-collapse: collapse; width: 100%; margin: 1em 0; }}
  th, td {{ border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; }}
  th {{ background: #f6f8fa; }}
  .callout {{ background: #fff8e1; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 4px; margin: 1em 0; }}
  a {{ color: #0969da; }}
</style>
</head>
<body>
<h1>BuyWhere MCP Integration</h1>
<p>BuyWhere exposes its product catalog as an MCP (Model Context Protocol) server. AI agents can search, compare, and retrieve product data without writing HTTP glue code.</p>
<p><strong>Transport:</strong> HTTP (<code>POST {api_base}/mcp</code>) for remote agents. STDIO (local process) coming soon via npm.</p>

<h2>Install</h2>
<p><strong>The hosted MCP server is live.</strong> Point your MCP client directly at <code>{api_base}/mcp</code> &mdash; no local install required.</p>
<div class="callout">
  <strong>Note:</strong> The <code>buywhere-mcp</code> npm package (for STDIO / local process mode) is not yet published. Use the HTTP transport below until it is available.
</div>

<h2>Configure Claude Desktop</h2>
<p>Add to <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> (macOS) or <code>%APPDATA%\\Claude\\claude_desktop_config.json</code> (Windows):</p>
<pre><code>{{
  "mcpServers": {{
    "buywhere": {{
      "url": "{api_base}/mcp",
      "headers": {{ "Authorization": "Bearer bw_live_xxx" }}
    }}
  }}
}}</code></pre>
<p>Restart Claude Desktop. The BuyWhere tools appear automatically.</p>

<h2>Configure Cursor</h2>
<p>In <code>.cursor/mcp.json</code> in your project root (or <code>~/.cursor/mcp.json</code> globally):</p>
<pre><code>{{
  "mcpServers": {{
    "buywhere": {{
      "url": "{api_base}/mcp",
      "headers": {{ "Authorization": "Bearer bw_live_xxx" }}
    }}
  }}
}}</code></pre>

<h2>Remote HTTP Transport</h2>
<p>For agents running in cloud environments:</p>
<pre><code>POST {api_base}/mcp
Authorization: Bearer bw_live_xxx
Content-Type: application/json

{{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {{
    "name": "search_products",
    "arguments": {{ "query": "wireless headphones", "max_price": 150 }}
  }},
  "id": 1
}}</code></pre>

<h2>Available Tools</h2>
<table>
<tr><th>Tool</th><th>Description</th></tr>
<tr><td><code>search_products</code></td><td>Search catalog by keyword, category, price range, platform, country</td></tr>
<tr><td><code>get_product</code></td><td>Full product details by ID</td></tr>
<tr><td><code>compare_products</code></td><td>Side-by-side comparison of 2&ndash;5 products</td></tr>
<tr><td><code>get_deals</code></td><td>Current deals and price drops</td></tr>
<tr><td><code>list_categories</code></td><td>Browse available product categories</td></tr>
</table>

<h2>Authentication</h2>
<p>Pass your API key as a Bearer token. Get a free key at <a href="{api_base}/v1/developers/signup">{api_base}/v1/developers/signup</a>.</p>
<table>
<tr><th>Key tier</th><th>Rate limit</th><th>Use case</th></tr>
<tr><td><code>bw_free_*</code></td><td>60 req/min</td><td>Demo, testing</td></tr>
<tr><td><code>bw_live_*</code></td><td>600 req/min</td><td>Production</td></tr>
<tr><td><code>bw_partner_*</code></td><td>Unlimited</td><td>Platform data partners</td></tr>
</table>

<h2>Error Handling</h2>
<table>
<tr><th>MCP error code</th><th>Meaning</th></tr>
<tr><td><code>invalid_params</code></td><td>Missing or invalid tool arguments</td></tr>
<tr><td><code>not_found</code></td><td>Product / category not found</td></tr>
<tr><td><code>rate_limited</code></td><td>Rate limit exceeded &mdash; exponential backoff (2s &rarr; 4s &rarr; 8s)</td></tr>
<tr><td><code>unauthorized</code></td><td>Invalid or missing API key</td></tr>
<tr><td><code>internal_error</code></td><td>BuyWhere API error</td></tr>
</table>

<p style="margin-top:3em;color:#6b7280;font-size:.85em">
  <a href="{api_base}/api/openapi.json">OpenAPI spec</a> &middot;
  <a href="{api_base}/.well-known/ai-plugin.json">Plugin manifest</a> &middot;
  <a href="mailto:api@buywhere.ai">api@buywhere.ai</a>
</p>
</body>
</html>"""
    return HTMLResponse(content=html)


@app.get("/status", tags=["system"])
async def status_page():
    from starlette.responses import FileResponse
    return FileResponse("static/status.html")


@app.get("/v1/test/error", tags=["system"], summary="Test endpoint to verify Sentry error tracking")
async def test_error_endpoint():
    raise ValueError("This is a test error for Sentry verification - BUY-3002")
