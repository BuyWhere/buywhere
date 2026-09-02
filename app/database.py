from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.exc import SQLAlchemyError
from app.config import get_settings
import logging
import os
import asyncio

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
    """Generator-based db session getter for dependency injection with retry logic."""
    session_maker = get_session_maker()
    max_retries = 3
    retry_delay = 1  # seconds

    for attempt in range(max_retries):
        session = session_maker()
        try:
            yield session
            await session.commit()
            return  # Success, exit retry loop
        except Exception as e:
            error_msg = str(e)
            # Check for connection-related errors that deserve retry
            is_connection_error = any([
                'InterfaceError' in error_msg,
                'connection is closed' in error_msg,
                'underlying connection is closed' in error_msg,
                'ConnectionResetError' in error_msg,
            ])

            if is_connection_error and attempt < max_retries - 1:
                logging.warning(f"Database connection error (attempt {attempt + 1}/{max_retries}): {e}. Retrying...")
                try:
                    await session.rollback()
                except Exception:
                    pass  # Ignore rollback errors on dead connections
                finally:
                    await session.close()

                await asyncio.sleep(retry_delay * (2 ** attempt))  # Exponential backoff
                continue  # Retry
            else:
                # Either not a connection error or last attempt - rollback and raise
                await session.rollback()
                raise
        finally:
            await session.close()

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


async def with_db_retry(func, *args, max_retries=3, **kwargs):
    """
    Execute a database function with retry logic for connection errors.

    Usage:
        async def my_operation():
            session = get_async_session()
            result = await session.execute(query)
            return result

        result = await with_db_retry(my_operation)
    """
    for attempt in range(max_retries):
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            error_msg = str(e)
            is_connection_error = any([
                'InterfaceError' in error_msg,
                'connection is closed' in error_msg,
                'underlying connection is closed' in error_msg,
                'ConnectionResetError' in error_msg,
            ])

            if is_connection_error and attempt < max_retries - 1:
                logger.warning(f"Database operation failed (attempt {attempt + 1}/{max_retries}): {e}. Retrying...")
                await asyncio.sleep(1 * (2 ** attempt))  # Exponential backoff
                continue
            else:
                raise

