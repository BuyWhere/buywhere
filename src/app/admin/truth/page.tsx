// BUY-75314 / BUY-75315: /admin/truth UI — canonical metrics per
// /home/paperclip/ops-canon/METRICS-DEFINITIONS.md. Gated by ADMIN_UI_KEY query
// param; values come from the existing /admin/kpi-history endpoint and the
// catalog /v1/catalog/stats endpoint. The metric definition is shown next to
// every number so anyone reading can verify the source.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { notFound } from 'next/navigation';

type KpiRow = {
  day: string;
  total_calls: number | string | null;
  calls_external: number | string | null;
  search_calls: number | string | null;
  zero_result_calls: number | string | null;
  search_success_pct: number | string | null;
  p50_ms: number | string | null;
  p95_ms: number | string | null;
  products_est: number | string | null;
  merchants_total: number | string | null;
  merchants_monetizable: number | string | null;
  clicks_total: number | string | null;
  active_ext_keys: number | string | null;
  dev_keys_external: number | string | null;
};

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

interface TruthRow {
  label: string;
  value: string;
  definition: string;
  source: string;
}

async function loadTruthRows(): Promise<{ rows: TruthRow[]; day: string; fetchErrors: string[] }> {
  const fetchErrors: string[] = [];
  const rows: TruthRow[] = [];

  let kpiRows: KpiRow[] = [];
  try {
    const r = await fetch('https://api.buywhere.ai/admin/kpi-history?days=1', {
      headers: { Authorization: `Bearer ${process.env.ADMIN_API_KEY || ''}` },
      cache: 'no-store',
    });
    if (!r.ok) {
      fetchErrors.push(`kpi-history API ${r.status}`);
    } else {
      kpiRows = ((await r.json()) as { data?: KpiRow[] }).data || [];
    }
  } catch (e) {
    fetchErrors.push(e instanceof Error ? e.message : 'kpi-history fetch failed');
  }

  const today = kpiRows[kpiRows.length - 1] || null;

  // Catalog (truth from live stats endpoint)
  let catalogRows: number | null = null;
  let catalogMerchants: number | null = null;
  try {
    const r = await fetch('https://api.buywhere.ai/v1/catalog/stats', {
      headers: { Authorization: `Bearer ${process.env.ADMIN_API_KEY || ''}` },
      cache: 'no-store',
    });
    if (!r.ok) {
      fetchErrors.push(`catalog/stats API ${r.status}`);
    } else {
      const body = (await r.json()) as { products?: { count?: number }; merchants?: { count?: number }; total_products?: number; total_merchants?: number };
      catalogRows = num(body.products?.count) ?? num(body.total_products);
      catalogMerchants = num(body.merchants?.count) ?? num(body.total_merchants);
    }
  } catch (e) {
    fetchErrors.push(e instanceof Error ? e.message : 'catalog/stats fetch failed');
  }

  const day = today?.day ? String(today.day).slice(0, 10) : 'n/a';

  rows.push({
    label: 'Catalog rows (live)',
    value: catalogRows !== null ? fmtCompact(catalogRows) : 'n/a — see fetch errors',
    definition: 'Live count of product rows. Source: GET /v1/catalog/stats. Exact COUNT(*) is banned in the catalog DB; this endpoint returns the cached/sampled count. If unreachable, report n/a.',
    source: 'GET /v1/catalog/stats',
  });
  rows.push({
    label: 'Merchants with products',
    value: catalogMerchants !== null ? fmtCompact(catalogMerchants) : 'n/a',
    definition: 'Merchants with at least one product row. Never the 943K funnel total. Source: GET /v1/catalog/stats merchants.count.',
    source: 'GET /v1/catalog/stats',
  });
  rows.push({
    label: 'External API/MCP requests (today)',
    value: today ? fmtCompact(num(today.calls_external) || 0) : 'n/a',
    definition: 'External request = query_log row whose key is not is_internal and whose name/email matches none of the probe patterns. Source: catalog DB query_log + api_keys.',
    source: 'admin/kpi-history?days=1',
  });
  rows.push({
    label: 'Search calls (today)',
    value: today ? fmtCompact(num(today.search_calls) || 0) : 'n/a',
    definition: 'Number of /v1/products/search calls recorded today. Source: query_log.',
    source: 'admin/kpi-history?days=1',
  });
  rows.push({
    label: 'Zero-result rate (today)',
    value: today && num(today.search_calls)
      ? ((num(today.zero_result_calls) || 0) / (num(today.search_calls) || 1) * 100).toFixed(1) + '%'
      : 'n/a',
    definition: 'Share of search calls returning zero products. If zero_result_calls / search_calls > 0.10, treat as catalog regression.',
    source: 'admin/kpi-history?days=1',
  });
  rows.push({
    label: 'p50 latency (today)',
    value: today && num(today.p50_ms) !== null ? `${num(today.p50_ms)} ms` : 'n/a',
    definition: 'Median search latency in milliseconds. Source: query_log timing.',
    source: 'admin/kpi-history?days=1',
  });
  rows.push({
    label: 'p95 latency (today)',
    value: today && num(today.p95_ms) !== null ? `${num(today.p95_ms)} ms` : 'n/a',
    definition: '95th-percentile search latency in milliseconds. Source: query_log timing.',
    source: 'admin/kpi-history?days=1',
  });
  rows.push({
    label: 'Clicks total (today)',
    value: today ? fmtCompact(num(today.clicks_total) || 0) : 'n/a',
    definition: 'Click = a row in affiliate_clicks (one /r/... redirect served). Until truth-clicks ship, pre-truth clicks are unclassified and labelled. Source: catalog DB.',
    source: 'admin/kpi-history?days=1',
  });
  rows.push({
    label: 'Active external API keys',
    value: today ? fmtCompact(num(today.active_ext_keys) || 0) : 'n/a',
    definition: 'External key = api_keys row not internal with >=1 external request in the window. Source: api_keys + query_log.',
    source: 'admin/kpi-history?days=1',
  });
  rows.push({
    label: 'Developer-portal external keys',
    value: today ? fmtCompact(num(today.dev_keys_external) || 0) : 'n/a',
    definition: 'API keys created via the developer portal (not internal/monitor keys). Source: api_keys.',
    source: 'admin/kpi-history?days=1',
  });

  return { rows, day, fetchErrors };
}

