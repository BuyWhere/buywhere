#!/usr/bin/env python3
import asyncio
import httpx
import time
import statistics

API_BASE = "http://localhost:8000"
API_KEY = "bw_G6zORx7VBPEHhrLXuYwMK6W08dIS_o0RU7hxKDtjabg"
SEARCH_QUERY = "laptop"
CONCURRENT_REQUESTS = 100

async def single_request(client, request_id):
    start = time.perf_counter()
    try:
        resp = await client.get(
            f"{API_BASE}/v1/products/search",
            params={"q": SEARCH_QUERY},
            headers={"Authorization": f"Bearer {API_KEY}"},
            timeout=30.0
        )
        duration_ms = (time.perf_counter() - start) * 1000
        return {"request_id": request_id, "status": resp.status_code, "duration_ms": duration_ms, "success": resp.status_code == 200}
    except Exception as e:
        duration_ms = (time.perf_counter() - start) * 1000
        return {"request_id": request_id, "status": 0, "duration_ms": duration_ms, "success": False, "error": str(e)}

async def run_load_test():
    print(f"Running p99 latency load test: {CONCURRENT_REQUESTS} concurrent requests")
    async with httpx.AsyncClient() as client:
        tasks = [single_request(client, i) for i in range(CONCURRENT_REQUESTS)]
        results = await asyncio.gather(*tasks)

    durations = [r["duration_ms"] for r in results if r["success"]]
    failed = [r for r in results if not r["success"]]

    if not durations:
        print("ERROR: All requests failed!")
        for r in failed[:5]:
            print(f"  Request {r['request_id']}: status={r['status']}, error={r.get('error','N/A')}")
        return

    durations_sorted = sorted(durations)
    count = len(durations_sorted)

    print(f"Results ({count} successful, {len(failed)} failed):")
    print(f"  p50:  {durations_sorted[int(count*0.50)]:.1f}ms")
    print(f"  p90:  {durations_sorted[int(count*0.90)]:.1f}ms")
    print(f"  p95:  {durations_sorted[int(count*0.95)]:.1f}ms")
    p99_idx = int(count * 0.99)
    if p99_idx >= count:
        p99_idx = count - 1
    print(f"  p99:  {durations_sorted[p99_idx]:.1f}ms")
    print(f"  max:  {max(durations):.1f}ms")
    print(f"  avg:  {statistics.mean(durations):.1f}ms")

    target_ms = 100
    if durations_sorted[p99_idx] < target_ms:
        print(f"PASS: p99 ({durations_sorted[p99_idx]:.1f}ms) is below target ({target_ms}ms)")
    else:
        print(f"FAIL: p99 ({durations_sorted[p99_idx]:.1f}ms) exceeds target ({target_ms}ms)")

if __name__ == "__main__":
    asyncio.run(run_load_test())