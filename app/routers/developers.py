import json
import re
import time
import uuid
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_api_key, provision_api_key
from app.cache import get_redis
from app.database import get_db
from app.models.product import ApiKey, Developer
from app.rate_limit import limiter
from app.request_logging import LOG_FILE
from app.schemas.product import (
    DeveloperSignupRequest, DeveloperSignupResponse,
    DeveloperMeResponse, DeveloperResponse, ApiKeyResponse,
    DeveloperUsageResponse, UsageStats, EndpointUsage,
)
from app.services import growth
from app.services.analytics import post_hog
from app.services.analytics.ga4 import track_signup_complete as track_ga4_signup

router = APIRouter(prefix="/developers", tags=["developers"])

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


def is_valid_email(email: str) -> bool:
    return EMAIL_REGEX.match(email) is not None


REGISTRATION_RATE_LIMIT = 5
REGISTRATION_RATE_WINDOW = 3600


async def _check_redis_rate_limit(ip: str) -> tuple[bool, int, int]:
    redis = await get_redis()
    key = f"reglimit:signup:{ip}"
    now = time.time()
    window_start = now - REGISTRATION_RATE_WINDOW
    
    pipe = redis.pipeline()
    pipe.zremrangebyscore(key, 0, window_start)
    pipe.zadd(key, {str(now): now})
    pipe.zcard(key)
    pipe.expire(key, REGISTRATION_RATE_WINDOW)
    results = await pipe.execute()
    
    count = results[2]
    remaining = max(0, REGISTRATION_RATE_LIMIT - count)
    ttl = await redis.ttl(key)
    
    return count <= REGISTRATION_RATE_LIMIT, remaining, ttl


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/signup", response_model=DeveloperSignupResponse, summary="Developer self-service signup")
@limiter.limit("5/hour")
async def developer_signup(
    request: Request,
    body: DeveloperSignupRequest,
    db: AsyncSession = Depends(get_db),
) -> Response:
    client_ip = _get_client_ip(request)
    
    allowed, remaining, ttl = await _check_redis_rate_limit(client_ip)
    if not allowed:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={
                "error": {
                    "code": "RATE_LIMIT_EXCEEDED",
                    "message": "Too many registration attempts from this IP. Maximum 5 per hour.",
                    "details": {"retry_after": ttl}
                }
            },
            headers={"Retry-After": str(ttl), "X-RateLimit-Remaining": "0"}
        )
    
    if not is_valid_email(body.email):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid email format",
        )

    existing_developer = await db.execute(
        select(Developer).where(Developer.email == body.email.lower())
    )
    developer = existing_developer.scalar_one_or_none()
    
    if developer:
        existing_key = await db.execute(
            select(ApiKey).where(
                ApiKey.developer_id == developer.id,
                ApiKey.name == body.name,
                ApiKey.is_active == True,
            )
        )
        existing_key_record = existing_key.scalar_one_or_none()
        
        if existing_key_record:
            return DeveloperSignupResponse(
                developer_id=str(developer.id),
                email=body.email.lower(),
                plan=str(developer.plan),
                key_id=str(existing_key_record.id),
                raw_key=None,
                name=body.name,
                tier=str(existing_key_record.tier),
                message=f"An active API key with name '{body.name}' already exists for this email. Use the existing key or choose a different name.",
            )
        
        developer_id = str(developer.id)
    else:
        developer_id = str(uuid.uuid4())
        developer = Developer(
            id=developer_id,
            email=body.email.lower(),
            plan="free",
        )
        db.add(developer)

    raw_key, new_key = await provision_api_key(
        developer_id=developer_id,
        name=body.name,
        tier="basic",
        db=db,
    )

    # Ensure docs_vs_playground_onboarding experiment exists and is active
    await growth.get_or_create_experiment(db, "docs_vs_playground_onboarding")

    # Assign variant for docs_vs_playground_onboarding experiment
    experiment_variant = body.experiment_variant
    if not experiment_variant:
        # Assign variant using email as identifier for consistency
        variant = growth.assign_variant("docs_vs_playground_onboarding", body.email.lower())
        experiment_variant = "a" if variant == "a" else "b"
        # Record the experiment assignment
        await growth.record_experiment_assignment(
            db=db,
            experiment_name="docs_vs_playground_onboarding",
            variant=experiment_variant,
            developer_id=developer_id,
            email=body.email.lower(),
        )
    
    # Assign hn_launch_framing variant if HN traffic detected via UTM
    if body.utm_source == "hackernews" or body.utm_medium == "social":
        hn_variant = growth.assign_variant("hn_launch_framing", body.email.lower())
        await growth.record_experiment_assignment(
            db=db,
            experiment_name="hn_launch_framing",
            variant=hn_variant,
            developer_id=developer_id,
            email=body.email.lower(),
        )
    
    # Assign agent_vs_traditional_messaging variant for CTA test
    cta_variant = growth.assign_variant("agent_vs_traditional_messaging", body.email.lower())
    await growth.record_experiment_assignment(
        db=db,
        experiment_name="agent_vs_traditional_messaging",
        variant=cta_variant,
        developer_id=developer_id,
        email=body.email.lower(),
    )
    
    # Assign onboarding_email variant for email drip A/B test
    onboarding_email_variant = growth.assign_variant("onboarding_email", body.email.lower())
    await growth.record_experiment_assignment(
        db=db,
        experiment_name="onboarding_email",
        variant=onboarding_email_variant,
        developer_id=developer_id,
        email=body.email.lower(),
    )
    
    await growth.track_signup(
        db=db,
        developer_id=developer_id,
        email=body.email.lower(),
        experiment_variant=experiment_variant,
        discovery_path=body.discovery_path,
        referrer=body.referrer,
        utm_source=body.utm_source,
        utm_medium=body.utm_medium,
        utm_campaign=body.utm_campaign,
        utm_content=body.utm_content,
        utm_term=body.utm_term,
    )

    post_hog.track_signup(
        developer_id=developer_id,
        email=body.email.lower(),
        experiment_variant=body.experiment_variant,
        discovery_path=body.discovery_path,
        referrer=body.referrer,
        utm_source=body.utm_source,
        utm_medium=body.utm_medium,
        utm_campaign=body.utm_campaign,
        utm_content=body.utm_content,
        utm_term=body.utm_term,
    )

    import asyncio
    asyncio.create_task(
        track_ga4_signup(
            developer_id=developer_id,
            email=body.email.lower(),
            plan="free",
            source=body.discovery_path,
            utm_source=body.utm_source,
            utm_medium=body.utm_medium,
            utm_campaign=body.utm_campaign,
        )
    )

    await growth.schedule_email_drip(
        db=db,
        developer_id=developer_id,
        email=body.email.lower(),
        experiment_variant=onboarding_email_variant,
    )

    # Determine redirect URL based on experiment variant
    redirect_url = None
    from app.models.growth import ExperimentAssignment
    
    # Get the most recent assignment for docs_vs_playground_onboarding
    result = await db.execute(
        select(ExperimentAssignment.variant)
        .where(
            ExperimentAssignment.experiment_id == "docs_vs_playground_onboarding",
            ExperimentAssignment.developer_id == developer_id
        )
        .order_by(ExperimentAssignment.assigned_at.desc())
        .limit(1)
    )
    assigned_variant = result.scalar_one_or_none()
    
    if assigned_variant == "a":  # docs_first
        redirect_url = "/docs/quickstart"
    elif assigned_variant == "b":  # playground_first
        redirect_url = "/playground"
    
    return DeveloperSignupResponse(
        developer_id=developer_id,
        email=body.email.lower(),
        plan="free",
        key_id=str(new_key.id),
        raw_key=raw_key,
        name=str(new_key.name),
        tier=str(new_key.tier),
        message="Store this key securely — it will not be shown again. This is your first API key.",
        redirect_url=redirect_url,
    )


