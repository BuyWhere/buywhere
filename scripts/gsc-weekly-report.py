#!/usr/bin/env python3
"""gsc-weekly-report.py — Generate a weekly GSC report for buywhere.ai and write
it to work-products/BUY-23771/gsc-weekly-YYYY-MM-DD.md.

BUY-23771 A6 — weekly cadence. Posts a comparison vs the prior 7-day window
plus the current GSC sitemap submission state.

Requirements: PyJWT.

Env:
  GSC_SA_KEY        SA key path (default: /home/paperclip/.secrets/gsc-reader.json)
  GSC_SITE         Site URL form (default: sc-domain:buywhere.ai)
  OUTPUT_DIR       Where to write the markdown (default: work-products/BUY-23771)
  WEEK_END         YYYY-MM-DD (default: today UTC - 3 days, i.e. lag-safe end)

Usage:
  python3 scripts/gsc-weekly-report.py            # use default week-end
  WEEK_END=2026-08-23 python3 scripts/gsc-weekly-report.py
"""

import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

import jwt

GSC_SA_KEY = os.environ.get("GSC_SA_KEY", "/home/paperclip/.secrets/gsc-reader.json")
GSC_SITE = os.environ.get("GSC_SITE", "sc-domain:buywhere.ai")
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "work-products/BUY-23771")


def mint_token() -> str:
    data = json.load(open(GSC_SA_KEY))
    now = int(datetime.now(timezone.utc).timestamp())
    signed = jwt.encode(
        {"iss": data["client_email"],
         "scope": "https://www.googleapis.com/auth/webmasters",
         "aud": data["token_uri"],
         "iat": now, "exp": now + 3600},
        data["private_key"], algorithm="RS256")
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=f"grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion={signed}".encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())["access_token"]