export default async function TruthPage({ searchParams }: {
  searchParams: Promise<{ key?: string | string[] }>;
}) {
  const sp = await searchParams;
  const key = typeof sp.key === 'string' ? sp.key : '';
  if (!process.env.ADMIN_UI_KEY || key !== process.env.ADMIN_UI_KEY) notFound();

  const { rows, day, fetchErrors } = await loadTruthRows();

  return (
    <main id="main-content" role="main" tabIndex={-1} className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Truth — canonical metrics</h1>
        <p className="text-gray-600 leading-relaxed">
          Every number on this page is sourced from one named endpoint and one named definition.
          Definitions live in <code className="bg-gray-100 px-1 py-0.5 rounded">/home/paperclip/ops-canon/METRICS-DEFINITIONS.md</code>.
          If a metric is unreachable, it reads <strong>n/a — &lt;reason&gt;</strong>; never a guess.
        </p>
        <p className="text-sm text-gray-500 mt-2">Day (UTC): {day}</p>
      </header>

      {fetchErrors.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-6">
          <strong>Data sources unavailable:</strong>
          <ul className="mt-1 list-disc list-inside">
            {fetchErrors.map((e) => (<li key={e}>{e}</li>))}
          </ul>
        </div>
      )}

      <section aria-label="Truth table" className="rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Metric</th>
              <th className="px-4 py-3 font-semibold">Value</th>
              <th className="px-4 py-3 font-semibold">Definition</th>
              <th className="px-4 py-3 font-semibold">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.label} className="align-top">
                <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{row.label}</td>
                <td className="px-4 py-3 font-mono text-gray-900 whitespace-nowrap">{row.value}</td>
                <td className="px-4 py-3 text-gray-600 leading-relaxed">{row.definition}</td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{row.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="mt-8 text-xs text-gray-500">
        <p>
          Cached 15 min per directive. Manual refresh: hit this URL with the <code>?key=</code> param.
        </p>
        <p className="mt-1">
          When the catalog search endpoint is unreachable (BUY-74205), catalog rows / merchants with products show <strong>n/a</strong> and a fetch error.
          Do not paper over with a guess.
        </p>
      </footer>
    </main>
  );
}