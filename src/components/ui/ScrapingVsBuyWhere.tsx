'use client';

interface ComparisonRow {
  dimension: string;
  scraping: string;
  buywhere: string;
  scrapingNegative?: boolean;
  buywhereNegative?: boolean;
}

interface ScrapingVsBuyWhereProps {
  variant?: 'default' | 'inline';
}

function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-100">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100">
            <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Dimension
            </th>
            <th scope="col" className="px-4 py-3 text-center text-xs font-semibold text-red-600 uppercase tracking-wide">
              Scraping
            </th>
            <th scope="col" className="px-4 py-3 text-center text-xs font-semibold text-indigo-600 uppercase tracking-wide">
              BuyWhere
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((row) => (
            <tr key={row.dimension} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3 text-gray-900 font-medium">{row.dimension}</td>
              <td className={`px-4 py-3 text-center ${row.scrapingNegative ? 'text-red-600' : 'text-gray-600'}`}>
                {row.scraping}
              </td>
              <td className={`px-4 py-3 text-center ${row.buywhereNegative ? 'text-red-600' : 'text-indigo-600 font-semibold'}`}>
                {row.buywhere}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const comparisonRows: ComparisonRow[] = [
  {
    dimension: 'Data structure',
    scraping: 'HTML parsing, fragile DOM dependencies',
    buywhere: 'Normalized JSON, consistent schema',
    scrapingNegative: true,
  },
  {
    dimension: 'Maintenance',
    scraping: 'High — site changes break scrapers',
    buywhere: 'Low — partner APIs are stable',
    scrapingNegative: true,
  },
  {
    dimension: 'Reliability',
    scraping: 'Unpredictable — blocks, captchas, rate limits',
    buywhere: '99.9% uptime SLA, no blocks',
  },
  {
    dimension: 'Freshness',
    scraping: 'Best-effort, often stale',
    buywhere: 'Multiple daily refreshes, sub-24h window',
  },
  {
    dimension: 'Scalability',
    scraping: 'Breaks under scale, requires proxies',
    buywhere: 'Built for agent-scale query volumes',
    scrapingNegative: true,
  },
  {
    dimension: 'Latency',
    scraping: 'Variable — 500ms to 5s+',
    buywhere: 'Predictable — P50 120ms, P95 210ms',
  },
  {
    dimension: 'Legal risk',
    scraping: 'Terms violations, potential legal exposure',
    buywhere: 'Licensed data partnerships, compliant',
    scrapingNegative: true,
  },
  {
    dimension: 'Agent integration',
    scraping: 'Requires custom parsing logic per site',
    buywhere: 'Tools-ready MCP interface, drop-in',
    scrapingNegative: true,
  },
];

export function ScrapingVsBuyWhere({ variant = 'default' }: ScrapingVsBuyWhereProps) {
  if (variant === 'inline') {
    return (
      <div className="flex flex-wrap items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Scraping:</span>
          <span className="text-red-600 font-medium">High maintenance</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">BuyWhere:</span>
          <span className="text-indigo-600 font-medium">Stable, licensed data</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-6">
        <svg className="h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m6 9l2 2 4-4" />
        </svg>
        <h3 className="text-lg font-semibold text-gray-900">Why not scraping?</h3>
      </div>

      <div className="mb-6 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
        <p className="text-sm text-indigo-800 leading-relaxed">
          <span className="font-semibold">Scraping works for demos.</span> It breaks in production — sites change layouts, add captchas, block IPs, and require constant maintenance. BuyWhere replaces fragile scrapers with direct data partnerships that stay reliable as your agent scales.
        </p>
      </div>

      <ComparisonTable rows={comparisonRows} />

      <div className="mt-6 pt-5 border-t border-gray-100">
        <p className="text-xs text-gray-400 text-center">
          BuyWhere maintains data partnerships so your agents never have to debug a broken scraper.
        </p>
      </div>
    </div>
  );
}

export default ScrapingVsBuyWhere;