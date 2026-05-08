"""CLI tool for managing BrightData proxy zones via the zone management API.

Requires a valid BrightData zone management API token with zone management
permissions (NOT just the proxy password). If the token returns 403, its
permission scope must be upgraded in the BrightData dashboard:
    Account → API Tokens → Edit token → add zone management permissions

Usage:
    # List existing zones
    BRIGHTDATA_API_TOKEN="<token>" python -m scrapers.provision_brightdata_zones --list

    # Create zones
    BRIGHTDATA_API_TOKEN="<token>" python -m scrapers.provision_brightdata_zones \\
        --zone datacenter_proxy1 --type datacenter --zone residential_proxy1 --type residential

    # Preview without API calls
    BRIGHTDATA_API_TOKEN="<token>" python -m scrapers.provision_brightdata_zones \\
        --zone datacenter_proxy1 --type datacenter --dry-run

    # Delete a zone
    BRIGHTDATA_API_TOKEN="<token>" python -m scrapers.provision_brightdata_zones \\
        --delete datacenter_proxy1
"""

import argparse
import json
import os
import sys
from typing import Optional

import httpx

BRIGHTDATA_API_BASE = os.environ.get("BRIGHTDATA_API_BASE", "https://api.brightdata.com")
API_TOKEN = os.environ.get("BRIGHTDATA_API_TOKEN") or os.environ.get("BRIGHTDATA_API_KEY")


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def list_zones(token: str) -> tuple[int, Optional[list[dict]]]:
    """List active zones. Returns (status_code, zones_list_or_None)."""
    try:
        resp = httpx.get(
            f"{BRIGHTDATA_API_BASE}/zone/get_active_zones",
            headers=_headers(token),
            timeout=30,
        )
        if resp.status_code == 200:
            return 200, resp.json()
        if resp.status_code == 401:
            print("  Error 401 Unauthorized — API token is invalid or expired.", file=sys.stderr)
            print("  Generate a new token from: https://brightdata.com/cp/setting/users", file=sys.stderr)
            return 401, None
        if resp.status_code == 403:
            print("  Error 403 Forbidden — API token lacks zone management permissions.", file=sys.stderr)
            print("  Go to Account → API Tokens → Edit token → add zone management scope.", file=sys.stderr)
            print("  Dashboard: https://brightdata.com/cp/setting/users", file=sys.stderr)
            return 403, None
        return resp.status_code, None
    except httpx.RequestError as exc:
        print(f"  Network error: {exc}", file=sys.stderr)
        return 0, None


def create_zone(token: str, name: str, zone_type: str, dry_run: bool = False) -> int:
    """Create a zone. Returns HTTP status code (0 for dry-run)."""
    if dry_run:
        print(f"  [DRY RUN] Would create zone '{name}' of type '{zone_type}'")
        return 0

    if zone_type == "datacenter":
        plan = {"type": "static", "ips_type": "shared"}
    elif zone_type == "residential":
        plan = {"type": "resident"}
    elif zone_type == "isp":
        plan = {"type": "static", "pool_ip_type": "static_res", "ips_type": "shared", "country": "us"}
    else:
        plan = {"type": zone_type}
    payload = {"zone": {"name": name}, "plan": plan}
    try:
        resp = httpx.post(
            f"{BRIGHTDATA_API_BASE}/zone",
            headers=_headers(token),
            json=payload,
            timeout=30,
        )
        if resp.status_code in (200, 201):
            data = resp.json()
            print(f"  Created zone '{name}':")
            print(f"    Zone name:    {data.get('name', name)}")
            print(f"    Username:     {data.get('username', 'N/A')}")
            print(f"    Password:     {data.get('password', 'N/A')}")
            if data.get("zone_type"):
                print(f"    Type:         {data['zone_type']}")
            return resp.status_code
        print(f"  Failed to create zone '{name}': HTTP {resp.status_code}", file=sys.stderr)
        if resp.status_code == 401:
            print("  API token is invalid or expired.", file=sys.stderr)
            print("  Generate a new token from: https://brightdata.com/cp/setting/users", file=sys.stderr)
        elif resp.status_code == 403:
            print("  API token lacks zone management permissions.", file=sys.stderr)
            print("  Go to Account → API Tokens → Edit token → add zone management scope.", file=sys.stderr)
            print("  Dashboard: https://brightdata.com/cp/setting/users", file=sys.stderr)
        elif resp.status_code == 409:
            print(f"  Zone '{name}' may already exist. Try --list to check.", file=sys.stderr)
        else:
            try:
                detail = resp.json()
                print(f"  Response: {json.dumps(detail)}", file=sys.stderr)
            except Exception:
                print(f"  Response: {resp.text[:300]}", file=sys.stderr)
        return resp.status_code
    except httpx.RequestError as exc:
        print(f"  Network error creating zone '{name}': {exc}", file=sys.stderr)
        return 0


