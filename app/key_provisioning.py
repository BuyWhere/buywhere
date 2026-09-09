"""
API Key Provisioning Module

Self-service signup and key lifecycle: generate, validate, rotate, revoke.
Keys are hashed with bcrypt before storage.
"""

import secrets
import smtplib
import uuid
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

import bcrypt
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import cache_delete_pattern
from app.config import get_settings
from app.models.product import ApiKey, ApiKeyAuditLog, Developer

settings = get_settings()

_template_dir = Path(__file__).parent.parent.parent / "templates" / "emails" / "developer-verification"
_jinja_env = Environment(
    loader=FileSystemLoader(str(_template_dir)),
    autoescape=select_autoescape(["html", "xml"]),
    trim_blocks=True,
    lstrip_blocks=True,
)


# ---------------------------------------------------------------------------
# Hashing helpers
# ---------------------------------------------------------------------------

def _hash_key_bcrypt(raw_key: str) -> str:
    """Hash an API key with bcrypt. Returns the hash as a UTF-8 string."""
    return bcrypt.hashpw(raw_key.encode(), bcrypt.gensalt()).decode()


def _verify_key_bcrypt(raw_key: str, hashed: str) -> bool:
    """Verify a raw key against a bcrypt hash."""
    return bcrypt.checkpw(raw_key.encode(), hashed.encode())


# Legacy SHA-256 check for migrating existing keys
import hashlib

def _hash_key_sha256(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


def _is_bcrypt_hash(h: str) -> bool:
    """Detect bcrypt hashes (start with $2b$ or $2a$)."""
    return h.startswith("$2b$") or h.startswith("$2a$")


# ---------------------------------------------------------------------------
# Email verification
# ---------------------------------------------------------------------------

def _render_verification_email(email: str, verification_token: str) -> str:
    try:
        template = _jinja_env.get_template("verify_email.html")
        verification_url = f"{settings.public_url}/v1/developers/verify?token={verification_token}"
        return template.render(
            recipient_email=email,
            verification_url=verification_url,
            current_year=datetime.now(timezone.utc).year,
        )
    except Exception:
        verification_url = f"{settings.public_url}/v1/developers/verify?token={verification_token}"
        return f"""
        <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px;">
            <h1 style="color: #111827;">Verify your BuyWhere account</h1>
            <p style="color: #374151; font-size: 16px;">Click the link below to verify your email and activate your API key:</p>
            <a href="{verification_url}" style="display: inline-block; padding: 14px 32px; background-color: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600;">Verify Email</a>
            <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">Or copy this link: {verification_url}</p>
        </body>
        </html>
        """


def _send_verification_email_via_sendgrid(email: str, subject: str, html_body: str) -> tuple[bool, Optional[str]]:
    try:
        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail, Email, To, Content

        message = Mail(
            from_email=Email(settings.email_from_address),
            to_emails=To(email),
            subject=subject,
            html_content=Content("text/html", html_body),
        )

        sg = SendGridAPIClient(settings.sendgrid_api_key)
        response = sg.send(message)

        if response.status_code in (200, 201, 202):
            message_id = response.headers.get('X-Message-Id', None) if hasattr(response, 'headers') else None
            return True, message_id
        return False, None
    except Exception as e:
        return False, None


def _send_verification_email_via_smtp(email: str, subject: str, html_body: str) -> bool:
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{settings.email_from_name} <{settings.email_from_address}>"
        msg["To"] = email
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            if settings.smtp_user and settings.smtp_password:
                server.starttls()
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
        return True
    except Exception:
        return False


async def send_verification_email(email: str, verification_token: str) -> bool:
    """Send a verification email with a token link.

    Returns True if the email was sent successfully.
    """
    html_body = _render_verification_email(email, verification_token)
    subject = "Verify your BuyWhere account"

    if settings.sendgrid_enabled and settings.sendgrid_api_key:
        success, _ = _send_verification_email_via_sendgrid(email, subject, html_body)
        return success
    elif settings.smtp_host:
        return _send_verification_email_via_smtp(email, subject, html_body)

    return False


def generate_verification_token() -> str:
    """Generate a URL-safe token for email verification."""
    return secrets.token_urlsafe(32)


# ---------------------------------------------------------------------------
# Core provisioning functions
# ---------------------------------------------------------------------------

async def generate_api_key(
    email: str,
    tier: str = "free",
    *,
    key_name: Optional[str] = None,
    db: AsyncSession,
) -> tuple[str, ApiKey, Developer, Optional[str]]:
    """Self-service signup: create or look up developer, issue an API key.

    Returns (raw_key, ApiKey, Developer, verification_token | None).
    verification_token is set only for newly created developers.
    """
    email = email.strip().lower()
    key_name = key_name or f"{email} default key"
    verification_token: Optional[str] = None

    # Look up or create Developer
    result = await db.execute(
        select(Developer).where(Developer.email == email)
    )
    developer = result.scalar_one_or_none()

    if developer is None:
        developer = Developer(
            id=str(uuid.uuid4()),
            email=email,
            plan="free",
        )
        db.add(developer)
        await db.flush()

        # Trigger email verification for new accounts
        verification_token = generate_verification_token()
        await send_verification_email(email, verification_token)

    # Generate key material
    raw_key = "bw_" + secrets.token_urlsafe(32)
    key_hash = _hash_key_bcrypt(raw_key)
    key_id = str(uuid.uuid4())

    api_key = ApiKey(
        id=key_id,
        key_hash=key_hash,
        developer_id=developer.id,
        name=key_name,
        tier=tier,
        is_active=True,
    )
    db.add(api_key)
    await db.flush()

    return raw_key, api_key, developer, verification_token


async def validate_api_key(
    raw_key: str,
    *,
    db: AsyncSession,
) -> Optional[ApiKey]:
    """Validate a raw API key and return the matching ApiKey record, or None.

    Supports both bcrypt (new) and SHA-256 (legacy) hashes for migration.
    If a legacy key is validated, it is transparently upgraded to bcrypt.
    """
    # Fetch all active keys — for bcrypt we need to check each hash.
    # Optimisation: first try a SHA-256 exact-match (fast path for legacy keys).
    sha_hash = _hash_key_sha256(raw_key)
    result = await db.execute(
        select(ApiKey).where(ApiKey.key_hash == sha_hash, ApiKey.is_active == True)
    )
    api_key = result.scalar_one_or_none()

    if api_key is not None:
        # Legacy key found — upgrade hash to bcrypt transparently
        new_hash = _hash_key_bcrypt(raw_key)
        await db.execute(
            update(ApiKey).where(ApiKey.id == api_key.id).values(key_hash=new_hash)
        )
        await _touch_last_used(api_key.id, db)
        return api_key

    # Bcrypt path: fetch active keys and verify one-by-one.
    # In practice, a prefix index or key-id hint narrows the set. For now,
    # limit to keys whose hash looks like bcrypt to avoid scanning the full table.
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.is_active == True,
            ApiKey.key_hash.like("$2%"),
        )
    )
    candidates = result.scalars().all()

    for candidate in candidates:
        if len(raw_key) > 72:
            continue
        if _verify_key_bcrypt(raw_key, candidate.key_hash):
            await _touch_last_used(candidate.id, db)
            return candidate

    return None


