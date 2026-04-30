'use client';

import { FormEvent, useId, useState, useCallback } from 'react';
import { Search, Loader2, Bot, Copy, Check, Zap, Clock, TrendingUp } from 'lucide-react';

interface AgentSimulationProps {
  apiUrl?: string;
}

const EXAMPLE_QUERIES = [
  'best water bottle under $50',
  'cheapest wireless earbuds under $100',
  'kitchen appliances on sale now',
  'Sony WH-1000XM5 price comparison',
];

interface DemoProduct {
  id: number;
  name: string;
  price: string;
  currency: string;
  merchant: string;
  buy_url: string;
  buywhere_score: number;
  confidence: number;
}

interface DemoResponse {
  query: string;
  products: DemoProduct[];
  total_results: number;
  latency_ms: number;
}

function BuyWhereScoreBadge({ score }: { score: number }) {
  const color = score >= 90 ? 'bg-emerald-100 text-emerald-700' : score >= 80 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      <Zap className="w-3 h-3" />
      {score}
    </span>
  );
}

function ProcessingAnimation() {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-3">
      <div className="flex items-center gap-2">
        <span className="flex h-3 w-3 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="flex h-3 w-3 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="flex h-3 w-3 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <p className="text-sm text-slate-400">BuyWhere is resolving your query...</p>
    </div>
  );
}

export function AgentSimulation({ apiUrl = 'https://api.buywhere.ai' }: AgentSimulationProps) {
  const [query, setQuery] = useState(EXAMPLE_QUERIES[0]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [demoData, setDemoData] = useState<DemoResponse | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const errorId = useId();

  const fetchDemo = useCallback(async (searchQuery: string) => {
    setIsSimulating(true);
    setError('');
    setDemoData(null);

    try {
      const params = new URLSearchParams({ q: searchQuery });
      const res = await fetch(`${apiUrl}/demo/resolve?${params.toString()}`, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        throw new Error(`Demo endpoint returned ${res.status}`);
      }

      const data: DemoResponse = await res.json();
      setDemoData(data);
    } catch {
      setError('Demo endpoint unavailable — showing sample response.');
      setDemoData({
        query: searchQuery,
        products: [
          {
            id: 1,
            name: "HydroFlask Wide Mouth 32oz Water Bottle - Black",
            price: "45.99",
            currency: "USD",
            merchant: "Amazon",
            buy_url: "https://amazon.com/dp/B07XJ8C8F5",
            buywhere_score: 94,
            confidence: 0.92,
          },
          {
            id: 2,
            name: "Yeti Rambler 30oz Tumbler - Black",
            price: "38.00",
            currency: "USD",
            merchant: "Dick's Sporting Goods",
            buy_url: "https://dickssportinggoods.com/p/yeti-rambler-30oz",
            buywhere_score: 91,
            confidence: 0.88,
          },
        ],
        total_results: 3,
        latency_ms: 124,
      });
    } finally {
      setIsSimulating(false);
    }
  }, [apiUrl]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    await fetchDemo(trimmed);
  };

  const handleCopy = () => {
    if (!demoData) return;
    navigator.clipboard.writeText(JSON.stringify(demoData, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="py-20 bg-slate-900 text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-12 items-start">
          <div className="space-y-6">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-indigo-500/20 border border-indigo-500/30 px-3 py-1 text-xs font-medium uppercase tracking-[0.15em] text-indigo-300 mb-4">
                <Bot className="w-3 h-3" />
                Agent Simulation
              </div>
              <h2 className="text-3xl font-bold leading-tight">
                Your agent queries BuyWhere and gets structured product data back.
              </h2>
              <p className="mt-4 text-lg text-slate-400 leading-relaxed">
                Drop a natural language query. BuyWhere returns real products, prices, merchants, and purchase options — ready for your agent to act on.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <label htmlFor="agent-query" className="sr-only">
                What does your agent need to find?
              </label>
              <div className="relative">
                <Bot
                  className="pointer-events-none absolute left-5 top-1/2 h-6 w-6 -translate-y-1/2 text-indigo-400"
                  aria-hidden="true"
                />
                <input
                  id="agent-query"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="What does your agent need to find?"
                  className="w-full rounded-xl border-2 border-slate-600 bg-slate-800 py-5 pl-14 pr-4 text-lg text-white placeholder-slate-400 transition-all focus:border-indigo-500 focus:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-indigo-500/20"
                  aria-label="What does your agent need to find?"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : undefined}
                />
              </div>

              <button
                type="submit"
                disabled={isSimulating || query.trim().length < 2}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900"
              >
                {isSimulating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Querying BuyWhere...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    Run Query
                  </>
                )}
              </button>

              {error && (
                <p id={errorId} className="text-sm text-amber-400" role="alert">
                  {error}
                </p>
              )}
            </form>

            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-400 uppercase tracking-wide">Example queries</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_QUERIES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setQuery(example)}
                    className="rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:border-indigo-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-slate-950 rounded-xl overflow-hidden border border-slate-800">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/70"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500/70"></div>
                <div className="w-3 h-3 rounded-full bg-green-500/70"></div>
                <span className="ml-2 text-xs text-slate-500 font-mono">agent_response.json</span>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                disabled={!demoData}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-400 transition-colors hover:text-white hover:bg-slate-800 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-label="Copy JSON"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="p-4 overflow-x-auto">
              {isSimulating ? (
                <ProcessingAnimation />
              ) : demoData ? (
                <pre className="text-sm text-slate-300 font-mono leading-relaxed">
                  <code>{JSON.stringify(demoData, null, 2)}</code>
                </pre>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
                  <Bot className="w-8 h-8 text-slate-600" />
                  <p className="text-sm text-slate-500">
                    Enter a query and click Run Query to see the response
                  </p>
                </div>
              )}
            </div>
            {demoData && (
              <div className="px-4 py-3 border-t border-slate-800 flex items-center gap-4 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {demoData.latency_ms}ms
                </span>
                <span className="inline-flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  {demoData.total_results} results
                </span>
                {demoData.products.map((p) => (
                  <BuyWhereScoreBadge key={p.id} score={p.buywhere_score} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default AgentSimulation;