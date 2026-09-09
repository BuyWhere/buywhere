#!/usr/bin/env python3
"""BUY-80623 hourly top-K refresh for search_products_smoke_rank.

Id-only GIN (LIMIT 20) + PK hydrate. Child-table fallback if GIN times out.
Never CLUSTER / VACUUM FULL / roundhouse.
"""
from __future__ import annotations
import os, sys, time
import psycopg2

QUERIES = ("shirt", "phone", "nike", "laptop")
COUNTRIES = ("SG", "MY", "TH", "VN", "ID", "PH", "US")


def dsn() -> str:
    raw = os.environ.get("BUYWHERE_DATABASE_URL") or os.environ.get("DATABASE_URL") or ""
    if not raw:
        raise SystemExit("BUYWHERE_DATABASE_URL not set")
    low = raw.lower()
    if "roundhouse" in low or "paperclip" in low:
        raise SystemExit("refusing control-plane DSN")
    if "sakura" not in low:
        print("warn: DSN host is not sakura", file=sys.stderr)
    return raw.split("?")[0]


def main() -> None:
    conn = psycopg2.connect(dsn())
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SET application_name='ops-ddl'")
    t_all = time.time()
    filled = 0
    for cc in COUNTRIES:
        for q in QUERIES:
            t0 = time.time()
            ids = []
            cur.execute("SET statement_timeout='8s'")
            try:
                cur.execute(
                    """SELECT id FROM search_products
                       WHERE country_code=%s AND search_vector @@ plainto_tsquery('english', %s)
                       LIMIT 20""",
                    (cc, q),
                )
                ids = [r[0] for r in cur.fetchall()]
            except Exception as e:
                conn.rollback()
                cur.execute("SET application_name='ops-ddl'")
                print(f"gin-timeout {cc} {q}: {str(e).splitlines()[0][:80]}")
                try:
                    cur.execute("SET statement_timeout='4s'")
                    cur.execute(
                        f"""SELECT id FROM products_partitioned_{cc.lower()}
                            WHERE search_vector @@ plainto_tsquery('english', %s)
                            LIMIT 20""",
                        (q,),
                    )
                    ids = [r[0] for r in cur.fetchall()]
                except Exception as e2:
                    conn.rollback()
                    cur.execute("SET application_name='ops-ddl'")
                    print(f"child-timeout {cc} {q}: {str(e2).splitlines()[0][:80]}")
                    continue
            rows = []
            for pid in ids:
                cur.execute("SET statement_timeout='3s'")
                try:
                    cur.execute(
                        """SELECT sku, source, merchant_id, title, brand, category, price, currency,
                                  in_stock, image_url, url, region, updated_at
                             FROM search_products WHERE id=%s""",
                        (pid,),
                    )
                    r = cur.fetchone()
                except Exception:
                    conn.rollback()
                    cur.execute("SET application_name='ops-ddl'")
                    r = None
                if not r:
                    continue
                if r[6] is None:
                    continue
                rows.append((pid, *r))
            if len(rows) < 5:
                print(f"skip {cc} {q}: n={len(rows)} {time.time()-t0:.2f}s")
                continue
            cur.execute("SET statement_timeout='4s'")
            cur.execute(
                "DELETE FROM search_products_smoke_rank WHERE query=%s AND country_code=%s",
                (q, cc),
            )
            for rank, r in enumerate(rows, 1):
                cur.execute(
                    """INSERT INTO search_products_smoke_rank
                       (query,country_code,rank,product_id,sku,source,merchant_id,title,brand,category,
                        price,currency,in_stock,image_url,url,region,updated_at,refreshed_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now())""",
                    (q, cc, rank, *r),
                )
            filled += 1
            print(f"ok {cc} {q}: n={len(rows)} {time.time()-t0:.2f}s")
    print(f"done pairs={filled} {time.time()-t_all:.1f}s")


if __name__ == "__main__":
    main()
