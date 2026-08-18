"""Product data quality scoring for the ingestion pipeline.

Scores individual product records on a 0.0-1.0 scale based on field completeness.
Used at ingest time to assign quality tiers and gate rejection logging.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Tier thresholds
# ---------------------------------------------------------------------------

TIER_STANDARD = 0.7
TIER_MINIMUM = 0.4

TIER_STANDARD_LABEL = "Standard"
TIER_MINIMUM_LABEL = "Minimum"
TIER_BELOW_MINIMUM_LABEL = "Below Minimum"
TIER_CRITICAL_FAIL_LABEL = "Critical Fail"


# ---------------------------------------------------------------------------
# Field weights (must sum to 1.0)
# ---------------------------------------------------------------------------

# Required fields — critical fail if any are missing/empty
REQUIRED_FIELDS: tuple[str, ...] = ("title", "price", "currency", "url", "merchant_id")

# Optional fields with bonus weight contributions
_OPTIONAL_WEIGHTS: dict[str, float] = {
    "description": 0.10,
    "image_url": 0.10,
    "brand": 0.08,
    "category": 0.07,
    "sku": 0.05,
}

# Required fields each contribute equal weight after the optional bonus pool
_REQUIRED_BASE_WEIGHT = (1.0 - sum(_OPTIONAL_WEIGHTS.values())) / len(REQUIRED_FIELDS)


@dataclass
class IngestQualityResult:
    score: float
    tier: str
    missing_required: list[str] = field(default_factory=list)
    missing_optional: list[str] = field(default_factory=list)
    is_critical_fail: bool = False


def _present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str) and not value.strip():
        return False
    return True


def compute_ingest_quality_score(product: dict[str, Any]) -> IngestQualityResult:
    """Score a raw product dict produced by the ingest pipeline.

    Returns an IngestQualityResult with:
    - score: 0.0 – 1.0
    - tier: Standard / Minimum / Below Minimum / Critical Fail
    - missing_required / missing_optional field lists
    - is_critical_fail: True when title or price is absent
    """
    missing_required: list[str] = []
    for fname in REQUIRED_FIELDS:
        if not _present(product.get(fname)):
            missing_required.append(fname)

    # Critical fail: title (name) or price absent — reject immediately
    critical = "title" in missing_required or "price" in missing_required
    if critical:
        return IngestQualityResult(
            score=0.0,
            tier=TIER_CRITICAL_FAIL_LABEL,
            missing_required=missing_required,
            is_critical_fail=True,
        )

    # Base score from required fields (only non-critical failures penalise here)
    required_score = (len(REQUIRED_FIELDS) - len(missing_required)) * _REQUIRED_BASE_WEIGHT

    # Bonus score from optional fields
    missing_optional: list[str] = []
    optional_score = 0.0
    for fname, weight in _OPTIONAL_WEIGHTS.items():
        if _present(product.get(fname)):
            optional_score += weight
        else:
            missing_optional.append(fname)

    score = round(min(1.0, required_score + optional_score), 4)

    if score >= TIER_STANDARD:
        tier = TIER_STANDARD_LABEL
    elif score >= TIER_MINIMUM:
        tier = TIER_MINIMUM_LABEL
    else:
        tier = TIER_BELOW_MINIMUM_LABEL

    return IngestQualityResult(
        score=score,
        tier=tier,
        missing_required=missing_required,
        missing_optional=missing_optional,
        is_critical_fail=False,
    )