@router.get("/me", response_model=DeveloperMeResponse, summary="Get developer profile")
async def developer_me(
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> DeveloperMeResponse:
    """Returns developer profile and all API keys associated with this account."""
    result = await db.execute(
        select(Developer).where(Developer.id == api_key.developer_id)
    )
    developer = result.scalar_one_or_none()

    if not developer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Developer not found",
        )

    keys_result = await db.execute(
        select(ApiKey).where(
            ApiKey.developer_id == api_key.developer_id,
            ApiKey.is_active == True,
        ).order_by(ApiKey.created_at.desc())
    )
    keys = keys_result.scalars().all()

    return DeveloperMeResponse(
        developer=DeveloperResponse.model_validate(developer),
        api_keys=[ApiKeyResponse.model_validate(k) for k in keys],
        total_keys=len(keys),
    )


def _get_quota_for_tier(tier: str) -> int:
    tier_daily_quotas = {
        "free": 1000,
        "basic": 1000,
        "standard": 10000,
        "premium": 100000,
    }
    return tier_daily_quotas.get(tier, 1000)


def _parse_usage_from_logs(key_id: str) -> tuple[dict, list, float]:
    requests_today = 0
    requests_this_week = 0
    requests_this_month = 0
    total_requests = 0
    endpoint_counts: dict[str, dict] = defaultdict(lambda: {"count": 0, "total_time": 0.0})
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())
    month_start = today_start.replace(day=1)

    log_path = Path(LOG_FILE)
    if log_path.exists():
        try:
            with open(log_path, "r") as f:
                for line in f:
                    try:
                        entry = json.loads(line)
                        if entry.get("apiKeyId") != key_id:
                            continue
                        ts_str = entry.get("timestamp", "")
                        try:
                            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                        except (ValueError, TypeError):
                            continue
                        total_requests += 1
                        if ts >= month_start:
                            requests_this_month += 1
                        if ts >= week_start:
                            requests_this_week += 1
                        if ts >= today_start:
                            requests_today += 1
                        path = entry.get("path", "unknown")
                        method = entry.get("method", "GET")
                        duration = float(entry.get("durationMs", 0) or 0)
                        key = f"{method} {path}"
                        endpoint_counts[key]["count"] += 1
                        endpoint_counts[key]["total_time"] += duration
                    except (json.JSONDecodeError, KeyError, ValueError, TypeError):
                        continue
        except (FileNotFoundError, PermissionError, IOError):
            pass

    top_endpoints = []
    for endpoint, data in sorted(endpoint_counts.items(), key=lambda x: x[1]["count"], reverse=True)[:10]:
        parts = endpoint.split(" ", 1)
        method = parts[0] if len(parts) > 1 else "GET"
        path = parts[1] if len(parts) > 1 else endpoint
        avg_time = data["total_time"] / data["count"] if data["count"] > 0 else 0.0
        top_endpoints.append(EndpointUsage(
            endpoint=path,
            method=method,
            count=data["count"],
            avg_response_time_ms=round(avg_time, 2),
        ))

    avg_response_time = 0.0
    total_count = sum(d["count"] for d in endpoint_counts.values())
    total_time = sum(d["total_time"] for d in endpoint_counts.values())
    if total_count > 0:
        avg_response_time = round(total_time / total_count, 2)

    return (
        {"today": requests_today, "week": requests_this_week, "month": requests_this_month, "total": total_requests},
        top_endpoints,
        avg_response_time,
    )