async def rotate_api_key(
    key_id: str,
    developer_id: str,
    *,
    db: AsyncSession,
    grace_hours: int = 1,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> tuple[str, datetime]:
    """Rotate an existing key: issue a new key and schedule the old one for expiry.

    Returns (new_raw_key, old_key_rotating_expires_at).
    Raises ValueError if the key is not found or doesn't belong to the developer.
    Raises PermissionError if the daily rotation limit (3) is exceeded.
    """
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.developer_id == developer_id,
            ApiKey.is_active == True,
        )
    )
    old_key = result.scalar_one_or_none()

    if old_key is None:
        raise ValueError("API key not found or does not belong to this developer")

    one_day_ago = datetime.now(timezone.utc) - timedelta(hours=24)
    rotation_count_result = await db.execute(
        select(ApiKeyAuditLog).where(
            ApiKeyAuditLog.key_id == key_id,
            ApiKeyAuditLog.action == "rotate",
            ApiKeyAuditLog.created_at >= one_day_ago,
        )
    )
    rotation_count = len(rotation_count_result.scalars().all())
    if rotation_count >= 3:
        raise PermissionError("Daily rotation limit (3 per day) exceeded for this key")

    old_key_hash = old_key.key_hash

    raw_key = "bw_" + secrets.token_urlsafe(32)
    key_hash = _hash_key_bcrypt(raw_key)
    new_key_id = str(uuid.uuid4())

    new_key = ApiKey(
        id=new_key_id,
        key_hash=key_hash,
        developer_id=developer_id,
        name=str(old_key.name) + " (rotated)",
        tier=str(old_key.tier),
        is_active=True,
        rate_limit=old_key.rate_limit,
        allowed_origins=old_key.allowed_origins,
        rotated_from_key_id=key_id,
    )
    db.add(new_key)

    rotating_expires_at = datetime.now(timezone.utc) + timedelta(hours=grace_hours)
    await db.execute(
        update(ApiKey)
        .where(ApiKey.id == key_id)
        .values(is_active=False, rotating_expires_at=rotating_expires_at)
    )
    await cache_delete_pattern(f"apikey:*:{key_id}")
    await cache_delete_pattern(f"apikey:hash:{old_key_hash}")

    audit_log = ApiKeyAuditLog(
        id=str(uuid.uuid4()),
        key_id=key_id,
        developer_id=developer_id,
        action="rotate",
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(audit_log)
    await db.flush()

    return raw_key, rotating_expires_at


async def revoke_api_key(
    key_id: str,
    developer_id: str,
    *,
    db: AsyncSession,
) -> bool:
    """Revoke an API key. Returns True if revoked, False if not found.

    Only the owning developer can revoke their key.
    """
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.developer_id == developer_id,
            ApiKey.is_active == True,
        )
    )
    api_key = result.scalar_one_or_none()

    if api_key is None:
        return False

    key_hash = api_key.key_hash
    await db.execute(
        update(ApiKey).where(ApiKey.id == key_id).values(is_active=False)
    )
    await cache_delete_pattern(f"apikey:*:{key_id}")
    await cache_delete_pattern(f"apikey:hash:{key_hash}")
    return True


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _touch_last_used(key_id: str, db: AsyncSession) -> None:
    """Update last_used_at timestamp."""
    await db.execute(
        update(ApiKey).where(ApiKey.id == key_id).values(
            last_used_at=datetime.now(timezone.utc)
        )
    )


