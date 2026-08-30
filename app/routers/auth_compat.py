"""Backward-compatible /v1/auth/register endpoint.

The original Node.js Express API served POST /v1/auth/register for headless
agent self-registration.  After migrating to FastAPI the canonical endpoint
became POST /v1/developers/signup.  This module provides a thin adapter so
that callers using the old contract still work on launch day.

This compat route is intentionally minimal — deprecate once docs and
website CTAs point to /v1/developers/signup.
"""

import re
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.auth import provision_api_key
from app.cache import get_redis
from app.database import get_db
from app.models.product import Developer
from app.rate_limit import limiter

router = APIRouter(prefix="/auth", tags=["auth-compat"])

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")

RATE_LIMIT = 5
RATE_WINDOW = 3600


class LegacyRegisterRequest(BaseModel):
    agent_name: str
    contact: Optional[str] = None
    use_case: Optional[str] = None
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _check_rate_limit(ip: str) -> tuple[bool, int]:
    try:
        redis = await get_redis()
        key = f"reglimit:auth_register:{ip}"
        now = time.time()
        window_start = now - RATE_WINDOW

        pipe = redis.pipeline()
        pipe.zremrangebyscore(key, 0, window_start)
        pipe.zadd(key, {str(now): now})
        pipe.zcard(key)
        pipe.expire(key, RATE_WINDOW)
        results = await pipe.execute()

        count = results[2]
        ttl = await redis.ttl(key)
        return count <= RATE_LIMIT, ttl
    except Exception:
        # Fail open when Redis is unavailable
        return True, 0


@router.post("/register", status_code=201, summary="Legacy agent self-registration (compat)")
@limiter.limit("5/hour")
async def legacy_register(
    request: Request,
    body: LegacyRegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    """Backward-compatible registration endpoint.

    Accepts the old Node.js request shape and returns the old response shape
    while delegating to the same key-provisioning logic as /v1/developers/signup.
    """
    client_ip = _get_client_ip(request)
    allowed, ttl = await _check_rate_limit(client_ip)
    if not allowed:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={
                "error": {
                    "code": "RATE_LIMIT_EXCEEDED",
                    "message": "Too many registration attempts. Maximum 5 per hour.",
                    "details": {"retry_after": ttl},
                }
            },
            headers={"Retry-After": str(ttl)},
        )

    agent_name = body.agent_name.strip()[:200]
    if not agent_name:
        return JSONResponse(
            status_code=400,
            content={"error": "agent_name is required"},
        )

    # Derive email: use contact if it looks like an email, otherwise synthesise
    email = None
    if body.contact and EMAIL_REGEX.match(body.contact):
        email = body.contact.lower()
    else:
        slug = re.sub(r"[^a-z0-9]+", "-", agent_name.lower()).strip("-")[:60]
        email = f"{slug}@agent.buywhere.ai"

    # Ensure developer record exists
    from sqlalchemy import select
    from app.models.product import Developer

    result = await db.execute(select(Developer).where(Developer.email == email))
    developer = result.scalar_one_or_none()

    if developer:
        developer_id = str(developer.id)
    else:
        developer_id = str(uuid.uuid4())
        developer = Developer(id=developer_id, email=email, plan="free")
        db.add(developer)

    raw_key, new_key = await provision_api_key(
        developer_id=developer_id,
        name=agent_name,
        tier="basic",
        db=db,
    )

    return {
        "api_key": raw_key,
        "tier": "free",
        "rate_limit": {"rpm": 60, "daily": 1000},
        "docs": "https://api.buywhere.ai/docs",
    }
