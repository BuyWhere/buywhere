'use client';

import { useState } from 'react';
import { Check, Copy, Loader2, Play, Sparkles } from 'lucide-react';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

const DEFAULT_LIMIT = 3;
const DEFAULT_SOURCE = 'amazon_us';

const endpointOptions = [
  { label: 'Search', value: 'search', method: 'GET', path: '/v1/search' },
  { label: 'Product by ID', value: 'products', method: 'GET', path: '/v1/products/{id}' },
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
    product_id?: string;
    source: string;
  };
  response: unknown;
  upstream_error?: unknown;
};

type DemoMode = 'search' | 'agent';

type SearchResultItem = {
  id?: string;
  product_id?: string;
  name?: string;
  title?: string;
  merchant?: string;
  source?: string;
  price?: string | number;
  currency?: string;
  confidence_score?: number;
  buy_url?: string;
  affiliate_url?: string;
};

function buildCurlCommand(
  endpoint: string,
  query: string,
  productId: string,
  limit: number,
  source: string,
  apiKey: string
) {
  const authHeader = apiKey.trim()
    ? `"Authorization: Bearer ${apiKey.trim()}"`
    : '"Authorization: Bearer YOUR_API_KEY"';

  let path = '/v1/search';
  const params = new URLSearchParams();

  if (endpoint === 'products') {
    const id = productId.trim() || '{product_id}';
    path = `/v1/products/${id}`;
  } else if (endpoint === 'categories') {
    path = '/v1/categories';
  } else {
    params.set('q', query);
    params.set('source', source);
  }

  if (endpoint !== 'products') {
    params.set('limit', String(limit));
  }

  const queryString = params.toString();
  const fullUrl = queryString ? `${path}?${queryString}` : path;

  return `curl "https://api.buywhere.ai${fullUrl}" \\
  -H ${authHeader}`;
}

function extractSearchItems(payload: PlaygroundPayload | null): SearchResultItem[] {
  if (!payload || !payload.response || typeof payload.response !== 'object') {
    return [];
  }

  const response = payload.response as {
    items?: SearchResultItem[];
    data?: SearchResultItem[];
    results?: SearchResultItem[];
  };

  if (Array.isArray(response.items)) return response.items;
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.results)) return response.results;
  return [];
}

function getItemLabel(item: SearchResultItem) {
  return item.title || item.name || 'Unnamed product';
}

function getItemUrl(item: SearchResultItem) {
  return item.buy_url || item.affiliate_url || '';
}

function formatItemPrice(item: SearchResultItem) {
  if (typeof item.price === 'number') {
    return `${item.currency || 'USD'} ${item.price.toFixed(2)}`;
  }

  if (typeof item.price === 'string' && item.price.trim()) {
    return `${item.currency || 'USD'} ${item.price.trim()}`;
  }

  return 'Price unavailable';
}