def delete_zone(token: str, name: str, dry_run: bool = False) -> int:
    """Delete a zone by name. Returns HTTP status code."""
    if dry_run:
        print(f"  [DRY RUN] Would delete zone '{name}'")
        return 0

    try:
        resp = httpx.delete(
            f"{BRIGHTDATA_API_BASE}/zone",
            headers=_headers(token),
            json={"zone": name},
            timeout=30,
        )
        if resp.status_code in (200, 204):
            print(f"  Deleted zone '{name}'")
            return resp.status_code
        print(f"  Failed to delete zone '{name}': HTTP {resp.status_code}", file=sys.stderr)
        if resp.status_code == 401:
            print("  API token is invalid or expired.", file=sys.stderr)
        elif resp.status_code == 403:
            print("  API token lacks zone management permissions.", file=sys.stderr)
            print("  Go to Account → API Tokens → Edit token → add zone management scope.", file=sys.stderr)
        elif resp.status_code == 404:
            print(f"  Zone '{name}' does not exist.", file=sys.stderr)
        return resp.status_code
    except httpx.RequestError as exc:
        print(f"  Network error deleting zone '{name}': {exc}", file=sys.stderr)
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Manage BrightData proxy zones via the zone management API.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  List zones:\n"
            "    BRIGHTDATA_API_TOKEN='...' python -m scrapers.provision_brightdata_zones --list\n"
            "\n"
            "  Create both required zones:\n"
            "    BRIGHTDATA_API_TOKEN='...' python -m scrapers.provision_brightdata_zones \\\n"
            "        --zone datacenter_proxy1 --type datacenter \\\n"
            "        --zone residential_proxy1 --type residential\n"
            "\n"
            "  Preview:\n"
            "    BRIGHTDATA_API_TOKEN='...' python -m scrapers.provision_brightdata_zones \\\n"
            "        --zone datacenter_proxy1 --type datacenter --dry-run\n"
        ),
    )
    parser.add_argument("--list", action="store_true", help="List all existing zones")
    parser.add_argument(
        "--zone", action="append", dest="zones", default=[],
        help="Zone name to create (repeatable with --type matching)",
    )
    parser.add_argument(
        "--type", action="append", dest="zone_types", default=[],
        help="Zone type for the preceding --zone (datacenter, residential)",
    )
    parser.add_argument("--delete", metavar="NAME", help="Delete a zone by name")
    parser.add_argument("--dry-run", action="store_true", help="Preview without making API calls")
    parser.add_argument("--api-token", default=None, help="API token (or set BRIGHTDATA_API_TOKEN env var)")

    args = parser.parse_args()
    token = args.api_token or API_TOKEN

    if not token:
        print(
            "ERROR: No API token provided. Set BRIGHTDATA_API_TOKEN or pass --api-token.",
            file=sys.stderr,
        )
        return 1

    print(f"BrightData Zone Management")
    print(f"  API base: {BRIGHTDATA_API_BASE}")
    print(f"  Token:    {token[:8]}...{token[-4:]}" if len(token) > 16 else f"  Token:    {token}")
    print(f"  Dry run:  {args.dry_run}")
    print()

    has_action = False

    if args.list:
        has_action = True
        print("Listing existing zones:")
        code, zones = list_zones(token)
        if code == 200 and zones is not None:
            for z in zones:
                name = z.get("name", "unknown")
                ztype = z.get("type", z.get("zone_type", "unknown"))
                print(f"  - {name} ({ztype})")
            if not zones:
                print("  (no zones found)")
        elif code in (401, 403):
            return 2
        else:
            print(f"  Failed: HTTP {code}", file=sys.stderr)
        print()

    if args.zones:
        has_action = True
        if args.zone_types:
            for name, ztype in zip(args.zones, args.zone_types):
                print(f"Creating zone: {name} (type={ztype})")
                create_zone(token, name, ztype, dry_run=args.dry_run)
                print()
        else:
            print("ERROR: --zone requires a matching --type argument.", file=sys.stderr)
            return 1

    if args.delete:
        has_action = True
        print(f"Deleting zone: {args.delete}")
        delete_zone(token, args.delete, dry_run=args.dry_run)
        print()

    if not has_action:
        parser.print_help()
        return 1

    if args.dry_run:
        print("[DRY RUN] No changes were made.")
    else:
        print("Done.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
