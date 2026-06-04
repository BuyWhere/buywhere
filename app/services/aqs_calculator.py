"""Agent Quality Score (AQS) Calculator.

Consumes a test-cycle JSON payload and produces a composite AQS on a 0-100
scale together with per-dimension scores, grade, sub-metrics, and triggered
escalation alerts.

Formula:
    AQS = (Relevance × 0.35) + (Coverage × 0.30) + (Freshness × 0.15)
          + (Completeness × 0.10) + (Performance × 0.10)

Run-script: scripts/aqs_calculator.py
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any


# ---------------------------------------------------------------------------
# Grade thresholds
# ---------------------------------------------------------------------------

_GRADE_THRESHOLDS: list[tuple[float, str]] = [
    (90, "Excellent"),
    (75, "Good"),
    (50, "Fair"),
    (25, "Poor"),
    (0, "Unusable"),
]


def _grade(aqs: float) -> str:
    for threshold, label in _GRADE_THRESHOLDS:
        if aqs >= threshold:
            return label
    return "Unusable"


# ---------------------------------------------------------------------------
# Latency → score helper  (200ms=100, 500ms=50, 1000ms=0, linear segments)
# ---------------------------------------------------------------------------

def _latency_score(p_ms: float | None) -> float:
    if p_ms is None:
        return 50.0
    if p_ms <= 200:
        return 100.0
    if p_ms <= 500:
        return 100.0 - 50.0 * (p_ms - 200) / 300
    if p_ms <= 1000:
        return 50.0 - 50.0 * (p_ms - 500) / 500
    return 0.0


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


# ---------------------------------------------------------------------------
# Dimension scoring
# ---------------------------------------------------------------------------

def _score_relevance(sub: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    category_match_rate = sub.get("category_match_rate")
    if category_match_rate is None:
        return 50.0, {"note": "category_match_rate absent; defaulted to 50"}
    return _clamp(float(category_match_rate) * 100), {"category_match_rate": category_match_rate}


def _score_coverage(sub: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    success_rate = sub.get("query_success_rate", sub.get("success_rate"))
    adequate_rate = sub.get("adequate_coverage_rate", sub.get("adequate_rate"))
    category_coverage = sub.get("category_coverage_pct", sub.get("category_coverage"))

    parts: dict[str, float | None] = {
        "query_success_rate": float(success_rate) if success_rate is not None else None,
        "adequate_coverage_rate": float(adequate_rate) if adequate_rate is not None else None,
        "category_coverage_pct": float(category_coverage) if category_coverage is not None else None,
    }

    score = 0.0
    if parts["query_success_rate"] is not None:
        score += parts["query_success_rate"] * 50
    else:
        score += 50 * 0.5  # partial default

    if parts["adequate_coverage_rate"] is not None:
        score += parts["adequate_coverage_rate"] * 30
    else:
        score += 30 * 0.5

    if parts["category_coverage_pct"] is not None:
        score += parts["category_coverage_pct"] * 20
    else:
        score += 20 * 0.5

    return _clamp(score), parts  # type: ignore[return-value]


def _score_freshness(sub: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    staleness_factor = sub.get("staleness_factor")
    availability_accuracy = sub.get("availability_accuracy")

    if staleness_factor is not None:
        score = _clamp((1.0 - float(staleness_factor)) * 100)
        return score, {"staleness_factor": staleness_factor, "source": "staleness_factor"}

    if availability_accuracy is not None:
        score = _clamp(float(availability_accuracy) * 100)
        return score, {"availability_accuracy": availability_accuracy, "source": "availability_accuracy_fallback"}

    return 50.0, {"note": "no freshness data; defaulted to 50"}


def _score_completeness(sub: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    schema_rate = sub.get("schema_compliance_rate", sub.get("schema_rate"))
    image_rate = sub.get("image_coverage_rate", sub.get("image_rate"))
    price_rate = sub.get("price_completeness_rate", sub.get("price_rate"))
    merchant_rate = sub.get("merchant_attribution_rate", sub.get("merchant_rate"))

    def _v(x: Any, default: float = 0.5) -> float:
        return float(x) if x is not None else default

    score = (
        _v(schema_rate) * 40
        + _v(image_rate) * 25
        + _v(price_rate) * 25
        + _v(merchant_rate) * 10
    )
    return _clamp(score), {
        "schema_rate": schema_rate,
        "image_rate": image_rate,
        "price_rate": price_rate,
        "merchant_rate": merchant_rate,
    }


def _score_performance(sub: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    p50_search = sub.get("search_p50_ms", sub.get("p50_search_ms"))
    p95_search = sub.get("search_p95_ms", sub.get("p95_search_ms"))
    p50_get = sub.get("get_product_p50_ms", sub.get("p50_get_ms"))
    p50_list = sub.get("tools_list_p50_ms", sub.get("p50_list_ms"))

    scores = [_latency_score(p50_search), _latency_score(p95_search), _latency_score(p50_get), _latency_score(p50_list)]
    avg = sum(scores) / len(scores)
    return _clamp(avg), {
        "search_p50_ms": p50_search,
        "search_p95_ms": p95_search,
        "get_product_p50_ms": p50_get,
        "tools_list_p50_ms": p50_list,
    }


# ---------------------------------------------------------------------------
# Escalation evaluation
# ---------------------------------------------------------------------------

def _evaluate_escalations(sub_metrics: dict[str, Any], aqs: float, prior_cycles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    escalations: list[dict[str, Any]] = []

    def _recent_aqs_low(n: int = 2) -> bool:
        recent = [c.get("aqs", 100) for c in prior_cycles[-(n - 1):]]
        return len(recent) >= (n - 1) and all(v < 75 for v in recent) and aqs < 75

    def _recent_p95_high(n: int = 2) -> bool:
        p95 = sub_metrics.get("search_p95_ms")
        if p95 is None or float(p95) <= 1000:
            return False
        recent = [c.get("sub_metrics", {}).get("search_p95_ms", 0) for c in prior_cycles[-(n - 1):]]
        return len(recent) >= (n - 1) and all(v is not None and float(v) > 1000 for v in recent)

    def _recent_zero_result_high(n: int = 2) -> bool:
        zrr = sub_metrics.get("zero_result_rate")
        if zrr is None or float(zrr) <= 0.01:
            return False
        recent = [c.get("sub_metrics", {}).get("zero_result_rate", 0) for c in prior_cycles[-(n - 1):]]
        return len(recent) >= (n - 1) and all(v is not None and float(v) > 0.01 for v in recent)

    if _recent_aqs_low(2):
        escalations.append({
            "signal": "low_aqs_sustained",
            "threshold": 75,
            "value": aqs,
            "cycles": 2,
            "message": f"AQS {aqs:.1f} < 75 sustained for 2+ cycles (30 min)",
        })

    qsr = sub_metrics.get("query_success_rate")
    if qsr is not None and float(qsr) < 0.95:
        escalations.append({
            "signal": "query_success_rate_low",
            "threshold": 0.95,
            "value": float(qsr),
            "cycles": 1,
            "message": f"Query success rate {float(qsr)*100:.1f}% < 95%",
        })

    if _recent_p95_high(2):
        p95 = sub_metrics.get("search_p95_ms")
        escalations.append({
            "signal": "search_p95_high",
            "threshold": 1000,
            "value": float(p95),
            "cycles": 2,
            "message": f"Search p95 {float(p95):.0f}ms > 1000ms for 2+ cycles",
        })

    schema_rate = sub_metrics.get("schema_compliance_rate", sub_metrics.get("schema_rate"))
    if schema_rate is not None and float(schema_rate) < 0.90:
        escalations.append({
            "signal": "schema_compliance_low",
            "threshold": 0.90,
            "value": float(schema_rate),
            "cycles": 1,
            "message": f"Schema compliance {float(schema_rate)*100:.1f}% < 90%",
        })

    if _recent_zero_result_high(2):
        zrr = sub_metrics.get("zero_result_rate")
        escalations.append({
            "signal": "zero_result_rate_high",
            "threshold": 0.01,
            "value": float(zrr),
            "cycles": 2,
            "message": f"Zero-result rate {float(zrr)*100:.2f}% > 1% for 2+ cycles",
        })

    return escalations


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

@dataclass
class DimensionScore:
    name: str
    weight: float
    score: float
    weighted: float
    sub_metrics: dict[str, Any] = field(default_factory=dict)


@dataclass
class AQSResult:
    cycle_id: str
    computed_at: str
    aqs: float
    grade: str
    dimensions: list[DimensionScore]
    sub_metrics: dict[str, Any]
    escalations_fired: list[dict[str, Any]]


def compute_aqs(cycle: dict[str, Any], prior_cycles: list[dict[str, Any]] | None = None) -> AQSResult:
    """Compute AQS for a single test cycle.

    Parameters
    ----------
    cycle:
        Test-cycle dict matching the AQS Data Contract (BUY-12885 §4.1).
        Expected keys at top level:
            cycle_id, relevance, coverage, freshness, completeness, performance
        Each sub-key is a dict of raw sub-metrics.
    prior_cycles:
        Optional list of previous AQSResult dicts (as plain dicts, not objects)
        used to evaluate multi-cycle escalation rules. Pass the last 2 results.
    """
    if prior_cycles is None:
        prior_cycles = []

    rel_raw = cycle.get("relevance", {})
    cov_raw = cycle.get("coverage", {})
    fre_raw = cycle.get("freshness", {})
    com_raw = cycle.get("completeness", {})
    per_raw = cycle.get("performance", {})

    rel_score, rel_sub = _score_relevance(rel_raw)
    cov_score, cov_sub = _score_coverage(cov_raw)
    fre_score, fre_sub = _score_freshness(fre_raw)
    com_score, com_sub = _score_completeness(com_raw)
    per_score, per_sub = _score_performance(per_raw)

    dimensions = [
        DimensionScore("Relevance", 0.35, rel_score, round(rel_score * 0.35, 4), rel_sub),
        DimensionScore("Coverage", 0.30, cov_score, round(cov_score * 0.30, 4), cov_sub),
        DimensionScore("Freshness", 0.15, fre_score, round(fre_score * 0.15, 4), fre_sub),
        DimensionScore("Completeness", 0.10, com_score, round(com_score * 0.10, 4), com_sub),
        DimensionScore("Performance", 0.10, per_score, round(per_score * 0.10, 4), per_sub),
    ]

    aqs = _clamp(sum(d.weighted for d in dimensions))

    # Collect flattened sub_metrics for escalation checks
    flat_sub: dict[str, Any] = {}
    for sub in (rel_raw, cov_raw, fre_raw, com_raw, per_raw):
        flat_sub.update(sub)

    escalations = _evaluate_escalations(flat_sub, aqs, prior_cycles)

    return AQSResult(
        cycle_id=cycle.get("cycle_id", "unknown"),
        computed_at=datetime.now(timezone.utc).isoformat(),
        aqs=round(aqs, 2),
        grade=_grade(aqs),
        dimensions=dimensions,
        sub_metrics=flat_sub,
        escalations_fired=escalations,
    )


def aqs_result_to_dict(result: AQSResult) -> dict[str, Any]:
    """Serialise AQSResult to the AQS JSON output contract."""
    return {
        "cycle_id": result.cycle_id,
        "computed_at": result.computed_at,
        "aqs": result.aqs,
        "grade": result.grade,
        "dimensions": [
            {
                "name": d.name,
                "weight": d.weight,
                "score": round(d.score, 2),
                "weighted_contribution": d.weighted,
                "sub_metrics": d.sub_metrics,
            }
            for d in result.dimensions
        ],
        "sub_metrics": result.sub_metrics,
        "escalations_fired": result.escalations_fired,
    }
