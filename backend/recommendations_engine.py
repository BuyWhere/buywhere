"""Recommendations engine stub."""
from typing import List


def compute_recommendations(product_id: str, limit: int = 5) -> List:
    return []


class CoOccurrenceEngine:
    async def get_related(self, product_id: str, limit: int = 5):
        return []
