import hashlib
import os
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import httpx
from fastapi import Depends, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings
from app.database import AsyncSessionLocal, get_db
from app.models.product import ApiKey
from app.models.user import User

PAPERCLIP_API_URL = os.environ.get("PAPERCLIP_API_URL", "https://api.paperclip.ai")


async def _verify_paperclip_token_with_api(token: str) -> Optional[dict]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{PAPERCLIP_API_URL}/api/agents/me",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 200:
                return resp.json()
            return None
    except Exception:
        return None

settings = get_settings()
bearer_scheme = HTTPBearer()


def hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def _is_bcrypt_hash(h: str) -> bool:
    return h.startswith("$2b$") or h.startswith("$2a$")


def _verify_key_bcrypt(raw_key: str | bytes, hashed: str) -> bool:
    if isinstance(raw_key, bytes):
        return bcrypt.checkpw(raw_key, hashed.encode())
    return bcrypt.checkpw(raw_key.encode(), hashed.encode())


def generate_api_key() -> tuple[str, str]:
    """Returns (raw_key, key_hash). Store hash, give raw to developer."""
    raw = "bw_" + secrets.token_urlsafe(32)
    return raw, hash_key(raw)


def create_access_token(data: dict) -> str:
    return jwt.encode(data, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_user_token(user_id: str, email: str) -> tuple[str, int]:
    expires_delta = timedelta(minutes=settings.jwt_expire_minutes)
    expire = datetime.now(timezone.utc) + expires_delta
    payload = {
        "sub": user_id,
        "email": email,
        "type": "user",
        "exp": expire,
    }
    token = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    return token, settings.jwt_expire_minutes * 60


def decode_access_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = credentials.credentials
    payload = decode_access_token(token)

    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if payload.get("type") != "user":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(
        select(User).where(User.id == user_id, User.is_active == True)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


async def get_current_api_key(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> ApiKey:
    if hasattr(request.state, "api_key") and request.state.api_key is not None:
        api_key = request.state.api_key
        await db.execute(
            update(ApiKey)
            .where(ApiKey.id == api_key.id)
            .values(last_used_at=datetime.now(timezone.utc))
        )
        return api_key

    token = credentials.credentials

    paperclip_key = await upsert_paperclip_agent_key(token, db)
    if paperclip_key is not None:
        await db.execute(
            update(ApiKey)
            .where(ApiKey.id == paperclip_key.id)
            .values(last_used_at=datetime.now(timezone.utc))
        )
        return paperclip_key

    payload = decode_access_token(token)
    if payload and "key_id" in payload:
        key_id = payload["key_id"]
        result = await db.execute(
            select(ApiKey).where(ApiKey.id == key_id, ApiKey.is_active == True)
        )
        api_key = result.scalar_one_or_none()
    else:
        key_hash = hash_key(token)
        result = await db.execute(
            select(ApiKey).where(ApiKey.key_hash == key_hash, ApiKey.is_active == True)
        )
        api_key = result.scalar_one_or_none()

        if api_key is None:
            result = await db.execute(
                select(ApiKey).where(
                    ApiKey.is_active == True,
                    ApiKey.key_hash.like("$2%"),
                )
            )
            candidates = result.scalars().all()
            for candidate in candidates:
                token_bytes = token.encode("utf-8")
                if len(token_bytes) > 72:
                    token_to_verify = hashlib.sha256(token_bytes).digest()
                else:
                    token_to_verify = token_bytes
                if _verify_key_bcrypt(token_to_verify, candidate.key_hash):
                    api_key = candidate
                    break

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or revoked API key",
            headers={"WWW-Authenticate": "Bearer"},
        )

    await db.execute(
        update(ApiKey)
        .where(ApiKey.id == api_key.id)
        .values(last_used_at=datetime.now(timezone.utc))
    )

    return api_key


async def provision_api_key(
    developer_id: str,
    name: str,
    tier: str = "basic",
    db: AsyncSession = None,
    rate_limit: int = None,
    allowed_origins: list = None,
    utm_source: str = None,
    utm_medium: str = None,
    utm_campaign: str = None,
    utm_content: str = None,
    utm_term: str = None,
    signup_channel: str = None,
    is_active: bool = True,
) -> tuple[str, ApiKey]:
    """Create a new API key. Returns (raw_key, ApiKey record)."""
    raw_key, key_hash = generate_api_key()
    key_id = str(uuid.uuid4())

    api_key = ApiKey(
        id=key_id,
        key_hash=key_hash,
        developer_id=developer_id,
        name=name,
        tier=tier,
        is_active=is_active,
        rate_limit=rate_limit,
        allowed_origins=allowed_origins,
        signup_channel=signup_channel,
    )
    db.add(api_key)
    await db.flush()

    return raw_key, api_key


async def resolve_paperclip_agent_key(token: str, db: AsyncSession) -> Optional[ApiKey]:
    payload = await _verify_paperclip_token_with_api(token)
    if not payload:
        return None

    agent_id = payload.get("id") or payload.get("sub")
    if not agent_id:
        return None

    result = await db.execute(
        select(ApiKey).where(
            ApiKey.key_hash == f"paperclip:{agent_id}",
            ApiKey.is_active == True,
        )
    )
    return result.scalar_one_or_none()


async def upsert_paperclip_agent_key(token: str, db: AsyncSession) -> Optional[ApiKey]:
    payload = await _verify_paperclip_token_with_api(token)
    if not payload:
        return None

    agent_id = payload.get("id") or payload.get("sub")
    if not agent_id:
        return None

    key_hash = hashlib.sha256(agent_id.encode()).hexdigest()

    existing = await db.execute(
        select(ApiKey).where(
            ApiKey.signup_channel == "paperclip_agent",
            ApiKey.name == agent_id,
            ApiKey.is_active == True,
        )
    )
    api_key = existing.scalar_one_or_none()

    if api_key is None:
        api_key = ApiKey(
            id=str(uuid.uuid4()),
            key_hash=key_hash,
            developer_id=payload.get("company_id", ""),
            name=agent_id,
            tier="enterprise",
            is_active=True,
            rate_limit=10000,
            allowed_origins=None,
            signup_channel="paperclip_agent",
        )
        db.add(api_key)
        await db.flush()

    return api_key


async def resolve_api_key_from_token(token: str, db: AsyncSession) -> Optional[ApiKey]:
    if not token:
        return None

    payload = decode_access_token(token)
    if payload and "key_id" in payload:
        key_id = payload["key_id"]
        result = await db.execute(
            select(ApiKey).where(ApiKey.id == key_id, ApiKey.is_active == True)
        )
        return result.scalar_one_or_none()

    paperclip_key = await upsert_paperclip_agent_key(token, db)
    if paperclip_key is not None:
        return paperclip_key

    key_hash = hash_key(token)
    result = await db.execute(
        select(ApiKey).where(ApiKey.key_hash == key_hash, ApiKey.is_active == True)
    )
    api_key = result.scalar_one_or_none()

    if api_key is not None:
        return api_key

    result = await db.execute(
        select(ApiKey).where(
            ApiKey.is_active == True,
            ApiKey.key_hash.like("$2%"),
        )
    )
    candidates = result.scalars().all()
    for candidate in candidates:
        if len(token) > 72:
            token_to_verify = hashlib.sha256(token.encode()).digest()
        else:
            token_to_verify = token.encode()
        if _verify_key_bcrypt(token_to_verify, candidate.key_hash):
            return candidate

    return None


class ApiKeyContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        token: str | None = None

        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header.removeprefix("Bearer ").strip()
        else:
            x_api_key = request.headers.get("X-API-Key")
            if x_api_key:
                token = x_api_key.strip()

        if token:
            try:
                async with AsyncSessionLocal() as db:
                    api_key = await resolve_api_key_from_token(token, db)
                    if api_key is None:
                        api_key = await upsert_paperclip_agent_key(token, db)
                        if api_key is not None:
                            await db.commit()
                if api_key is not None:
                    request.state.api_key = api_key
            except Exception:
                pass

        return await call_next(request)
