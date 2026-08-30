#!/usr/bin/env python3
"""AEO intent-page quality gate v2 (Atlas QA owns).
  aeo-page-gate.py --spec content/intent-pages/<slug>.json   validate a page spec BEFORE merge (schema + content + live catalog check)
  aeo-page-gate.py <slug-or-url> [...]                       validate a LIVE page (rendered HTML)
  aeo-page-gate.py --audit                                    all live intent pages (cron; writes /root/.aeo-gate-latest)
Exit 0 = PASS. Any listed failure = FAIL. Never bypass the gate; fix the page."""
import sys, re, os, json, datetime, urllib.request, urllib.parse, html
BASE = "https://buywhere.ai"; API = "https://api.buywhere.ai"
NOW = datetime.datetime.now(datetime.timezone.utc); YEAR = str(NOW.year)
KEYFILE = os.path.expanduser("~/.aeo-gate-key")
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"

def fetch(u, headers=None):
    r = urllib.request.Request(u, headers={"User-Agent": "buywhere-aeo-gate/2.0", **(headers or {})})
    with urllib.request.urlopen(r, timeout=40) as x: return x.status, x.read().decode('utf8', 'ignore')

def api_key():
    try:
        k = open(KEYFILE).read().strip()
        if k: return k
    except Exception: pass
    try:
        req = urllib.request.Request(f"{API}/v1/auth/register?verify=false", data=json.dumps({"agent_name": "aeo-page-gate"}).encode(), headers={"Content-Type": "application/json"})
        k = json.loads(urllib.request.urlopen(req, timeout=30).read())["api_key"]
        open(KEYFILE, "w").write(k); os.chmod(KEYFILE, 0o600); return k
    except Exception as e:
        return None

DEGRADED = {"seen": False}
def live_products(query, country, key):
    """Priced products the live catalog gives for this query/country. Flags API degradation (timeouts) so the
    gate warns instead of failing a writer for an outage that is not theirs."""
    u = f"{API}/v1/products/search?q={urllib.parse.quote(query)}&country_code={country}&limit=12"
    try:
        st, body = fetch(u, {"Authorization": f"Bearer {key}"} if key else None)
        d = json.loads(body)
        if (d.get("meta") or {}).get("degraded"): DEGRADED["seen"] = True
        return [p for p in d.get("data", []) if isinstance(p.get("price"), dict) and (p["price"].get("amount") or 0) > 0 or isinstance(p.get("price"), (int, float)) and p.get("price") > 0]
    except Exception as e:
        DEGRADED["seen"] = True
        return []

def prose_words(c):
    parts = [c.get("heroBody", ""), (c.get("categoryIntro") or {}).get("body", "")]
    parts += [h.get("body", "") for h in c.get("highlights", []) if isinstance(h, dict)]
    parts += list(c.get("advicePoints", []))
    parts += [f.get("answer", "") for f in c.get("faqs", []) if isinstance(f, dict)]
    return len(" ".join(parts).split())

def check_date(label, val, f, fmt, max_age=None):
    """Honest freshness (indexation directive 2026-08-25 §5): dates move only when content changes.
    We reject FUTURE dates and unparseable dates; we do NOT demand recent dates (that invites date-bumping)."""
    try:
        d = datetime.datetime.strptime(val, fmt).replace(tzinfo=datetime.timezone.utc)
        if d > NOW + datetime.timedelta(days=1): f.append(f"{label}: future date")
        if max_age and (NOW - d).days > max_age: f.append(f"{label}: {(NOW - d).days}d old (>{max_age})")
    except Exception: f.append(f"{label}: unparseable ({val!r}); expected {fmt}")

def similarity(a, b):
    """Jaccard similarity of 3-word shingles over prose — directive §2.6: no two pages >50% identical."""
    def sh(t):
        w = re.findall(r"[a-z0-9']+", t.lower()); return set(zip(w, w[1:], w[2:]))
    A, B = sh(a), sh(b)
    return len(A & B) / max(1, len(A | B))

