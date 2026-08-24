import { db } from '../config';
import { classifyProbeResult, outboundProbeEnabled, UrlProbeStatus } from '../lib/outboundLinkHealth';

const BATCH_SIZE = Math.max(1, Math.min(Number(process.env.OUTBOUND_PROBE_BATCH_SIZE) || 100, 1000));
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.OUTBOUND_PROBE_CONCURRENCY) || 8, 32));
const TIMEOUT_MS = Math.max(1000, Number(process.env.OUTBOUND_PROBE_TIMEOUT_MS) || 10000);
const USER_AGENT = process.env.OUTBOUND_PROBE_UA || 'BuyWhereBot/1.0 (+https://buywhere.ai; outbound-link-health)';
const REFERER = process.env.OUTBOUND_PROBE_REFERER || 'https://buywhere.ai/';
const COUNTRY = (process.env.OUTBOUND_PROBE_COUNTRY || '').toUpperCase();

interface ProbeRow {
  id: string;
  merchant_id: string | null;
  url: string;
}

interface ProbeResult {
  productId: string;
  merchantId: string | null;
  url: string;
  status: UrlProbeStatus;
  reason: string;
  httpStatus: number | null;
  latencyMs: number;
  error: string | null;
}

async function fetchDueRows(): Promise<ProbeRow[]> {
  const params: unknown[] = [BATCH_SIZE];
  let countryFilter = '';
  if (COUNTRY) {
    params.push(COUNTRY);
    countryFilter = `AND country_code = $${params.length}`;
  }

  // Avoid global ORDER BY on the 400GB products heap. The cron is continuous and
  // bounded; an unordered LIMIT lets Postgres stop as soon as it has a batch, while
  // still prioritizing never-checked rows before stale rechecks.
  const neverChecked = await db.query<ProbeRow>(
    `SELECT id::text, merchant_id, url
       FROM products
      WHERE is_active = true
        AND url IS NOT NULL
        AND url_last_checked_at IS NULL
        ${countryFilter}
      LIMIT $1`,
    params
  );
  if (neverChecked.rows.length >= BATCH_SIZE) return neverChecked.rows;

  const staleParams: unknown[] = [BATCH_SIZE - neverChecked.rows.length];
  let staleCountryFilter = '';
  if (COUNTRY) {
    staleParams.push(COUNTRY);
    staleCountryFilter = `AND country_code = $${staleParams.length}`;
  }
  const stale = await db.query<ProbeRow>(
    `SELECT id::text, merchant_id, url
       FROM products
      WHERE is_active = true
        AND url IS NOT NULL
        AND url_last_checked_at < NOW() - INTERVAL '24 hours'
        ${staleCountryFilter}
      LIMIT $1`,
    staleParams
  );
  return [...neverChecked.rows, ...stale.rows];
}

async function probe(row: ProbeRow): Promise<ProbeResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(row.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': REFERER,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    const classification = classifyProbeResult({ statusCode: response.status, headers: response.headers });
    return {
      productId: row.id,
      merchantId: row.merchant_id,
      url: row.url,
      status: classification.status,
      reason: classification.reason,
      httpStatus: response.status,
      latencyMs: Date.now() - started,
      error: null,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const timedOut = error.name === 'AbortError';
    const classification = classifyProbeResult({ error, timedOut });
    return {
      productId: row.id,
      merchantId: row.merchant_id,
      url: row.url,
      status: classification.status,
      reason: classification.reason,
      httpStatus: null,
      latencyMs: Date.now() - started,
      error: error.message.slice(0, 500),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function persist(result: ProbeResult): Promise<void> {
  try {
    await db.query(
      `INSERT INTO url_probe_log
         (product_id, merchant_id, url, status, reason, http_status, latency_ms, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [result.productId, result.merchantId, result.url, result.status, result.reason, result.httpStatus, result.latencyMs, result.error]
    );
  } catch (err) {
    console.warn('[outbound-probe] url_probe_log insert failed (continuing with product status update):', (err as Error).message);
  }

  await db.query(
    `UPDATE products
        SET url_status = $2,
            url_status_reason = $3,
            url_last_checked_at = NOW(),
            url_dead_at = CASE
              WHEN $2 = 'dead' AND url_status <> 'dead' THEN NOW()
              WHEN $2 = 'dead' THEN COALESCE(url_dead_at, NOW())
              ELSE NULL
            END
      WHERE id = $1`,
    [result.productId, result.status, result.reason]
  );
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  }));
}

export async function runOutboundLinkProbeBatch(): Promise<{ scanned: number; ok: number; dead: number; transient: number }> {
  if (!outboundProbeEnabled()) {
    console.log('[outbound-probe] disabled: set PROBE_OUTBOUND_LINKS=1 to run');
    return { scanned: 0, ok: 0, dead: 0, transient: 0 };
  }

  const rows = await fetchDueRows();
  const counts = { scanned: rows.length, ok: 0, dead: 0, transient: 0 };
  await runPool(rows, async (row) => {
    const result = await probe(row);
    await persist(result);
    counts[result.status] += 1;
    console.log(`[outbound-probe] ${result.status} product=${result.productId} http=${result.httpStatus ?? 'n/a'} ${result.latencyMs}ms reason=${result.reason}`);
  });
  return counts;
}

if (require.main === module) {
  runOutboundLinkProbeBatch()
    .then((counts) => {
      console.log('[outbound-probe] done', counts);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[outbound-probe] failed:', err);
      process.exit(1);
    });
}
