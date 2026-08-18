#!/usr/bin/env python3
"""Mint a Paperclip JWT for the hourly throughput dispatcher cron job."""

import base64
import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _mint_hmac(payload: dict, secret: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode())
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(secret.encode(), f"{header_b64}.{payload_b64}".encode(), hashlib.sha256).digest()
    return f"{header_b64}.{payload_b64}.{_b64url_encode(sig)}"


def _jwt_secret() -> str:
    """Read the Paperclip agent JWT secret from a local Paperclip process when available."""
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            env = open(f"/proc/{pid}/environ", "rb").read()
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
        if b"PAPERCLIP_AGENT_JWT_SECRET=" not in env:
            continue
        for entry in env.split(b"\x00"):
            if entry.startswith(b"PAPERCLIP_AGENT_JWT_SECRET="):
                return entry.split(b"=", 1)[1].decode()
    raise RuntimeError("PAPERCLIP_AGENT_JWT_SECRET not found in local process environment")


def mint_token() -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": os.environ.get("PAPERCLIP_AGENT_ID", "3ec8f6dd-1735-4479-9825-a2c42edac34c"),
        "company_id": os.environ.get("PAPERCLIP_COMPANY_ID", "177bc805-e3c8-4336-84cb-8e1e482d5a17"),
        "adapter_type": "claude_local",
        "run_id": os.environ.get("PAPERCLIP_RUN_ID", f"cron-{now.strftime('%Y%m%d%H%M%S')}"),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=60)).timestamp()),
        "iss": "paperclip",
        "aud": "paperclip-api",
    }
    secret = _jwt_secret()
    try:
        import jwt as pyjwt
        return pyjwt.encode(payload, secret, algorithm="HS256")
    except ImportError:
        return _mint_hmac(payload, secret)


if __name__ == "__main__":
    print(mint_token())