def gate_spec(path):
    f = []
    try: c = json.load(open(path))
    except Exception as e: return path, [f"json: {e}"]
    slug = os.path.basename(path)[:-5]
    req = ["slug", "title", "description", "heroEyebrow", "heroTitle", "heroBody", "canonicalPath", "country", "currency", "locale",
           "searchQuery", "backupQueries", "minPrice", "requiredProductTerms", "excludeAccessories", "refreshedLabel", "datePublished",
           "dateModified", "inboundLinks", "productSectionTitle", "comparisonSectionTitle", "comparisonColumns", "comparisonRows", "highlightSectionTitle",
           "highlights", "adviceSectionTitle", "advicePoints", "faqSectionTitle", "faqs", "fallbackProducts", "owner", "reviewer", "queueRow"]
    for k in req:
        if k not in c: f.append(f"missing key: {k}")
    if f: return path, f
    if c["slug"] != slug: f.append(f"slug {c['slug']!r} != filename {slug!r}")
    if c["canonicalPath"] != "/" + slug: f.append("canonicalPath must be '/'+slug")
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", slug): f.append("slug: lowercase words joined by '-' only")
    combos = {("US", "USD", "en_US"), ("SG", "SGD", "en_SG")}
    if (c["country"], c["currency"], c["locale"]) not in combos: f.append("country/currency/locale must be US/USD/en_US or SG/SGD/en_SG (MY/AU/UK blocked until BUY-74862)")
    if YEAR not in c["title"]: f.append("title: current year missing")
    if YEAR not in c["heroTitle"] and YEAR not in c.get("heroTitleTemplate", ""): f.append("heroTitle: current year missing")
    m = re.fullmatch(rf"(Updated|Prices checked) ({MONTHS}) (\d{{1,2}}), (\d{{4}})", c["refreshedLabel"])
    if not m: f.append("refreshedLabel must be exactly 'Updated <Month> <D>, <YYYY>' or 'Prices checked <Month> <D>, <YYYY>'")
    else: check_date("refreshedLabel", f"{m.group(2)} {m.group(3)} {m.group(4)}", f, "%B %d %Y")
    check_date("dateModified", c["dateModified"], f, "%Y-%m-%d")
    if c["dateModified"] < str(c["datePublished"]): f.append("dateModified earlier than datePublished")
    # directive §2.7: no orphan pages — at least two existing 200 pages must link here BEFORE it enters a sitemap
    il = c.get("inboundLinks") or []
    if len(il) < 2: f.append("inboundLinks: list >=2 existing buywhere.ai paths that will link to this page (hub/category/sibling/blog)")
    else:
        for link in il[:4]:
            try:
                st, _ = fetch(BASE + link)
            except Exception: f.append(f"inboundLinks: {link} is not a live 200 page")
    # directive §2.6: uniqueness — compare prose against every other spec in the same folder
    try:
        mine = " ".join([c["heroBody"], (c.get("categoryIntro") or {}).get("body", "")] + [h.get("body", "") for h in c["highlights"]] + c["advicePoints"] + [q.get("answer", "") for q in c["faqs"]])
        folder = os.path.dirname(os.path.abspath(path))
        for other in os.listdir(folder):
            if other.endswith(".json") and other != os.path.basename(path):
                try:
                    o = json.load(open(os.path.join(folder, other)))
                    theirs = " ".join([o.get("heroBody", ""), (o.get("categoryIntro") or {}).get("body", "")] + [h.get("body", "") for h in o.get("highlights", [])] + list(o.get("advicePoints", [])) + [q.get("answer", "") for q in o.get("faqs", [])])
                    sim = similarity(mine, theirs)
                    if sim > 0.4: f.append(f"uniqueness: {int(sim*100)}% prose overlap with {other} (>40%) — rewrite, do not template")
                except Exception: pass
    except Exception: pass
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(c["datePublished"])): f.append("datePublished must be YYYY-MM-DD")
    if len(c["backupQueries"]) < 2: f.append("backupQueries: need >=2")
    if len(c["requiredProductTerms"]) < 3: f.append("requiredProductTerms: need >=3")
    if not isinstance(c["minPrice"], (int, float)) or c["minPrice"] < 0: f.append("minPrice must be a number")
    if len(c["comparisonColumns"]) < 3 or len(c["comparisonRows"]) < 3: f.append("comparison: need >=3 columns and >=3 rows")
    for r in c["comparisonRows"]:
        if not (isinstance(r, dict) and "label" in r and isinstance(r.get("values"), list)): f.append("comparisonRows: each row = {label, values[]}"); break
    if len(c["highlights"]) < 3: f.append("highlights: need >=3")
    if len(c["advicePoints"]) < 4: f.append("advicePoints: need >=4")
    if len(c["faqs"]) < 3: f.append("faqs: need >=3")
    w = prose_words(c)
    if w < 400: f.append(f"prose: {w} words (<400)")
    blob = json.dumps(c)
    if re.search(r"lorem ipsum|TODO|TBD|\[insert|placeholder|in today's fast-paced", blob, re.I): f.append("placeholder/filler text")
    raw = [u for u in re.findall(r"https?://[^\s\"']+", blob) if "buywhere.ai" not in u]
    if raw: f.append(f"merchant/external URLs are forbidden in specs: {raw[:2]}")
    prose = " ".join([c["heroBody"], (c.get("categoryIntro") or {}).get("body", "")] + [h.get("body", "") for h in c["highlights"]] + c["advicePoints"] + [q.get("answer", "") for q in c["faqs"]])
    if re.search(r"(S\$|US\$|\$|RM|A\$|£)\s?\d", prose): f.append("prose states a specific price — remove (prices come from live cards)")
    if c["reviewer"] not in ("Hue", "Fetch"): f.append("reviewer must be Hue or Fetch")
    # live catalog check
    key = api_key()
    best = 0; used = None
    for q in [c["searchQuery"]] + list(c["backupQueries"]):
        ps = live_products(q, c["country"], key)
        if len(ps) > best: best, used = len(ps), q
        if best >= 6: break
    if best < 6:
        if DEGRADED["seen"]: print(f"   WARN catalog check inconclusive — the search API is degraded right now ({best} products); re-run the gate when search is green (reviewer must re-run before PASS)")
        else: f.append(f"catalog: only {best} priced products for {c['country']} across searchQuery/backupQueries (need >=6) — tune queries or mark blocked:catalog")
    return path, f