def gsc_get(path: str, tok: str) -> dict:
    req = urllib.request.Request(
        f"https://www.googleapis.com/webmasters/v3{path}",
        headers={"Authorization": f"Bearer {tok}"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read() or b"{}")


def gsc_post(path: str, tok: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"https://www.googleapis.com/webmasters/v3{path}",
        data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read() or b"{}")


def search_analytics(start: str, end: str, tok: str,
                     dimensions=("date",)) -> dict:
    return gsc_post(
        f"/sites/{GSC_SITE}/searchAnalytics/query", tok,
        {"startDate": start, "endDate": end,
         "dimensions": list(dimensions), "rowLimit": 25,
         "aggregationType": "auto"})


def sum_rows(rows):
    clicks = sum(r.get("clicks", 0) for r in rows)
    imps = sum(r.get("impressions", 0) for r in rows)
    ctr = (sum(r.get("ctr", 0) * r.get("impressions", 0) for r in rows) / imps
           if imps else 0)
    pos = (sum(r.get("position", 0) * r.get("impressions", 0) for r in rows) / imps
           if imps else 0)
    return clicks, imps, ctr, pos


def fmt_pct(new, old):
    if not old:
        return "n/a"
    return f"{(new - old) / old * 100:+.1f}%"


def md_row(r):
    keys = r.get("keys", [""])
    return (f"| `{keys[0]}` | {r.get('clicks', 0)} | "
            f"{r.get('impressions', 0):,} | "
            f"{r.get('ctr', 0) * 100:.2f}% | "
            f"{r.get('position', 0):.1f} |")


def main():
    today_utc = datetime.now(timezone.utc).date()
    week_end_str = os.environ.get("WEEK_END")
    if week_end_str:
        week_end = datetime.strptime(week_end_str, "%Y-%m-%d").date()
    else:
        # GSC search analytics has ~3 day lag; default to today-3.
        week_end = today_utc - timedelta(days=3)
    week_start = week_end - timedelta(days=6)
    prior_end = week_start - timedelta(days=1)
    prior_start = prior_end - timedelta(days=6)

    tok = mint_token()
    this_w = search_analytics(week_start.isoformat(), week_end.isoformat(), tok)
    prev_w = search_analytics(prior_start.isoformat(), prior_end.isoformat(), tok)
    queries = search_analytics(week_start.isoformat(), week_end.isoformat(),
                               tok, ["query"])
    pages = search_analytics(week_start.isoformat(), week_end.isoformat(),
                             tok, ["page"])
    countries = search_analytics(week_start.isoformat(), week_end.isoformat(),
                                tok, ["country"])
    devices = search_analytics(week_start.isoformat(), week_end.isoformat(),
                               tok, ["device"])
    sitemaps = gsc_get(f"/sites/{GSC_SITE}/sitemaps", tok).get("sitemap", [])

    tw = sum_rows(this_w.get("rows", []))
    pw = sum_rows(prev_w.get("rows", []))

    sub = sorted([s for s in sitemaps if not s["path"].endswith("/sitemap.xml")],
                 key=lambda s: s["path"])
    submitted_total = sum(
        sum(int(c.get("submitted", 0)) for c in s.get("contents", []))
        for s in sub)
    indexed_total = sum(
        sum(int(c.get("indexed", 0)) for c in s.get("contents", []))
        for s in sub)
    errors_total = sum(int(s.get("errors", "0") or 0) for s in sub)

    lines = [
        f"# GSC weekly report — {week_start} → {week_end}",
        "",
        "Routine BUY-23771 A6 cadence report for the SEO/AEO plan. "
        f"Generated {datetime.now(timezone.utc).isoformat()}.",
        "",
        "## Executive summary",
        "",
        f"- Search clicks: **{tw[0]}** vs {pw[0]} prior week (**{fmt_pct(tw[0], pw[0])}**)",
        f"- Search impressions: **{tw[1]:,}** vs {pw[1]:,} prior week (**{fmt_pct(tw[1], pw[1])}**)",
        f"- Avg CTR: **{tw[2] * 100:.2f}%** vs {pw[2] * 100:.2f}% prior week (**{(tw[2] - pw[2]) * 100:+.2f}pp**)",
        f"- Avg position: **{tw[3]:.1f}** vs {pw[3]:.1f} prior week (**{tw[3] - pw[3]:+.1f}**)",
        f"- Sub-sitemap submitted URL total: **{submitted_total:,}**; indexed URL total: **{indexed_total:,}**",
        f"- Sitemap API errors: **{errors_total}** total across sub-sitemaps",
        "",
        "## Sitemap submission state",
        "",
        "| Sitemap | Last submitted | Submitted | Indexed | Errors | Warnings | Pending |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for s in sub:
        name = s["path"].split("/")[-1]
        submitted = sum(int(c.get("submitted", 0)) for c in s.get("contents", []))
        indexed = sum(int(c.get("indexed", 0)) for c in s.get("contents", []))
        lines.append(
            f"| `{name}` | {s.get('lastSubmitted', '')} | {submitted:,} | "
            f"{indexed:,} | {s.get('errors', '0')} | {s.get('warnings', '0')} | "
            f"{str(s.get('isPending', False)).lower()} |")

    def section(title, dim, rows):
        out = [f"## {title}", ""]
        out.append("| " + dim.title() + " | Clicks | Impressions | CTR | Avg position |")
        out.append("|---|---:|---:|---:|---:|")
        for r in rows[:10]:
            out.append(md_row(r))
        return out

    lines.append("")
    lines.append("## Search performance by day")
    lines.append("")
    lines.append("| Date | Clicks | Impressions | CTR | Avg position |")
    lines.append("|---|---:|---:|---:|---:|")
    for r in this_w.get("rows", []):
        lines.append(md_row(r))

    lines.extend(section("Top queries", "query",
                         queries.get("rows", [])))
    lines.extend(section("Top pages", "page",
                         pages.get("rows", [])))
    lines.extend(section("Top countries", "country",
                         countries.get("rows", [])))
    lines.extend(section("Top devices", "device",
                         devices.get("rows", [])))

    lines.extend([
        "",
        "## Source / method",
        "",
        f"- Site property: `{GSC_SITE}`",
        f"- GSC service account: `{GSC_SA_KEY}`",
        f"- Search analytics windows: current {week_start}→{week_end}; prior {prior_start}→{prior_end}",
        "- Sitemap state: GSC Webmasters API",
    ])

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    out_path = os.path.join(OUTPUT_DIR, f"gsc-weekly-{week_end.isoformat()}.md")
    with open(out_path, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(out_path)


if __name__ == "__main__":
    main()
