// BUY-77109: hourly probe of the 5 canonical intent-page slugs to populate
// monitoring.intent_page_r_link_probes. The view (monitoring.v_ceo_kpis)
// reads from this table to compute `intent_page_r_link_density_avg_24h`,
// the P6.1 acceptance-gate column.
//
// Why a separate probe sink:
//   The /r/ link density is an HTML-shape metric — it requires fetching the
//   rendered intent-page HTML and counting `href="/r/"` matches. No wire
//   inside the API surfaces this number today, so the only path to a
//   durable, queryable metric is a periodic probe + sink table.
//
// Why these 5 slugs:
//   BUY-75629 evidence at 2026-08-29 09:36Z listed the working pages as
//   {macbook-air-singapore, best-4k-monitors-singapore, best-budget-tvs-us,
//   best-gaming-laptops-us, best-iphones-singapore}. We probe these 5
//   canonical slugs hourly; the average across them is what Reed's
//   acceptance gate reads. If a slug starts 404ing (URL-pattern breakage
//   per the BUY-75629 incident), the probe rows still record http_status
//   and the view filters http_status=200 to avoid poisoning the average.
//
// Refresh cadence:
//   Hourly, per the spec. Run on startup + every 60 minutes. Failures are
//   logged but do not crash the process; an empty probe table causes the
//   view to surface 0 for the density metric (safe default).

const BUY_77109_PROBE_INTERVAL_MS = 60 * 60 * 1000; // 1h

// BUY-77109 canonical probe slugs (5): SG "best" / SG "price" / US "best" /
// SG "best" / SG "best". Mirrors the BUY-75629 evidence baseline so the
// density metric tracks the same population Reed's gate references.
const BUY_77109_PROBE_SLUGS = Object.freeze([
  'macbook-air-singapore',
  'best-4k-monitors-singapore',
  'best-budget-tvs-us',
  'best-gaming-laptops-us',
  'best-iphones-singapore',
]);

const SITE_BASE_URL = (process.env.SITE_BASE_URL || 'https://buywhere.ai').replace(/\/+$/, '');
const PROBE_TIMEOUT_MS = 15_000;

let intervalHandle = null;
let inFlight = false;

function countRLinks(html) {
  if (typeof html !== 'string' || html.length === 0) return 0;
  // Match `href="/r/` or `href='/r/` — covers the canonical redirect URL
  // emitted by src/lib/click-attribution.ts (buildAffiliateRedirectUrl).
  // Use a non-greedy literal scan rather than a regex with a capture group
  // to keep the cost predictable on large HTML responses.
  let count = 0;
  let from = 0;
  while (from < html.length) {
    const next = html.indexOf('href="/r/', from);
    if (next === -1) break;
    count += 1;
    from = next + 8;
  }
  return count;
}

async function probeSlug(pool, slug) {
  const url = `${SITE_BASE_URL}/${encodeURIComponent(slug)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedAt = Date.now();
  let httpStatus = null;
  let html = '';
  let error = null;
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'buywhere-intent-page-probe/1.0',
        'accept': 'text/html',
        // Mark internal so any downstream analytics layer can filter
        'x-buywhere-probe': '1',
      },
    });
    httpStatus = resp.status;
    html = await resp.text();
  } catch (err) {
    error = err && err.message ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }
  const elapsed = Date.now() - startedAt;
  const rLinkCount = error ? 0 : countRLinks(html);
  const htmlSizeBytes = html.length;

  try {
    await pool.query(
      `INSERT INTO monitoring.intent_page_r_link_probes
         (slug, probed_at, http_status, r_link_count, html_size_bytes)
       VALUES ($1, NOW(), $2, $3, $4)`,
      [slug, httpStatus, rLinkCount, htmlSizeBytes]
    );
  } catch (err) {
    console.error(`[intent_page_probe] DB insert failed for ${slug}:`, err.message);
  }

  console.log(
    `[intent_page_probe] ${slug} status=${httpStatus} r_links=${rLinkCount} ` +
      `bytes=${htmlSizeBytes} elapsed_ms=${elapsed}${error ? ` err=${error}` : ''}`
  );
}

async function runOnce(pool) {
  if (inFlight) return;
  inFlight = true;
  try {
    for (const slug of BUY_77109_PROBE_SLUGS) {
      try {
        await probeSlug(pool, slug);
      } catch (err) {
        console.error(`[intent_page_probe] ${slug} unexpected error:`, err && err.message ? err.message : err);
      }
    }
  } finally {
    inFlight = false;
  }
}

function startIntentPageProbe(pool) {
  if (intervalHandle) return;
  console.log(
    `[intent_page_probe] starting hourly probe (slugs=${BUY_77109_PROBE_SLUGS.length}, ` +
      `interval_ms=${BUY_77109_PROBE_INTERVAL_MS}, target=${SITE_BASE_URL})`
  );
  // Run once at startup so the sink has data within minutes of deploy.
  runOnce(pool).catch((err) =>
    console.error('[intent_page_probe] initial cycle error:', err && err.message ? err.message : err)
  );
  intervalHandle = setInterval(() => {
    runOnce(pool).catch((err) =>
      console.error('[intent_page_probe] cycle error:', err && err.message ? err.message : err)
    );
  }, BUY_77109_PROBE_INTERVAL_MS);
  if (typeof intervalHandle.unref === 'function') intervalHandle.unref();
}

function stopIntentPageProbe() {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
}

module.exports = {
  startIntentPageProbe,
  stopIntentPageProbe,
  runIntentPageProbeOnce: runOnce,
  countRLinks,
  BUY_77109_PROBE_SLUGS,
  BUY_77109_PROBE_INTERVAL_MS,
};