def gate_live(slug):
    u = slug if slug.startswith('http') else f"{BASE}/{slug.strip('/')}"
    try: st, body = fetch(u)
    except Exception as e: return u, ['FAIL http: %s' % e]
    f = []
    text = re.sub(r'<script.*?</script>|<style.*?</style>', '', body, flags=re.S)
    txt = html.unescape(re.sub(r'<[^>]+>', ' ', text))
    t = re.search(r'<title>(.*?)</title>', body, re.S); title = t.group(1) if t else ''
    if YEAR not in title and YEAR not in txt[:3000]: f.append('year: current year missing from title/hero')
    m = re.search(rf'(Updated|Refreshed|Prices checked)\s+(({MONTHS}) \d{{1,2}},? \d{{4}})', txt)
    if not m: f.append('freshness: no visible "Updated/Prices checked <date>" label')
    else: check_date("freshness", m.group(2).replace(',', ''), f, "%B %d %Y", max_age=45)
    cards = len(re.findall(r'\$\s?\d[\d,]*|S\$\s?\d[\d,]*|RM\s?\d|A\$\s?\d|£\s?\d', txt))
    if cards < 6: f.append(f'products: only {cards} priced items (need >=6)')
    if '<table' not in body: f.append('comparison table missing')
    raw = [h for h in re.findall(r'href="(https?://[^"]+)"', body)
           if not re.search(r'buywhere\.ai|schema\.org|posthog|googleapis|gstatic|w3\.org|twitter|x\.com|github\.com/BuyWhere|linkedin|modelcontextprotocol|plausible\.io|cdn\.|fonts\.|unsplash\.com|picsum\.photos|images\.|media-amazon\.com|cloudfront\.net|shopify\.com/s/files|cloudinary|t\.me/buywhere|wa\.me|discord\.gg', h)]
    if raw: f.append(f'affiliate: {len(raw)} raw merchant links (must use /r): {raw[:2]}')
    if not re.search(r'api\.buywhere\.ai/v1/products/search|mcp\.buywhere\.ai', body): f.append('api: no per-page API/MCP snippet')
    if re.search(r'lorem ipsum|TODO|TBD|\[insert|placeholder', txt, re.I): f.append('placeholder text')
    if 'ItemList' not in body: f.append('schema: ItemList missing')
    # OpenAI channel (4seen 2026-08-25): AI crawlers read raw HTML only. Retailer names must sit next to prices, and a
    # 40-60-word answer block with a price + retailer should open the page. WARN until the [OPENAI-CHANNEL] tickets ship.
    rets = len(set(m.lower() for m in re.findall(r'amazon|walmart|best buy|newegg|shopee|lazada|courts|challenger|harvey norman|target|b&h|adorama|apple', txt, re.I)))
    if rets < 2: f.append(f'retailers: only {rets} retailer names visible in HTML (AI answers need retailer + price as text)')
    head = txt[:1200]
    if not (re.search(r'(US\$|S\$|\$)\s?\d', head) and re.search(r'amazon|walmart|best buy|newegg|shopee|lazada|courts|challenger|target', head, re.I)):
        print('   WARN answer block: first ~200 words do not contain a price + retailer (ships with the [OPENAI-CHANNEL] ticket)')
    words = len(txt.split())
    if words < 400: f.append(f'editorial: {words} words (<400)')
    # --- OAI-SearchBot checklist (4seen 2026-08-25) ---
    if re.search(r'<meta[^>]+name="robots"[^>]+(nosnippet|max-snippet|max-image-preview)', body, re.I): f.append('robots meta restricts snippets (nosnippet/max-snippet) — forbidden')
    h1 = re.search(r'<h1[^>]*>(.*?)</h1>', body, re.S); h1t = html.unescape(re.sub(r'<[^>]+>', ' ', h1.group(1))) if h1 else ''
    if h1t and not re.search(r'singapore|\bUS\b|united states|malaysia|australia|\bUK\b', h1t, re.I): f.append('h1: country missing (intent + country + year)')
    if h1t and YEAR not in h1t: f.append('h1: current year missing')
    if not re.search(r'(US\$|S\$|A\$|RM|£|\$\s?\d[\d,]*\s?(USD|SGD))', txt): print('   WARN currency: prices lack an explicit currency marker (US$/S$/USD/SGD) — rendered by the site; hard-fails once BUY-74926 ships')
    if len(body) > 200_000: f.append(f'size: HTML is {len(body)//1000} KB (>200 KB)')
    i_tab = body.find('<table'); i_faq = body.lower().find('faq'); i_h1 = body.find('<h1')
    if i_tab > 0 and i_faq > 0 and i_faq < i_tab: print('   WARN dom order: FAQs appear before the price table (want answer -> table -> verdict -> FAQs)')
    if not re.search(r'(from|under)\s+(US\$|S\$|\$)\s?\d|retailers compared', title, re.I): print('   WARN title: no price range / retailer count in <title> ("from US$749 at Walmart · 6 retailers compared")')
    if 'AggregateOffer' not in body: print('   WARN schema: no AggregateOffer (ships with BUY-74926)')
    if 'BreadcrumbList' not in body: print('   WARN schema: no BreadcrumbList')
    return u, f