@router.get("/me/usage", response_model=DeveloperUsageResponse, summary="Get detailed usage statistics for authenticated developer")
async def developer_usage(
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_current_api_key),
) -> DeveloperUsageResponse:
    """Returns detailed usage statistics for the authenticated developer and API key.
    
    Includes:
    - Requests today / this week / this month / all time
    - Quota remaining and usage percentage
    - Top 10 endpoints by request count
    - Average response time
    - Alert status (80% quota threshold)
    """
    result = await db.execute(
        select(Developer).where(Developer.id == api_key.developer_id)
    )
    developer = result.scalar_one_or_none()
    if not developer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Developer not found",
        )

    usage_data, top_endpoints, avg_response_time = _parse_usage_from_logs(str(api_key.id))
    key_tier = str(api_key.tier)
    quota_limit = _get_quota_for_tier(key_tier)
    quota_used = usage_data["month"]
    quota_remaining = max(0, quota_limit - quota_used)
    quota_used_pct = (quota_used / quota_limit * 100) if quota_limit > 0 else 0.0
    alert_triggered = quota_used_pct >= 80.0

    usage = UsageStats(
        requests_today=usage_data["today"],
        requests_this_week=usage_data["week"],
        requests_this_month=usage_data["month"],
        total_requests=usage_data["total"],
        quota_limit=quota_limit,
        quota_remaining=quota_remaining,
        quota_used_pct=round(quota_used_pct, 2),
        top_endpoints=top_endpoints,
        avg_response_time_ms=avg_response_time,
        alert_triggered=alert_triggered,
    )

    alert_config = {
        "threshold_pct": 80.0,
        "alert_triggered": alert_triggered,
        "alert_message": f"You have used {quota_used_pct:.1f}% of your daily quota." if alert_triggered else None,
    }

    return DeveloperUsageResponse(
        developer_id=str(api_key.developer_id),
        key_id=str(api_key.id),
        key_name=str(api_key.name),
        tier=key_tier,
        usage=usage,
        alert_config=alert_config,
    )