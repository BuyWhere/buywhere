#!/usr/bin/env python3
"""
Ingestion Pipeline Health Check Script
Based on BUY-18144 requirements and previous health check report
"""

import requests
import json
import time
from datetime import datetime, timedelta
import sys

def check_api_health():
    """Check API health endpoint"""
    try:
        response = requests.get('https://api.buywhere.ai/health', timeout=10)
        if response.status_code == 200:
            data = response.json()
            print(f"✓ API Health: OK ({response.elapsed.total_seconds()*1000:.0f}ms)")
            print(f"  Status: {data.get('status')}")
            print(f"  Timestamp: {data.get('ts')}")
            return True
        else:
            print(f"✗ API Health: FAILED (HTTP {response.status_code})")
            return False
    except Exception as e:
        print(f"✗ API Health: ERROR - {str(e)}")
        return False

def check_ingestion_endpoint():
    """Check ingestion health endpoint without auth (will likely fail)"""
    try:
        response = requests.get('https://api.buywhere.ai/v1/ingest/health', timeout=10)
        if response.status_code == 200:
            data = response.json()
            print("✓ Ingestion Health: OK")
            print(f"  Data: {json.dumps(data, indent=2)}")
            return True
        elif response.status_code == 401:
            print("⚠ Ingestion Health: Requires authentication")
            return None  # Not a failure, needs auth
        else:
            print(f"✗ Ingestion Health: FAILED (HTTP {response.status_code})")
            return False
    except Exception as e:
        print(f"✗ Ingestion Health: ERROR - {str(e)}")
        return False

def check_basic_connectivity():
    """Check basic system connectivity"""
    endpoints = [
        ('API Health', 'https://api.buywhere.ai/health'),
        ('Products Count', 'https://api.buywhere.ai/v1/products/count'),
    ]
    
    results = {}
    for name, url in endpoints:
        try:
            response = requests.get(url, timeout=5)
            results[name] = {
                'status': response.status_code,
                'success': response.status_code == 200,
                'time': response.elapsed.total_seconds()
            }
        except Exception as e:
            results[name] = {
                'status': 'ERROR',
                'success': False,
                'time': None,
                'error': str(e)
            }
    
    # Print results
    for name, result in results.items():
        status_symbol = "✓" if result['success'] else "✗" if result['status'] != 'ERROR' else "⚠"
        print(f"{status_symbol} {name}: {result['status']} ({result['time']:.3f}s)" if result['time'] else f"{status_symbol} {name}: {result.get('error', 'Unknown error')}")
    
    return results

def generate_health_report():
    """Generate health report summary"""
    print("\n" + "="*50)
    print("INGESTION PIPELINE HEALTH CHECK REPORT")
    print("="*50)
    print(f"Timestamp: {datetime.utcnow().isoformat()}Z")
    
    # Run checks
    api_ok = check_api_health()
    ingestion_status = check_ingestion_endpoint()
    connectivity = check_basic_connectivity()
    
    print("\n" + "-"*30)
    print("SUMMARY")
    print("-"*30)
    
    overall_status = "HEALTHY"
    issues = []
    
    if not api_ok:
        overall_status = "DEGRADED"
        issues.append("API health check failed")
    
    if ingestion_status is False:
        overall_status = "DEGRADED"
        issues.append("Ingestion health check failed")
    elif ingestion_status is None:
        issues.append("Ingestion health requires authentication")
    
    connectivity_failures = [k for k, v in connectivity.items() if not v['success']]
    if connectivity_failures:
        overall_status = "DEGRADED"
        issues.extend([f"{endpoint} unreachable" for endpoint in connectivity_failures])
    
    print(f"Overall Status: {overall_status}")
    if issues:
        print("Issues Found:")
        for issue in issues:
            print(f"  - {issue}")
    else:
        print("No issues detected")
    
    print("\nRECOMMENDATIONS:")
    if "Ingestion health requires authentication" in issues:
        print("  - Obtain valid API key for full ingestion monitoring")
    if "API health check failed" in issues:
        print("  - Investigate API service issues")
    if any("unreachable" in issue for issue in issues):
        print("  - Check network connectivity and service availability")
    
    return overall_status

if __name__ == "__main__":
    print("Starting Ingestion Pipeline Health Check...")
    
    status = generate_health_report()
    
    # Exit codes for automation
    if status == "HEALTHY":
        sys.exit(0)
    elif status == "DEGRADED":
        sys.exit(1)
    else:
        sys.exit(2)