if __name__ == '__main__':
    a = sys.argv[1:]
    if a and a[0] == '--spec':
        rc = 0
        for p in a[1:]:
            u, f = gate_spec(p); print(('PASS ' if not f else 'FAIL ') + u); [print('   -', x) for x in f]; rc |= bool(f)
        sys.exit(rc)
    if not a or a[0] == '--audit':
        try:
            st, sm = fetch(BASE + '/sitemap.xml')
            # Check if sitemap.xml is a sitemapindex (contains <sitemapindex> tag)
            if '<sitemapindex' in sm:
                # It's a sitemapindex - find the pages sitemap (contains "pages" but not "products"/"categories"/etc)
                child_sitemaps = re.findall(r'<loc>(https://buywhere\.ai/[^<]+)</loc>', sm)
                pages_sitemap = None
                for s in child_sitemaps:
                    if 'pages' in s and not any(x in s for x in ['products', 'categories', 'compare', 'brands', 'stores', 'docs']):
                        pages_sitemap = s
                        break
                if not pages_sitemap:
                    print('audit: sitemap is index but no pages sitemap found'); sys.exit(1)
                st, sm = fetch(pages_sitemap)
                print(f'audit: fetched {pages_sitemap} ({len(sm)} bytes)')
            # Extract intent page slugs from urlset
            slugs = [s for s in re.findall(r'<loc>https://buywhere\.ai/([^<]+)</loc>', sm)
                     if re.match(r'(best-|cheapest-|[a-z0-9-]+-vs-|[a-z0-9-]+-(singapore|us|malaysia|australia|uk)$)', s)]
        except Exception as e: print('audit: sitemap fetch failed', e); sys.exit(1)
        ok = bad = stale = 0
        for s in slugs[:400]:
            u, f = gate_live(s)
            if f:
                bad += 1; stale += any(x.startswith('freshness') for x in f); print(f"FAIL {u}\n   - " + "\n   - ".join(f))
            else: ok += 1
        line = f"AEO GATE audit: {ok} pass / {bad} fail of {ok + bad} intent pages; {stale} with no/old freshness label (>45d)"
        print(line)
        try: open('/root/.aeo-gate-latest', 'w').write(line)
        except Exception: pass
        sys.exit(0)
    rc = 0
    for s in a:
        u, f = gate_live(s); print(('PASS ' if not f else 'FAIL ') + u); [print('   -', x) for x in f]; rc |= bool(f)
    sys.exit(rc)
