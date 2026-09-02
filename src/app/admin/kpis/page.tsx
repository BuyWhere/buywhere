// Owner KPI portal (accelerator item 7, 2026-08-22). Server-rendered, gated by
// ADMIN_UI_KEY query param; data via /admin/kpi-history (ADMIN_API_KEY, server-side
// only — neither key reaches the client). Pure-SVG charts, zero client JS.
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

function Chart({ title, days, values, unit }: {
  title: string;
  days: string[];
  values: Array<number | null>;
  unit?: string;
}) {
  const W = 640, H = 140, PX = 6, PY = 12;
  const pts: Array<{ x: number; y: number; v: number }> = [];
  const present = values.filter((v): v is number => v !== null);
  const min = present.length ? Math.min(...present) : 0;
  const max = present.length ? Math.max(...present) : 1;
  const span = max - min || 1;
  values.forEach((v, i) => {
    if (v === null) return;
    const x = PX + (values.length < 2 ? 0 : (i / (values.length - 1)) * (W - 2 * PX));
    const y = H - PY - ((v - min) / span) * (H - 2 * PY);
    pts.push({ x, y, v });
  });
  const last = present.length ? present[present.length - 1] : null;
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>{title}</h2>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
          {last !== null ? fmtCompact(last) : '—'}{unit || ''}
          <span style={{ opacity: 0.55, marginLeft: 8, fontSize: 11 }}>
            min {fmtCompact(min)} · max {fmtCompact(max)}
          </span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={title}
           style={{ background: 'rgba(127,127,127,0.06)', borderRadius: 6 }}>
        {pts.length > 1 && (
          <polyline
            fill="none" stroke="currentColor" strokeWidth={1.6}
            points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
          />
        )}
        {pts.length > 0 && (
          <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={3} fill="currentColor" />
        )}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, opacity: 0.55 }}>
        <span>{days[0] || ''}</span><span>{days[days.length - 1] || ''}</span>
      </div>
    </div>
  );
}

export default async function KpisPage({ searchParams }: {
  searchParams: Promise<{ key?: string | string[]; days?: string | string[] }>;
}) {
  const sp = await searchParams;
  const key = typeof sp.key === 'string' ? sp.key : '';
  if (!process.env.ADMIN_UI_KEY || key !== process.env.ADMIN_UI_KEY) notFound();

  const days = typeof sp.days === 'string' && /^\d+$/.test(sp.days) ? sp.days : '30';
  let rows: KpiRow[] = [];
  let fetchError = '';
  try {
    const r = await fetch(`https://api.buywhere.ai/admin/kpi-history?days=${days}`, {
      headers: { Authorization: `Bearer ${process.env.ADMIN_API_KEY || ''}` },
      cache: 'no-store',
    });
    if (!r.ok) fetchError = `API ${r.status}`;
    else rows = ((await r.json()) as { data?: KpiRow[] }).data || [];
  } catch (e) {
    fetchError = e instanceof Error ? e.message : 'fetch failed';
  }

  const dayLabels = rows.map((r) => String(r.day).slice(0, 10));
  const series = (pick: (r: KpiRow) => number | string | null) => rows.map((r) => num(pick(r)));
  const zeroRate = rows.map((r) => {
    const s = num(r.search_calls), z = num(r.zero_result_calls);
    return s && s > 0 && z !== null ? Math.round((z / s) * 1000) / 10 : null;
  });
  const recent = rows.slice(-14).reverse();

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 2 }}>BuyWhere KPIs</h1>
      <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 24 }}>
        {rows.length} days · nightly snapshot (kpi_daily) · external-only where labeled
      </p>
      {fetchError && <p style={{ color: '#b91c1c', fontSize: 13 }}>Data fetch failed: {fetchError}</p>}
      <Chart title="External requests / day" days={dayLabels} values={series((r) => r.calls_external)} />
      <Chart title="Clicks (total)" days={dayLabels} values={series((r) => r.clicks_total)} />
      <Chart title="Zero-result rate (%)" days={dayLabels} values={zeroRate} unit="%" />
      <Chart title="Catalog size (est.)" days={dayLabels} values={series((r) => r.products_est)} />
      <Chart title="Monetizable merchants" days={dayLabels} values={series((r) => r.merchants_monetizable)} />
      <Chart title="p95 search latency (ms)" days={dayLabels} values={series((r) => r.p95_ms)} unit="ms" />
      <h2 style={{ fontSize: 14, fontWeight: 600, margin: '24px 0 8px' }}>Last 14 days</h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr style={{ textAlign: 'right', opacity: 0.7 }}>
              <th style={{ textAlign: 'left', padding: '4px 8px' }}>day</th>
              <th style={{ padding: '4px 8px' }}>ext req</th>
              <th style={{ padding: '4px 8px' }}>clicks</th>
              <th style={{ padding: '4px 8px' }}>zero%</th>
              <th style={{ padding: '4px 8px' }}>p95 ms</th>
              <th style={{ padding: '4px 8px' }}>ext keys</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => {
              const s = num(r.search_calls), z = num(r.zero_result_calls);
              const zr = s && s > 0 && z !== null ? ((z / s) * 100).toFixed(1) : '—';
              return (
                <tr key={String(r.day)} style={{ textAlign: 'right', borderTop: '1px solid rgba(127,127,127,0.2)' }}>
                  <td style={{ textAlign: 'left', padding: '4px 8px' }}>{String(r.day).slice(0, 10)}</td>
                  <td style={{ padding: '4px 8px' }}>{num(r.calls_external) ?? '—'}</td>
                  <td style={{ padding: '4px 8px' }}>{num(r.clicks_total) ?? '—'}</td>
                  <td style={{ padding: '4px 8px' }}>{zr}</td>
                  <td style={{ padding: '4px 8px' }}>{num(r.p95_ms) ?? '—'}</td>
                  <td style={{ padding: '4px 8px' }}>{num(r.active_ext_keys) ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
