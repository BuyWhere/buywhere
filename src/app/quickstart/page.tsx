import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "BuyWhere Quickstart",
  description: "Create a BuyWhere API key, run your first product search, and add BuyWhere to an MCP-compatible agent in minutes.",
  alternates: {
    canonical: "https://buywhere.ai/quickstart",
  },
};

const curlExample = `curl -sS "https://api.buywhere.ai/v1/products/search?q=wireless+headphones&limit=5" \\
  -H "Authorization: Bearer bw_live_your_key_here"`;

const responseExample = `{
  "data": [
    {
      "id": "bw_sg_12345",
      "title": "Sony WH-1000XM5 Wireless Headphones",
      "price": 429.0,
      "currency": "SGD",
      "domain": "lazada.sg",
      "url": "https://...",
      "source": "lazada_sg",
      "country_code": "SG"
    }
  ],
  "meta": {
    "total": 5,
    "limit": 5,
    "offset": 0
  }
}`;

const mcpConfig = `{
  "mcpServers": {
    "buywhere": {
      "command": "npx",
      "args": ["-y", "@buywhere/mcp-server"],
      "env": {
        "BUYWHERE_API_KEY": "bw_live_your_key_here"
      }
    }
  }
}`;

function CodeBlock({
  label,
  code,
}: {
  label: string;
  code: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-950 shadow-[0_24px_80px_rgba(15,23,42,0.32)]">
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900/80 px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-[0.22em] text-gray-400">{label}</span>
        <span className="text-xs text-gray-500">Copy and run</span>
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-6 text-gray-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function QuickstartPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Nav />

      <section className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(79,70,229,0.18),_transparent_38%),linear-gradient(135deg,#0f172a_0%,#111827_48%,#1e1b4b_100%)] text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-20 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-indigo-100">
              Canonical developer quickstart
            </div>
            <h1 className="max-w-2xl text-4xl font-bold leading-tight sm:text-5xl">
              API key to first BuyWhere query in under five minutes.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
              BuyWhere gives AI agents a product catalog layer for live product discovery, comparison, and merchant handoff across the US and Southeast Asia.
            </p>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-400">
              Start with one live API request, then add the published MCP package when you want BuyWhere tools inside your agent client.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/api-keys"
                className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-indigo-700 transition-colors hover:bg-slate-100"
              >
                Get API key
              </Link>
              <a
                href="https://api.buywhere.ai/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Full API docs
              </a>
            </div>
          </div>

          <div className="grid gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm sm:grid-cols-3 lg:min-w-[420px] lg:grid-cols-1">
            {[
              { label: "Step 1", title: "Create a key", text: "Use the self-serve beta signup form. No card, no sales call." },
              { label: "Step 2", title: "Run search", text: "Call `GET /v1/products/search` with a bearer token and natural-language query." },
              { label: "Step 3", title: "Connect MCP", text: "Add BuyWhere to Claude, Cursor, or any compatible desktop client." },
            ].map((item) => (
              <div key={item.title}>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-indigo-200">{item.label}</p>
                <p className="mt-2 text-lg font-semibold text-white">{item.title}</p>
                <p className="mt-1 text-sm leading-6 text-slate-300">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-50 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mb-10 max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-indigo-600">Step 1</p>
            <h2 className="mt-3 text-3xl font-bold text-slate-900">Create your API key</h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">
              Use the BuyWhere beta signup flow to provision a working key instantly. The success screen gives you a ready-to-run request, and the same key is emailed to you for safekeeping.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
              <ol className="space-y-5 text-sm leading-7 text-slate-600">
                <li>
                  Open <Link href="/api-keys" className="font-semibold text-indigo-600 hover:underline">buywhere.ai/api-keys</Link>.
                </li>
                <li>Enter your name and email, then choose the closest use case for your app or agent.</li>
                <li>Submit the form to receive a live beta key in the browser immediately.</li>
                <li>Treat the key like a password. The browser shows it once, then the page moves you into testing.</li>
              </ol>
            </div>

            <div className="rounded-3xl border border-indigo-100 bg-indigo-50 p-8">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">What you get</p>
              <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-700">
                <li>Instant access to authenticated `v1` endpoints</li>
                <li>A copy-paste terminal test on the success screen</li>
                <li>Email delivery for the same key</li>
                <li>A direct path into MCP and full API docs</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-white py-16">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-indigo-600">Step 2</p>
            <h2 className="mt-3 text-3xl font-bold text-slate-900">Run your first product search</h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">
              BuyWhere&apos;s quickest activation path is a single authenticated request to <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm text-slate-900">GET /v1/products/search</code>.
            </p>
            <div className="mt-8 rounded-3xl border border-slate-200 bg-slate-50 p-6">
              <p className="text-sm font-semibold text-slate-900">Request checklist</p>
              <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-600">
                <li>Base URL: <code className="rounded bg-white px-1.5 py-0.5 text-slate-900">https://api.buywhere.ai</code></li>
                <li>Auth: <code className="rounded bg-white px-1.5 py-0.5 text-slate-900">Authorization: Bearer YOUR_KEY</code></li>
                <li>Required query: <code className="rounded bg-white px-1.5 py-0.5 text-slate-900">q</code></li>
                <li>Helpful starter params: <code className="rounded bg-white px-1.5 py-0.5 text-slate-900">limit</code>, <code className="rounded bg-white px-1.5 py-0.5 text-slate-900">country_code</code>, <code className="rounded bg-white px-1.5 py-0.5 text-slate-900">domain</code>, <code className="rounded bg-white px-1.5 py-0.5 text-slate-900">min_price</code>, <code className="rounded bg-white px-1.5 py-0.5 text-slate-900">max_price</code></li>
              </ul>
            </div>
          </div>

          <div className="space-y-6">
            <CodeBlock label="curl" code={curlExample} />
            <CodeBlock label="json" code={responseExample} />
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-slate-950 py-16 text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">Step 3</p>
            <h2 className="mt-3 text-3xl font-bold">Connect BuyWhere to MCP</h2>
            <p className="mt-4 text-lg leading-8 text-slate-300">
              Use the published BuyWhere MCP package to expose product search and comparison tools inside Claude Desktop, Cursor, and other MCP-compatible environments.
            </p>
            <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-6">
              <p className="text-sm font-semibold text-white">Setup notes</p>
              <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-300">
                <li>Run BuyWhere locally through <code className="rounded bg-white/10 px-1.5 py-0.5 text-white">npx -y @buywhere/mcp-server</code>.</li>
                <li>Set <code className="rounded bg-white/10 px-1.5 py-0.5 text-white">BUYWHERE_API_KEY</code> in the MCP server environment.</li>
                <li>Use the client-specific setup guide at <Link href="/integrate" className="font-semibold text-cyan-300 hover:underline">buywhere.ai/integrate</Link>.</li>
              </ul>
            </div>
          </div>

          <CodeBlock label="claude_desktop_config.json" code={mcpConfig} />
        </div>
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="rounded-[2rem] border border-slate-200 bg-[linear-gradient(135deg,#eef2ff_0%,#ffffff_55%,#ecfeff_100%)] p-8 shadow-sm sm:p-10">
            <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-indigo-600">Next steps</p>
                <h2 className="mt-3 text-3xl font-bold text-slate-900">Keep this URL as your canonical onboarding entry point</h2>
                <p className="mt-4 text-lg leading-8 text-slate-600">
                  Share <code className="rounded bg-white px-1.5 py-0.5 text-slate-900">https://buywhere.ai/quickstart</code> anywhere you send developers. It covers the activation path end-to-end and branches into deeper docs only after the first successful request.
                </p>
              </div>

              <div className="grid gap-4">
                <a
                  href="https://api.buywhere.ai/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-indigo-200 hover:bg-indigo-50"
                >
                  <p className="text-sm font-semibold text-slate-900">Full API documentation</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">Endpoint reference, samples, SDK notes, and expanded guides.</p>
                </a>
                <a
                  href="https://github.com/BuyWhere/buywhere-mcp"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-indigo-200 hover:bg-indigo-50"
                >
                  <p className="text-sm font-semibold text-slate-900">Official MCP repository</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">Published BuyWhere MCP package, setup instructions, and client configuration examples.</p>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
