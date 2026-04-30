'use client';

import { useState } from 'react';
import { Check, Copy, Loader2, Play, Sparkles } from 'lucide-react';

const DEFAULT_QUERY = 'wireless headphones';
const DEFAULT_LIMIT = 3;
const DEFAULT_SOURCE = 'amazon_us';
const DEFAULT_ENDPOINT = 'search';

const endpointOptions = [
  { label: 'Search', value: 'search', method: 'GET', path: '/v1/search' },
  { label: 'Deals', value: 'deals', method: 'GET', path: '/v1/deals' },
  { label: 'Categories', value: 'categories', method: 'GET', path: '/v1/categories' },
];

const sourceOptions = [
  { label: 'Amazon US', value: 'amazon_us' },
  { label: 'Shopee SG', value: 'shopee_sg' },
  { label: 'Lazada SG', value: 'lazada_sg' },
];

type PlaygroundPayload = {
  meta: {
    endpoint: string;
    latency_ms: number;
    mode: 'demo' | 'live' | 'demo-fallback';
    reason?: string;
    source: string;
    upstream_status?: number;
  };
  request: {
    endpoint?: string;
    limit: number;
    q: string;
    source: string;
  };
  response: unknown;
  upstream_error?: unknown;
};

function buildCurlCommand(endpoint: string, query: string, limit: number, source: string, apiKey: string) {
  const authHeader = apiKey.trim()
    ? `"Authorization: Bearer ${apiKey.trim()}"`
    : '"Authorization: Bearer YOUR_API_KEY"';

  const params = new URLSearchParams({ limit: String(limit) });
  let path = '/v1/search';

  if (endpoint === 'deals') {
    path = '/v1/deals';
    params.set('source', source);
  } else if (endpoint === 'categories') {
    path = '/v1/categories';
  } else {
    params.set('q', query);
    params.set('source', source);
  }

  return `curl "https://api.buywhere.ai${path}?${params.toString()}" \\
  -H ${authHeader}`;
}

const initialResponse: PlaygroundPayload = {
  meta: {
    endpoint: '/v1/search',
    latency_ms: 24,
    mode: 'demo',
    reason: 'Ready to run. Add an API key for live data or try the demo response.',
    source: 'portal-demo',
  },
  request: {
    limit: DEFAULT_LIMIT,
    endpoint: DEFAULT_ENDPOINT,
    q: DEFAULT_QUERY,
    source: DEFAULT_SOURCE,
  },
  response: {
    total: 1247,
    limit: DEFAULT_LIMIT,
    offset: 0,
    has_more: true,
    items: [
      {
        id: 'wireless-headphones-1',
        name: 'Wireless Headphones Pro',
        source: 'amazon_us',
        merchant: 'Amazon US',
        price: '106.50',
        currency: 'USD',
        rating: 4.3,
        review_count: 253,
        confidence_score: 0.9,
        discount_pct: 11,
      },
    ],
  },
};

export function ApiPlayground() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [payload, setPayload] = useState<PlaygroundPayload>(initialResponse);
  const [error, setError] = useState<string | null>(null);

  const selectedEndpoint = endpointOptions.find((option) => option.value === endpoint) ?? endpointOptions[0];
  const curlCommand = buildCurlCommand(endpoint, query, limit, source, apiKey);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(curlCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleRun = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/docs-playground', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          apiKey,
          endpoint,
          limit,
          q: query,
          source,
        }),
      });

      const data = (await response.json()) as PlaygroundPayload | { error?: string };

      if (!response.ok || !('meta' in data)) {
        setError(('error' in data && data.error) || 'Playground request failed.');
        return;
      }

      setPayload(data);
    } catch {
      setError('Playground request failed. Check local API routing and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="xl:sticky xl:top-24">
      <div className="overflow-hidden rounded-[28px] border border-[#d4dde8] bg-white shadow-[0_28px_90px_rgba(10,14,26,0.12)]">
        <div className="border-b border-[#d4dde8] bg-[radial-gradient(circle_at_top,_rgba(0,212,200,0.18),_transparent_38%),radial-gradient(circle_at_top_right,_rgba(245,166,35,0.18),_transparent_26%),linear-gradient(135deg,#0a0e1a,#111b2b_58%,#132235)] px-5 py-5 text-white">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8cf2ea]">Live Playground</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Try the search API</h2>
            </div>
            <div className="rounded-full border border-white/15 bg-white/10 p-2">
              <Sparkles className="h-5 w-5 text-[#8cf2ea]" />
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Run a request from the docs. Without an API key, the panel returns deterministic demo data so the flow stays explorable.
          </p>
        </div>

        <div className="space-y-5 p-5">
          <div className="grid gap-4">
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Search query
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#00d4c8] focus:bg-white focus:ring-4 focus:ring-[#dffaf7]"
                placeholder="iphone 16 pro"
                disabled={endpoint === 'categories'}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                Endpoint
                <select
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#00d4c8] focus:bg-white focus:ring-4 focus:ring-[#dffaf7]"
                >
                  {endpointOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm font-medium text-slate-700">
                Source
                <select
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#00d4c8] focus:bg-white focus:ring-4 focus:ring-[#dffaf7]"
                  disabled={endpoint === 'categories'}
                >
                  {sourceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm font-medium text-slate-700">
                Limit
                <input
                  min={1}
                  max={6}
                  type="number"
                  value={limit}
                  onChange={(event) => setLimit(Number(event.target.value) || 1)}
                  className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#00d4c8] focus:bg-white focus:ring-4 focus:ring-[#dffaf7]"
                />
              </label>
            </div>

            <label className="grid gap-2 text-sm font-medium text-slate-700">
              API key
              <input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#00d4c8] focus:bg-white focus:ring-4 focus:ring-[#dffaf7]"
                placeholder="bw_live_..."
                type="password"
              />
            </label>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-950 p-4 text-slate-100">
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                <span className="rounded-full bg-[#00d4c8]/15 px-2 py-1 text-[#8cf2ea]">{selectedEndpoint.method}</span>
                <span>{selectedEndpoint.path}</span>
              </div>
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
                type="button"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy curl'}
              </button>
            </div>
            <pre className="mt-3 overflow-x-auto text-xs leading-6 text-slate-200">
              <code>{curlCommand}</code>
            </pre>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleRun}
              disabled={loading}
              type="button"
              className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {loading ? 'Running request' : 'Run request'}
            </button>
            <p className="text-sm text-slate-500">
              {payload.meta.mode === 'live' ? 'Live API response' : 'Demo response'}
              {' · '}
              {payload.meta.latency_ms}ms
            </p>
          </div>

          {(payload.meta.reason || error) && (
            <div className="rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm text-slate-700">
              {error || payload.meta.reason}
            </div>
          )}

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">JSON Response</p>
                <p className="mt-1 text-sm text-slate-600">
                  Source: <span className="font-medium text-slate-900">{payload.meta.source}</span>
                </p>
              </div>
              <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
                {payload.meta.mode}
              </span>
            </div>
            <pre className="max-h-[26rem] overflow-auto px-4 py-4 text-xs leading-6 text-slate-800">
              <code>{JSON.stringify(payload.response, null, 2)}</code>
            </pre>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default ApiPlayground;
