from scripts.healthcheck import extract_result_count, format_summary_line, percentile


def test_extract_result_count_from_standard_payload_shapes():
    assert extract_result_count({"total_count": 42, "items": [{"id": 1}]}) == 42
    assert extract_result_count({"total": 7, "results": [1, 2]}) == 7
    assert extract_result_count({"items": [1, 2, 3]}) == 3
    assert extract_result_count([1, 2, 3, 4]) == 4


def test_percentile_interpolates_upper_tail():
    values = [100.0, 120.0, 150.0, 200.0, 800.0]
    assert percentile(values, 0.99) > 700.0


def test_format_summary_line_includes_overall_and_endpoint_metrics():
    state = {
        "days": {
            "2026-04-24": {
                "endpoints": {
                    "search": {"checks": 2, "successes": 2, "latencies_ms": [100.0, 110.0]},
                    "products": {"checks": 2, "successes": 1, "latencies_ms": [90.0, 500.0]},
                }
            }
        }
    }
    line = format_summary_line("2026-04-24", state)
    assert "SUMMARY date=2026-04-24" in line
    assert "uptime_pct=75.00" in line
    assert "search_uptime_pct=100.00" in line
    assert "products_uptime_pct=50.00" in line