export default function PlaygroundPage() {
  const [demoMode, setDemoMode] = useState<DemoMode>('search');
  const [query, setQuery] = useState('wireless headphones');
  const [productId, setProductId] = useState('');
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [endpoint, setEndpoint] = useState('search');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [payload, setPayload] = useState<PlaygroundPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedEndpoint = endpointOptions.find((opt) => opt.value === endpoint) ?? endpointOptions[0];
  const curlCommand = buildCurlCommand(endpoint, query, productId, limit, source, apiKey);
  const isSearchEndpoint = endpoint === 'search';
  const searchItems = extractSearchItems(payload);
  const topItems = searchItems.slice(0, 3);
  const topItem = topItems[0];
  const cheapestItem = topItems.reduce<SearchResultItem | null>((best, item) => {
    const rawPrice = typeof item.price === 'number' ? item.price : Number(item.price);
    if (!Number.isFinite(rawPrice)) return best;
    if (!best) return item;
    const bestPrice = typeof best.price === 'number' ? best.price : Number(best.price);
    if (!Number.isFinite(bestPrice) || rawPrice < bestPrice) return item;
    return best;
  }, null);
  const agentQuery = query.trim() || 'wireless headphones';
  const agentToolCall = `resolve_product_query(${JSON.stringify(
    {
      q: agentQuery,
      source,
      limit,
      endpoint: '/v1/search',
    },
    null,
    2
  )})`;
  const agentResponsePreview = JSON.stringify(
    {
      meta: payload?.meta
        ? {
            mode: payload.meta.mode,
            latency_ms: payload.meta.latency_ms,
            source: payload.meta.source,
          }
        : null,
      results: topItems.map((item) => ({
        id: item.id || item.product_id,
        name: getItemLabel(item),
        merchant: item.merchant || item.source,
        price: item.price,
        currency: item.currency,
        url: getItemUrl(item),
        confidence_score: item.confidence_score,
      })),
    },
    null,
    2
  );
  const agentAnswer = !payload
    ? 'Run the search to generate the agent simulation.'
    : !topItems.length
      ? `I searched BuyWhere for "${agentQuery}" but did not get any product matches to recommend yet. I would broaden the query or ask a clarifying follow-up before answering confidently.`
      : `Top recommendation: ${getItemLabel(topItem)} at ${formatItemPrice(topItem)}${topItem?.merchant ? ` from ${topItem.merchant}` : ''}. ${
          cheapestItem
            ? `Why: the response returned ${searchItems.length} structured match${searchItems.length === 1 ? '' : 'es'}, and the lowest visible offer is ${getItemLabel(cheapestItem)} at ${formatItemPrice(cheapestItem)}. `
            : `Why: the response returned ${searchItems.length} structured match${searchItems.length === 1 ? '' : 'es'} with merchant attribution and product identifiers the agent can safely cite. `
        }Alternatives: ${
          topItems.slice(1).length
            ? topItems
                .slice(1)
                .map((item) => `${getItemLabel(item)} at ${formatItemPrice(item)}${item.merchant ? ` from ${item.merchant}` : ''}`)
                .join('; ')
            : 'no clear fallback products were returned in this result set'
        }. Because the response preserves merchant attribution and stable product identifiers, the agent can compare offers and route the user to the right merchant instead of giving an ungrounded shopping answer.`;

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, endpoint, limit, q: query, source, productId }),
      });

      const data = (await response.json()) as PlaygroundPayload | { error?: string };

      if (!response.ok || !('meta' in data)) {
        setError(('error' in data && data.error) || 'Playground request failed.');
        return;
      }

      setPayload(data);
    } catch {
      setError('Playground request failed. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#0f1117]">
      <Nav />

      <main id="main-content" className="flex-1">
        <div className="mx-auto max-7xl px-4 py-16 sm:px-6">
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-400">API Playground</p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
              Try the BuyWhere API
            </h1>
            <p className="mt-4 max-w-2xl text-lg text-slate-400">
              {demoMode === 'agent'
                ? 'Run the live search demo, then inspect how an agent would turn the tool call and structured response into a grounded final answer.'
                : 'Test public endpoints directly in your browser. No signup required — demo data is returned without an API key.'}
            </p>
            {isSearchEndpoint && (
              <div className="mt-6 inline-flex rounded-full border border-[#30363d] bg-[#161b22] p-1">
                <button
                  type="button"
                  onClick={() => setDemoMode('search')}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    demoMode === 'search' ? 'bg-cyan-500 text-[#0f1117]' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Search Demo
                </button>
                <button
                  type="button"
                  onClick={() => setDemoMode('agent')}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    demoMode === 'agent' ? 'bg-cyan-500 text-[#0f1117]' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Agent Demo
                </button>
              </div>
            )}
          </div>

          <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="overflow-hidden rounded-2xl border border-[#30363d] bg-[#161b22]">
                <div className="border-b border-[#30363d] px-5 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Endpoints</p>
                </div>
                <div className="p-3">
                  {endpointOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setEndpoint(opt.value)}
                      className={`mb-1 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
                        endpoint === opt.value
                          ? 'bg-[#58a6ff]/15 text-[#58a6ff]'
                          : 'text-slate-300 hover:bg-[#30363d]'
                      }`}
                    >
                      <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                        opt.method === 'GET'
                          ? 'bg-[#238636]/20 text-[#7ee787]'
                          : 'bg-[#79c0ff]/20 text-[#79c0ff]'
                      }`}>
                        {opt.method}
                      </span>
                      <span className="font-mono text-xs">{opt.path}</span>
                    </button>
                  ))}
                </div>
              </div>
            </aside>

            <div className="space-y-6">
              <div className="overflow-hidden rounded-2xl border border-[#30363d] bg-[#161b22]">
                <div className="border-b border-[#30363d] bg-gradient-to-r from-[#0a0e1a] via-[#111b2b] to-[#132235] px-6 py-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-400">Request Builder</p>
                      <h2 className="mt-2 text-xl font-semibold text-white">{selectedEndpoint.label}</h2>
                    </div>
                    <div className="rounded-full border border-white/15 bg-white/10 p-2">
                      <Sparkles className="h-5 w-5 text-cyan-400" />
                    </div>
                  </div>
                </div>

                <div className="space-y-5 p-6">
                  {endpoint === 'products' ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="grid gap-2 text-sm font-medium text-slate-300">
                        Product ID
                        <input
                          value={productId}
                          onChange={(e) => setProductId(e.target.value)}
                          className="rounded-xl border border-[#30363d] bg-[#0d1117] px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                          placeholder="e.g. ps5-digital-shopee-123"
                        />
                      </label>
                      <label className="grid gap-2 text-sm font-medium text-slate-300">
                        Source
                        <select
                          value={source}
                          onChange={(e) => setSource(e.target.value)}
                          className="rounded-xl border border-[#30363d] bg-[#0d1117] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                        >
                          {sourceOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="grid gap-2 text-sm font-medium text-slate-300">
                        {endpoint === 'search' ? 'Search query' : 'Query'}
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          className="rounded-xl border border-[#30363d] bg-[#0d1117] px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                          placeholder="e.g. iphone 16 pro"
                          disabled={endpoint === 'categories'}
                        />
                      </label>
                      <label className="grid gap-2 text-sm font-medium text-slate-300">
                        Source
                        <select
                          value={source}
                          onChange={(e) => setSource(e.target.value)}
                          className="rounded-xl border border-[#30363d] bg-[#0d1117] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                          disabled={endpoint === 'categories'}
                        >
                          {sourceOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </label>
                      {endpoint !== 'categories' && (
                        <label className="grid gap-2 text-sm font-medium text-slate-300">
                          Limit
                          <input
                            type="number"
                            min={1}
                            max={10}
                            value={limit}
                            onChange={(e) => setLimit(Number(e.target.value) || 1)}
                            className="rounded-xl border border-[#30363d] bg-[#0d1117] px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                          />
                        </label>
                      )}
                    </div>
                  )}

                  <label className="grid gap-2 text-sm font-medium text-slate-300">
                    API key <span className="text-xs text-slate-500">(optional — demo data returned without)</span>
                    <input
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="rounded-xl border border-[#30363d] bg-[#0d1117] px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                      placeholder="bw_live_..."
                      type="password"
                    />
                  </label>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-[#30363d] bg-[#161b22]">
                <div className="flex items-center justify-between border-b border-[#30363d] px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span className={`rounded px-2 py-1 text-xs font-bold uppercase tracking-wider ${
                      selectedEndpoint.method === 'GET'
                        ? 'bg-[#238636]/20 text-[#7ee787]'
                        : 'bg-[#79c0ff]/20 text-[#79c0ff]'
                    }`}>
                      {selectedEndpoint.method}
                    </span>
                    <span className="font-mono text-sm text-slate-300">{selectedEndpoint.path}</span>
                  </div>
                  <button
                    onClick={handleCopy}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#30363d] px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    {copied ? 'Copied' : 'Copy curl'}
                  </button>
                </div>
                <pre className="overflow-x-auto px-5 py-4 text-sm text-slate-200">
                  <code>{curlCommand}</code>
                </pre>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <button
                  onClick={handleRun}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-6 py-3 text-sm font-semibold text-[#0f1117] transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {loading ? 'Sending request...' : 'Send Request'}
                </button>
                {payload && (
                  <p className="text-sm text-scyan-400">
                    {payload.meta.mode === 'live' ? 'Live API response' : 'Demo response'}
                    {' · '}
                    {payload.meta.latency_ms}ms
                  </p>
                )}
              </div>

              {error && (
                <div className="rounded-2xl border border-red-900/50 bg-red-900/20 px-5 py-4 text-sm text-red-300">
                  {error}
                </div>
              )}

              {isSearchEndpoint && demoMode === 'agent' && (
                <div className="overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-[#0f172a] via-[#111827] to-[#0b1120]">
                  <div className="border-b border-cyan-500/10 px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-400">Agent Simulation</p>
                        <h2 className="mt-2 text-xl font-semibold text-white">From user query to grounded answer</h2>
                        <p className="mt-2 max-w-2xl text-sm text-slate-400">
                          This view shows the same playground request as an agent workflow: user intent, tool invocation, structured API output, and the final answer the agent can safely produce.
                        </p>
                      </div>
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                        {payload ? 'Response mapped live' : 'Ready for live query'}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-4 p-5 lg:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">User Query</p>
                      <p className="mt-3 text-base text-white">{agentQuery}</p>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-white/10 px-3 py-1 text-slate-300">Intent: product discovery</span>
                        <span className="rounded-full bg-white/10 px-3 py-1 text-slate-300">Source: {source}</span>
                        <span className="rounded-full bg-white/10 px-3 py-1 text-slate-300">Limit: {limit}</span>
                        {payload && (
                          <span className="rounded-full bg-white/10 px-3 py-1 text-slate-300">
                            Latency: {payload.meta.latency_ms}ms
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Tool Call</p>
                      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-slate-200">
                        <code>{agentToolCall}</code>
                      </pre>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">JSON Response</p>
                      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-6 text-slate-200">
                        <code>{agentResponsePreview}</code>
                      </pre>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Final Agent Answer</p>
                      <p className="mt-3 text-sm leading-7 text-slate-100">{agentAnswer}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="overflow-hidden rounded-2xl border border-[#30363d] bg-[#161b22]">
                <div className="flex items-center justify-between border-b border-[#30363d] px-5 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Response</p>
                  {payload && (
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                      payload.meta.mode === 'live'
                        ? 'bg-emerald-900/50 text-emerald-300'
                        : 'bg-slate-800 text-slate-300'
                    }`}>
                      {payload.meta.mode}
                    </span>
                  )}
                </div>
                <pre className="max-h-[28rem] overflow-auto px-5 py-4 text-xs leading-6 text-slate-200">
                  <code>
                    {payload
                      ? JSON.stringify(payload.response, null, 2)
                      : '// Response will appear here after you send a request'}
                  </code>
                </pre>
              </div>

              <div className="flex flex-wrap gap-3 text-sm text-slate-400">
                <a href="/docs" className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300">
                  Read the full docs →
                </a>
                <a href="/api-keys" className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300">
                  Get a free API key →
                </a>
                <a href="/quickstart" className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300">
                  Run in quickstart →
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
