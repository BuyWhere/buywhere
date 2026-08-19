from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from typing import List, Optional
from decimal import Decimal

router = APIRouter(prefix="/demo", tags=["demo"])


class DemoProduct(BaseModel):
    id: int
    name: str
    price: Decimal
    currency: str
    merchant: str
    buy_url: str
    buywhere_score: float = Field(..., description="0-100 score of BuyWhere recommendation quality")
    confidence: float = Field(..., description="0-1 confidence of match")


class DemoResolveResponse(BaseModel):
    query: str
    products: List[DemoProduct]
    total_results: int
    latency_ms: int


class DemoMetricsResponse(BaseModel):
    latency_p50_ms: int
    latency_p95_ms: int
    uptime: float
    data_freshness: str
    accuracy: float


class DemoComparisonEntry(BaseModel):
    metric: str
    scraping: str
    buywhere: str
    advantage: str


class DemoCompareResponse(BaseModel):
    title: str
    comparisons: List[DemoComparisonEntry]


@router.get("/resolve", response_model=DemoResolveResponse, summary="Demo product resolution endpoint for agent simulation")
async def demo_resolve(q: str = Query(..., description="Search query")):
    demo_products = [
        DemoProduct(
            id=1,
            name="HydroFlask Wide Mouth 32oz Water Bottle - Black",
            price=Decimal("45.99"),
            currency="USD",
            merchant="Amazon",
            buy_url="https://amazon.com/dp/B07XJ8C8F5",
            buywhere_score=94,
            confidence=0.92,
        ),
        DemoProduct(
            id=2,
            name="Yeti Rambler 30oz Tumbler - Black",
            price=Decimal("38.00"),
            currency="USD",
            merchant="Dick's Sporting Goods",
            buy_url="https://dickssportinggoods.com/p/yeti-rambler-30oz",
            buywhere_score=91,
            confidence=0.88,
        ),
        DemoProduct(
            id=3,
            name="Britakey 32oz Sports Water Bottle - BPA Free",
            price=Decimal("19.99"),
            currency="USD",
            merchant="Walmart",
            buy_url="https://walmart.com/ip/britakey-water-bottle",
            buywhere_score=78,
            confidence=0.72,
        ),
    ]
    return DemoResolveResponse(
        query=q,
        products=demo_products,
        total_results=len(demo_products),
        latency_ms=124,
    )


@router.get("/metrics", response_model=DemoMetricsResponse, summary="Demo reliability metrics for agent simulation")
async def demo_metrics():
    return DemoMetricsResponse(
        latency_p50_ms=120,
        latency_p95_ms=210,
        uptime=0.9995,
        data_freshness="2h",
        accuracy=0.97,
    )


@router.get("/compare", response_model=DemoCompareResponse, summary="Demo scraping vs BuyWhere comparison")
async def demo_compare():
    comparisons = [
        DemoComparisonEntry(
            metric="Latency (P95)",
            scraping="800-2000ms",
            buywhere="210ms",
            advantage="BuyWhere 4-10x faster",
        ),
        DemoComparisonEntry(
            metric="Uptime",
            scraping="60-80%",
            buywhere="99.95%",
            advantage="BuyWhere more reliable",
        ),
        DemoComparisonEntry(
            metric="Data Freshness",
            scraping="Hours to days",
            buywhere="2 hours",
            advantage="BuyWhere fresher data",
        ),
        DemoComparisonEntry(
            metric="Coverage",
            scraping="Single platform",
            buywhere="50+ platforms",
            advantage="BuyWhere wider coverage",
        ),
        DemoComparisonEntry(
            metric="Error Rate",
            scraping="20-40%",
            buywhere="<3%",
            advantage="BuyWhere more stable",
        ),
    ]
    return DemoCompareResponse(
        title="Traditional Scraping vs BuyWhere API",
        comparisons=comparisons,
    )