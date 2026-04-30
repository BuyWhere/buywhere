from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import get_settings
import logging
import os

logger = logging.getLogger(__name__)

settings = get_settings()

def _normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url

_db_url: str | None = None
_engine = None
_db_init_failed = False

def _get_db_url() -> str:
    """Get normalized database URL."""
    global _db_url
    if _db_url is None:
        db_url = settings.database_url
        if "paperclip" in db_url or "127.0.0.1:54330" in db_url or "localhost:54330" in db_url:
            db_url = os.environ.get(
                "BUYWHERE_DATABASE_URL",
                "postgresql+asyncpg://buywhere:buywhere@db:5432/catalog",
            )
        _db_url = _normalize_database_url(db_url)
    return _db_url

def _create_engine():
    """Create async engine without blocking retries."""
    global _engine
    
    if _engine is not None:
        return _engine
    
    db_url = _get_db_url()
    
    try:
        _engine = create_async_engine(
            db_url,
            echo=settings.debug,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_pre_ping=settings.db_pool_pre_ping,
            pool_recycle=settings.db_pool_recycle,
            pool_timeout=settings.db_pool_timeout,
        )
        logger.info("Database engine created successfully")
        return _engine
    except Exception as e:
        logger.error(f"Failed to create database engine: {e}")
        _engine = None
        raise

def get_engine():
    """Get or create the database engine."""
    global _engine, _db_init_failed
    
    if _db_init_failed:
        return None
    
    try:
        return _create_engine()
    except Exception as e:
        _db_init_failed = True
        logger.error(f"Database initialization permanently failed: {e}")
        return None

def get_session_maker() -> async_sessionmaker:
    """Get or create the async session maker."""
    engine = get_engine()
    if engine is None:
        raise RuntimeError("Database engine not available")
    
    return async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

def get_async_session():
    """Get a new async session. Use as: async with get_async_session() as session:"""
    return get_session_maker()()

class Base(DeclarativeBase):
    pass

async def get_db():
    """Generator-based db session getter for dependency injection."""
    session_maker = get_session_maker()
    async with session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise

def get_sync_db():
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy import create_engine
    db_url = _get_db_url()
    if db_url is None:
        raise RuntimeError("Database URL not available - engine creation failed")
    sync_url = db_url.replace("postgresql+asyncpg://", "postgresql://")
    sync_engine = create_engine(sync_url)
    return sessionmaker(bind=sync_engine)()

class _AsyncSessionLocal:
    """Wrapper that provides lazy session maker initialization."""
    
    def __call__(self):
        return get_session_maker()()
    
    def __enter__(self, *args, **kwargs):
        raise RuntimeError("Use 'async with AsyncSessionLocal()' not plain 'with'")
    
    def __exit__(self, *args, **kwargs):
        pass

AsyncSessionLocal = _AsyncSessionLocal()
engine = property(lambda self: get_engine())
