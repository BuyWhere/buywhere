"""Recommendations stub."""
from typing import List


def get_recommendations(product_id: str, limit: int = 5) -> List:
    return []


class RecommendationEngine:
    async def get_recommendations(self, product_id: str, limit: int = 5):
        return []
