"""Product comparison stub."""
from typing import List


class ProductMatcher:
    def find_matches(self, product_id: str, limit: int = 5) -> List:
        return []


def normalize_text(text: str) -> str:
    return text.lower().strip() if text else ""

def normalize_brand(brand: str) -> str:
    return brand.lower().strip() if brand else ""

def normalized_title_key(title: str) -> str:
    import re
    return re.sub(r'\s+', ' ', title.lower().strip()) if title else ""

def compute_string_similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    a_lower, b_lower = a.lower(), b.lower()
    if a_lower == b_lower:
        return 1.0
    # Simple Jaccard similarity on words
    a_words = set(a_lower.split())
    b_words = set(b_lower.split())
    intersection = a_words & b_words
    union = a_words | b_words
    return len(intersection) / len(union) if union else 0.0
