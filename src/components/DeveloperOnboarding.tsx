'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Copy, Check, ChevronRight, Bot, Zap } from 'lucide-react';

const integrationSteps = [
  { step: '1', title: 'Create API key', desc: 'Get your free key at /api-keys. No card required.' },
  { step: '2', title: 'Run first query', desc: 'Copy, paste, and run the curl request below.' },
  { step: '3', title: 'Connect MCP', desc: 'Add BuyWhere to Claude, Cursor, or any agent.' },
];

const curlExample = `curl "https://api.buywhere.ai/v1/products/search?q=laptop&region=us&currency=USD&limit=3" \\
  -H "Authorization: Bearer YOUR_API_KEY"`;

const pythonExample = `import httpx
client = httpx.Client(
    base_url="https://api.buywhere.ai",
    headers={"Authorization": "Bearer YOUR_API_KEY"}
)
results = client.get("/v1/products/search", params={
    "q": "laptop", "region": "us", "currency": "USD", "limit": 3
}).json()
for p in results["data"]:
    print(f"{p['title']}: \${p['price']} from {p['source']}")`;

const typescriptExample = `const res = await fetch(
  "https://api.buywhere.ai/v1/products/search?q=laptop&region=us&currency=USD&limit=3",
  { headers: { Authorization: "Bearer YOUR_API_KEY" } }
);
const { data } = await res.json();
data.forEach(p => console.log(\`\${p.title}: $\${p.price}\`));`;

const mcpExample = `{
  "mcpServers": {
    "buywhere": {
      "command": "npx",
      "args": ["-y", "@buywhere/mcp-server"],
      "env": {
        "BUYWHERE_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}`;

const agentSnippets = [
  {
    label: 'Claude Desktop',
    lang: 'json',
    code: mcpExample,
    icon: '🤖',
  },
  {
    label: 'curl',
    lang: 'bash',
    code: curlExample,
    icon: '🔧',
  },
  {
    label: 'Python',
    lang: 'python',
    code: pythonExample,
    icon: '🐍',
  },
  {
    label: 'TypeScript',
    lang: 'typescript',
    code: typescriptExample,
    icon: '📘',
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      aria-label={copied ? 'Copied!' : 'Copy code'}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:border-indigo-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

export function DeveloperOnboarding() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <section className="border-b border-slate-200 bg-slate-950 py-20 text-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.15em] text-indigo-300">
          <Zap className="w-3 h-3" aria-hidden="true" />
          2-Minute Integration Guide
        </div>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="text-3xl font-bold leading-tight">
              From zero to first query in under two minutes.
            </h2>
            <p className="mt-4 text-lg text-slate-400 leading-relaxed">
              One API key. One request. Then wire BuyWhere into any agent stack via MCP.
            </p>
            <div className="mt-8 space-y-4">
              {integrationSteps.map((item) => (
                <div key={item.step} className="flex items-start gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold">
                    {item.step}
                  </div>
                  <div>
                    <p className="font-semibold text-white">{item.title}</p>
                    <p className="text-sm text-slate-400">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-col gap-3">
              <Link
                href="/api-keys"
                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
              >
                Get API key
                <ChevronRight className="ml-1 w-4 h-4" aria-hidden="true" />
              </Link>
              <Link
                href="/quickstart"
                className="inline-flex items-center justify-center rounded-xl border border-slate-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-slate-500 hover:bg-slate-800"
              >
                Full quickstart guide
              </Link>
            </div>
          </div>

          <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
            <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3 bg-slate-900/80">
              <div className="w-3 h-3 rounded-full bg-red-500/70" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
              <div className="w-3 h-3 rounded-full bg-green-500/70" />
              <span className="ml-2 text-xs text-slate-500 font-mono">agent-setup</span>
            </div>
            <div className="flex items-center gap-1 border-b border-slate-800 bg-slate-900 px-4 pt-3">
              {agentSnippets.map((snippet, i) => (
                <button
                  key={snippet.label}
                  type="button"
                  onClick={() => setActiveTab(i)}
                  className={`inline-flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    activeTab === i
                      ? 'bg-slate-800 text-white border border-slate-700 border-b-slate-800 -mb-px'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                  }`}
                >
                  <span aria-hidden="true">{snippet.icon}</span>
                  {snippet.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <div className="absolute right-3 top-3 z-10">
                <CopyButton text={agentSnippets[activeTab].code} />
              </div>
              <pre className="overflow-x-auto p-4 pt-8 text-sm text-slate-300 font-mono leading-relaxed">
                <code>{agentSnippets[activeTab].code}</code>
              </pre>
            </div>
          </div>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          <Link
            href="/developers"
            className="group rounded-xl border border-slate-800 bg-slate-900 p-5 transition-colors hover:border-indigo-500/40 hover:bg-slate-800/50"
          >
            <div className="flex items-center gap-2 mb-2">
              <Bot className="w-4 h-4 text-indigo-400" aria-hidden="true" />
              <p className="text-sm font-semibold text-white">Agent Developers</p>
            </div>
            <p className="text-sm text-slate-400">
              MCP tools for Claude Desktop, Cursor, and custom agents. Natural language product search as a tool your agent calls directly.
            </p>
          </Link>
          <Link
            href="/quickstart"
            className="group rounded-xl border border-slate-800 bg-slate-900 p-5 transition-colors hover:border-indigo-500/40 hover:bg-slate-800/50"
          >
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-indigo-400" aria-hidden="true" />
              <p className="text-sm font-semibold text-white">REST API</p>
            </div>
            <p className="text-sm text-slate-400">
              Direct HTTP access for any language. Python, TypeScript, curl — all return the same structured JSON.
            </p>
          </Link>
          <Link
            href="/docs"
            className="group rounded-xl border border-slate-800 bg-slate-900 p-5 transition-colors hover:border-indigo-500/40 hover:bg-slate-800/50"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-semibold text-white">📖</span>
              <p className="text-sm font-semibold text-white">Full Documentation</p>
            </div>
            <p className="text-sm text-slate-400">
              Complete endpoint reference, SDK guides, code samples, and best practices for production workloads.
            </p>
          </Link>
        </div>
      </div>
    </section>
  );
}

export default DeveloperOnboarding;