# ---------------------------------------------------------------------------
# Renewal
# ---------------------------------------------------------------------------

async def renew_api_key(
    key_id: str,
    developer_id: str,
    *,
    db: AsyncSession,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    extend_days: int = 30,
) -> tuple[ApiKey, datetime]:
    """Renew an API key by extending its expiry date.

    Returns (renewed ApiKey, new_expires_at).
    Raises ValueError if the key is not found, already expired, or doesn't belong to the developer.
    """
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.developer_id == developer_id,
            ApiKey.is_active == True,
        )
    )
    api_key = result.scalar_one_or_none()

    if api_key is None:
        raise ValueError("API key not found or does not belong to this developer")

    now = datetime.now(timezone.utc)
    current_expiry = api_key.expires_at

    if current_expiry is not None and current_expiry < now:
        raise ValueError("API key is already expired and cannot be renewed")

    new_expires_at = now + timedelta(days=extend_days)

    await db.execute(
        update(ApiKey).where(ApiKey.id == key_id).values(expires_at=new_expires_at)
    )

    audit_log = ApiKeyAuditLog(
        id=str(uuid.uuid4()),
        key_id=key_id,
        developer_id=developer_id,
        action="renew",
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(audit_log)
    await db.flush()

    api_key.expires_at = new_expires_at
    return api_key, new_expires_at


# ---------------------------------------------------------------------------
# Expiry notification
# ---------------------------------------------------------------------------

def _render_expiry_notification_email(
    email: str,
    key_name: str,
    days_until_expiry: int,
    extend_url: str,
) -> str:
    try:
        template = _jinja_env.get_template("key_expiry_notification.html")
        return template.render(
            recipient_email=email,
            key_name=key_name,
            days_until_expiry=days_until_expiry,
            extend_url=extend_url,
            current_year=datetime.now(timezone.utc).year,
        )
    except Exception:
        return f"""
        <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px;">
            <h1 style="color: #111827;">Your BuyWhere API key is expiring soon</h1>
            <p style="color: #374151; font-size: 16px;">
                Your API key <strong>{key_name}</strong> will expire in <strong>{days_until_expiry} day{'s' if days_until_expiry != 1 else ''}</strong>.
            </p>
            <p style="color: #374151; font-size: 16px;">To avoid service disruption, renew your key now:</p>
            <a href="{extend_url}" style="display: inline-block; padding: 14px 32px; background-color: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600;">Renew API Key</a>
            <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">Or copy this link: {extend_url}</p>
        </body>
        </html>
        """


async def send_key_expiry_notification(
    email: str,
    key_name: str,
    days_until_expiry: int,
    extend_url: str,
) -> bool:
    """Send an expiry warning email for an API key.

    Returns True if the email was sent successfully.
    """
    html_body = _render_expiry_notification_email(email, key_name, days_until_expiry, extend_url)
    subject = f"Your BuyWhere API key '{key_name}' is expiring in {days_until_expiry} day{'s' if days_until_expiry != 1 else ''}"

    if settings.sendgrid_enabled and settings.sendgrid_api_key:
        success, _ = _send_verification_email_via_sendgrid(email, subject, html_body)
        return success
    elif settings.smtp_host:
        return _send_verification_email_via_smtp(email, subject, html_body)

    return False
