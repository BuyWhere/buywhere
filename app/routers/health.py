"""Health router stub."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db

router = APIRouter()


@router.get("/health/db")
async def health_db(db: AsyncSession = Depends(get_db)):
    return {"status": "ok"}


@router.get("/health/redis")
async def health_redis():
    return {"status": "ok"}
