#!/usr/bin/env python3
import os
from urllib.parse import urlparse
import psycopg2

dsn = open('/home/paperclip/buywhere/data/.catalog_db_url').read().strip()
# Never print DSN. Sanitize env against the DATABASE_URL->roundhouse leak.
for k in list(os.environ.keys()):
    if 'DATABASE_URL' in k or 'ROUNDHOUSE' in os.environ.get(k, ''):
        os.environ.pop(k, None)

o = urlparse(dsn)
conn = psycopg2.connect(host=o.hostname, port=o.port, dbname=o.path.lstrip('/'),
                        user=o.username, password=o.password, connect_timeout=15)
cur = conn.cursor()
cur.execute("SELECT count(*) FROM merchants WHERE created_at > now() - interval '6 hours'")
print("merchants_created_6h:", cur.fetchone()[0])
cur.execute("SELECT count(*) FROM merchants WHERE created_at > now() - interval '24 hours'")
print("merchants_created_24h:", cur.fetchone()[0])
conn.close()
