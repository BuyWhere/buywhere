import json
from typing import Any, Optional
from redis.asyncio import Redis
from app.config import get_settings

settings = get_settings()

TTL_STATS = 600
TTL_SEARCH = 300

_redis: Optional[Redis] = None


async def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
    return _redis


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.close()
        _redis = None


async def cache_get(key: str) -> Optional[Any]:
    try:
        redis = await get_redis()
        data = await redis.get(key)
        if data:
            return json.loads(data)
        return None
    except Exception:
        return None


async def cache_set(key: str, value: Any, ttl_seconds: int = 600) -> bool:
    try:
        redis = await get_redis()
        await redis.setex(key, ttl_seconds, json.dumps(value))
        return True
    except Exception:
        return False


async def cache_delete(key: str) -> bool:
    try:
        redis = await get_redis()
        await redis.delete(key)
        return True
    except Exception:
        return False


async def cache_get_many(keys: list[str]) -> dict[str, Any]:
    try:
        redis = await get_redis()
        if not keys:
            return {}
        result = await redis.mget(keys)
        return {k: json.loads(v) for k, v in zip(keys, result) if v}
    except Exception:
        return {}


async def cache_delete_pattern(pattern: str) -> int:
    try:
        redis = await get_redis()
        keys = []
        async for key in redis.scan_iter(match=pattern):
            keys.append(key)
        if keys:
            return await redis.delete(*keys)
        return 0
    except Exception:
        return 0


def build_cache_key(prefix: str, **kwargs) -> str:
    sorted_params = sorted(kwargs.items())
    param_str = "&".join(f"{k}={v}" for k, v in sorted_params if v is not None)
    return f"{prefix}:{param_str}" if param_str else prefix


async def get_cache_stats() -> dict:
    try:
        redis = await get_redis()
        info = await redis.info("stats")
        return {
            "total_commands_processed": info.get("total_commands_processed", 0),
            "keyspace_hits": info.get("keyspace_hits", 0),
            "keyspace_misses": info.get("keyspace_misses", 0),
        }
    except Exception:
        return {"total_commands_processed": 0, "keyspace_hits": 0, "keyspace_misses": 0}


async def get_cache_key_count(pattern: str = "*") -> int:
    try:
        redis = await get_redis()
        count = 0
        async for _ in redis.scan_iter(match=pattern):
            count += 1
        return count
    except Exception:
        return 0


async def get_redis_memory_info() -> dict:
    try:
        redis = await get_redis()
        info = await redis.info("memory")
        return {
            "used_memory": info.get("used_memory", 0),
            "used_memory_peak": info.get("used_memory_peak", 0),
            "used_memory_human": info.get("used_memory_human", "0B"),
        }
    except Exception:
        return {"used_memory": 0, "used_memory_peak": 0, "used_memory_human": "0B"}


async def reset_cache_stats() -> bool:
    try:
        redis = await get_redis()
        await redis.config_resetstat()
        return True
    except Exception:
        return False