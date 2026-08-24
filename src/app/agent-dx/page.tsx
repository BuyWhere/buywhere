import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Schema from "@/components/Schema";
import { buildWebPageSchema } from "@/lib/page-schema";
import { buildPageMetadata } from "@/lib/page-metadata";

export const metadata = buildPageMetadata({
  title: "BuyWhere Agent DX — v2 Wire Reference",
  description:
    "v2-first developer reference for the BuyWhere MCP JSON-RPC wire. search_products_v2, find_best_price_v2, get_deals_v2, compare_products_v2, get_product_v2 — all with REQUIRED deliver_to, shopping_job_id, and outbound_url.",
  path: "/agent-dx",
});

const v2Version = "v2.0.0-2026-09-15";

const intentTable = [
  ["find X / search for X / show X", "search_products_v2"],
  ["cheapest X / best price for X", "find_best_price_v2"],
  ["deals on X / discounts on X", "get_deals_v2"],
  ["compare A vs B / A vs B vs C", "compare_products_v2"],
  ["details on product <id> / tell me more", "get_product_v2"],
] as const;

const sunsetClock = [
  ["2026-09-15Z", "v2 wire live; v2 tools exposed on /mcp tools/list with REQUIRED deliver_to."],
  ["2026-10-01Z", "v1 tools deprecated; server-card prepends [DEPRECATED — use v2] to each v1 description."],
  ["2026-12-31Z", "v1 tools return HTTP 410 Gone with migration notice."],
] as const;

const v2WireExample = `{
  "mcpServers": {
    "buywhere": {
      "command": "npx",
      "args": ["-y", "@buywhere/mcp-server"],
      "env": {
        "BUYWHERE_API_KEY": "bw_live_your_key_here",
        "BUYWHERE_WIRE_VERSION": "v2"
      }
    }
  }
}`;

type V2Tool = {
  name: string;
  purpose: string;
  required: string[];
  request: string;
  response: string;
};

const v2Tools: V2Tool[] = [
  {
    name: "search_products_v2",
    purpose: "Search the catalog by keyword. Returns ranked, deliverable-first results with schema.org/Product entities.",
    required: ["q", "deliver_to"],
    request: `{
  "q": "wireless headphones",
  "deliver_to": "SG",
  "limit": 10,
  "category": "Headphones",
  "min_price": 50,
  "max_price": 800,
  "sort": "best_value"
}`,
    response: `{
  "data": [
    {
      "id": "bw_sg_12345",
      "title": "Sony WH-1000XM5",
      "price": 429.0,
      "currency": "SGD",
      "domain": "hifisolutions.sg",
      "url": "https://hifisolutions.sg/products/sony-wh-1000xm5",
      "buywhere_score": 0.92,
      "availability": "in_stock",
      "deliver_to": "SG"
    }
  ],
  "meta": {
    "total": 124,
    "limit": 10,
    "offset": 0,
    "shopping_job_id": "9f3a4b1e-7c2d-4a8e-b651-2c0a4f7b9d3e"
  }
}`,
  },
  {
    name: "find_best_price_v2",
    purpose: "Find the single cheapest deliverable listing for a product across covered storefronts. Returns shopping_job_id and a resolved outbound_url.",
    required: ["q", "deliver_to"],
    request: `{
  "q": "iphone 17 pro 256gb",
  "deliver_to": "SG",
  "category": "Smartphones"
}`,
    response: `{
  "data": {
    "id": "bw_sg_98765",
    "title": "Apple iPhone 17 Pro 256GB",
    "lowPrice": 1599.0,
    "priceCurrency": "SGD",
    "offerCount": 6,
    "merchant": "Best Denki",
    "outbound_url": "https://api.buywhere.ai/v2/outbound/9f3a4b1e-7c2d-4a8e-b651-2c0a4f7b9d3e?to=best-denki-sg"
  },
  "shopping_job_id": "9f3a4b1e-7c2d-4a8e-b651-2c0a4f7b9d3e",
  "deliver_to": "SG"
}`,
  },
  {
    name: "get_deals_v2",
    purpose: "Discounted products sorted by discount percentage. Carries a shopping_job_id envelope so the agent hands the user a single outbound_url.",
    required: ["deliver_to"],
    request: `{
  "deliver_to": "US",
  "min_discount_pct": 20,
  "category": "Laptops",
  "limit": 20
}`,
    response: `{
  "data": [
    {
      "id": "bw_us_55432",
      "title": "Lenovo IdeaPad 5 14\"",
      "price": 549.0,
      "originalPrice": 799.0,
      "discountPercentage": 31.3,
      "priceCurrency": "USD",
      "availability": "in_stock",
      "outbound_url": "https://api.buywhere.ai/v2/outbound/4b1e9f3a-2c0a-4f7b-9d3e-7c2d8e651a4f?to=lenovo-us"
    }
  ],
  "shopping_job_id": "4b1e9f3a-2c0a-4f7b-9d3e-7c2d8e651a4f",
  "deliver_to": "US"
}`,
  },
  {
    name: "compare_products_v2",
    purpose: "Compare 2 to 10 products side-by-side. Each row carries the buyer's deliver_to availability state.",
    required: ["ids", "deliver_to"],
    request: `{
  "ids": ["bw_sg_12345", "bw_sg_67890", "bw_sg_24680"],
  "deliver_to": "SG"
}`,
    response: `{
  "data": [
    {
      "id": "bw_sg_12345",
      "title": "Sony WH-1000XM5",
      "price": 429.0,
      "currency": "SGD",
      "availability": "in_stock",
      "buywhere_score": 0.92,
      "deliver_to": "SG"
    }
  ],
  "shopping_job_id": "8a2c4d6e-1f3b-4a5d-9c7e-2b8d0f4a6c8e",
  "deliver_to": "SG"
}`,
  },
  {
    name: "get_product_v2",
    purpose: "Retrieve full details for a specific product. Adds an outbound_url resolver so the agent can return a direct handoff to the merchant.",
    required: ["id", "deliver_to"],
    request: `{
  "id": "bw_sg_12345",
  "deliver_to": "SG"
}`,
    response: `{
  "data": {
    "id": "bw_sg_12345",
    "title": "Sony WH-1000XM5",
    "description": "Industry-leading noise cancellation...",
    "price": 429.0,
    "currency": "SGD",
    "availability": "in_stock",
    "merchant": "Hifi Solutions",
    "outbound_url": "https://api.buywhere.ai/v2/outbound/2c8d0f4a-6a8c-4e2b-9d4f-1a3c5e7b9d2f?to=hifisolutions-sg",
    "structured_specs": { "/* ... */": null }
  },
  "shopping_job_id": "2c8d0f4a-6a8c-4e2b-9d4f-1a3c5e7b9d2f",
  "deliver_to": "SG"
}`,
  },
];

const v1DeprecatedTools = [
  ["search_products", "query, category, min_price, max_price, source, deliver_to?, limit"],
  ["get_product", "product_id"],
  ["find_best_price", "product_name, category, deliver_to?"],
  ["get_deals", "category, min_discount_pct=10, deliver_to?, limit=20"],
  ["compare_products", "ids (CSV string), deliver_to? — v2 expects an array of 2-10"],
  ["list_categories", "currency"],
  ["find_similar", "product_id"],
  ["ingest_products", "product_url"],
];

export default function AgentDxPage() {
  const schema = buildWebPageSchema({
    path: "/agent-dx",
    name: "BuyWhere Agent DX — v2 Wire Reference",
    description:
      "v2-first developer reference for the BuyWhere MCP JSON-RPC wire. Required deliver_to, shopping_job_id, and outbound_url across all buyer-context tools.",
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Agent DX", path: "/agent-dx" },
    ],
  });

  return (
    <>
      <Schema data={schema} />
      <div className="flex min-h-screen flex-col bg-slate-50">
        <Nav />

        <main id="main-content" className="flex-1">
          <section className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.16),transparent_32%),radial-gradient(circle_at_top_right,rgba(99,102,241,0.16),transparent_28%),linear-gradient(135deg,#0f172a_0%,#111827_56%,#172554_100%)] text-white">
            <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
                  v2 Wire · {v2Version}
                </div>
                <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
                  BuyWhere Agent DX — v2-first wire reference
                </h1>
                <p className="mt-6 text-lg leading-8 text-slate-300">
                  The v2 wire is the primary surface for AI agents calling BuyWhere. Every buyer-context
                  tool requires <code className="text-cyan-200">deliver_to</code> and returns a
                  <code className="text-cyan-200"> shopping_job_id</code> plus a resolved
                  <code className="text-cyan-200"> outbound_url</code>. v1 tools remain callable through
                  2026-12-31Z and are documented at the bottom of this page.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    href="/api-keys"
                    className="inline-flex items-center justify-center rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300"
                  >
                    Get API key
                  </Link>
                  <Link
                    href="/integrate"
                    className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                  >
                    MCP setup
                  </Link>
                  <a
                    href="/agent-dx.md"
                    className="inline-flex items-center justify-center rounded-xl border border-indigo-300/25 bg-indigo-300/10 px-5 py-3 text-sm font-semibold text-indigo-100 transition-colors hover:bg-indigo-300/20"
                  >
                    Raw markdown
                  </a>
                </div>
              </div>
            </div>
          </section>

          <section className="border-b border-slate-200 bg-white py-16">
            <div className="mx-auto max-w-4xl px-4 sm:px-6">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Why this changed</p>
              <h2 className="mt-3 text-3xl font-bold text-slate-900">Why deliver_to is now required</h2>
              <p className="mt-4 text-lg leading-8 text-slate-600">
                In v1, <code className="text-indigo-700">deliver_to</code> was optional. In practice, 94% of
                agent calls omitted it, forcing the catalog to scan every market (SG, MY, ID, TH, VN, US)
                and either time out or return rankings that were not useful for the buyer&rsquo;s actual
                location. The v2 wire makes <code className="text-indigo-700">deliver_to</code> mandatory
                on every buyer-context tool so the catalog can scope the search, return local-availability
                labels, and emit a <code className="text-indigo-700">shopping_job_id</code> that lets the
                agent resume the purchase funnel on the merchant site. Agents that omit
                <code className="text-indigo-700"> deliver_to</code> on a v2 tool receive
                <code className="text-indigo-700"> -32602 INVALID_ARGUMENT</code> so the failure is loud, not
                silent.
              </p>
              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">deliver_to format</p>
                <pre className="mt-2 text-sm font-mono text-slate-800">ISO 3166-1 alpha-2 country code (e.g. &quot;SG&quot;, &quot;US&quot;, &quot;MY&quot;, &quot;TH&quot;, &quot;VN&quot;, &quot;ID&quot;)</pre>
              </div>
            </div>
          </section>

          <section className="border-b border-slate-200 bg-slate-50 py-16">
            <div className="mx-auto max-w-4xl px-4 sm:px-6">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Tool selection</p>
              <h2 className="mt-3 text-3xl font-bold text-slate-900">Which v2 tool fits which intent</h2>
              <div className="mt-8 overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-4 py-3 font-semibold">User intent</th>
                      <th className="px-4 py-3 font-semibold">v2 tool</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {intentTable.map(([intent, tool]) => (
                      <tr key={tool}>
                        <td className="px-4 py-3 text-slate-700">{intent}</td>
                        <td className="px-4 py-3 font-mono text-indigo-700">{tool}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-500">
                <code className="font-mono">list_categories</code>, <code className="font-mono">find_similar</code>, and
                <code className="font-mono"> ingest_products</code> remain v1-only — they are not buyer-context
                tools and do not require <code className="font-mono">deliver_to</code>.
              </p>
            </div>
          </section>

          <section className="border-b border-slate-200 bg-white py-16">
            <div className="mx-auto max-w-4xl px-4 sm:px-6">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">v2 wire setup</p>
              <h2 className="mt-3 text-3xl font-bold text-slate-900">Wire your agent to the v2 surface</h2>
              <p className="mt-4 text-lg leading-8 text-slate-600">
                The v2 wire is exposed at <code className="text-indigo-700">POST https://api.buywhere.ai/mcp</code> via
                JSON-RPC 2.0. Both <code className="text-indigo-700">streamable-http</code> and the legacy
                <code className="text-indigo-700"> sse</code> transports are supported. The MCP server-card at
                <code className="text-indigo-700"> /.well-known/mcp/server-card.json</code> is the authoritative
                machine-readable copy of these tools.
              </p>
              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-950 p-6 text-slate-100">
                <pre className="overflow-x-auto text-sm font-mono leading-7">{v2WireExample}</pre>
              </div>
            </div>
          </section>

          <section className="border-b border-slate-200 bg-slate-50 py-16">
            <div className="mx-auto max-w-4xl px-4 sm:px-6">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">v2 tools</p>
              <h2 className="mt-3 text-3xl font-bold text-slate-900">Five v2 tools, one REQUIRED field</h2>
              <div className="mt-10 space-y-12">
                {v2Tools.map((tool, index) => (
                  <article
                    key={tool.name}
                    className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm"
                    id={tool.name}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">v2 · Tool {index + 1}</p>
                        <h3 className="mt-2 text-2xl font-bold text-slate-900">
                          <code className="font-mono">{tool.name}</code>
                        </h3>
                      </div>
                      <span className="shrink-0 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-800">
                        REQUIRED deliver_to
                      </span>
                    </div>
                    <p className="mt-4 text-base leading-7 text-slate-600">{tool.purpose}</p>
                    <p className="mt-4 text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">Required</p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {tool.required.map((field) => (
                        <li
                          key={field}
                          className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 font-mono text-xs text-slate-700"
                        >
                          {field}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-6 text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">Request</p>
                    <div className="mt-2 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-950 p-5 text-slate-100">
                      <pre className="text-sm font-mono leading-7">{tool.request}</pre>
                    </div>
                    <p className="mt-6 text-sm font-semibold uppercase tracking-[0.15em] text-slate-500">Response</p>
                    <div className="mt-2 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-950 p-5 text-slate-100">
                      <pre className="text-sm font-mono leading-7">{tool.response}</pre>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="border-b border-slate-200 bg-white py-16">
            <div className="mx-auto max-w-4xl px-4 sm:px-6">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Sunset clock</p>
              <h2 className="mt-3 text-3xl font-bold text-slate-900">When v1 leaves the wire</h2>
              <div className="mt-8 overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Date</th>
                      <th className="px-4 py-3 font-semibold">Event</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {sunsetClock.map(([date, event]) => (
                      <tr key={date}>
                        <td className="px-4 py-3 font-mono text-slate-700">{date}</td>
                        <td className="px-4 py-3 text-slate-600">{event}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="border-b border-slate-200 bg-slate-50 py-16">
            <div className="mx-auto max-w-4xl px-4 sm:px-6">
              <details className="rounded-[28px] border border-amber-200 bg-amber-50 p-8 shadow-sm">
                <summary className="cursor-pointer text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">
                  v1 (deprecated) — collapsible reference
                </summary>
                <p className="mt-4 text-base leading-7 text-amber-900">
                  The v1 tools remain callable until <strong>2026-12-31Z</strong>. New agent work should
                  target the v2 wire above. The v1 tools match v2 request bodies <em>except</em>
                  <code className="ml-1 font-mono">deliver_to</code> is optional and the response does
                  not include <code className="font-mono">shopping_job_id</code> or
                  <code className="font-mono"> outbound_url</code>.
                </p>
                <div className="mt-6 overflow-x-auto rounded-2xl border border-amber-200 bg-white">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="bg-amber-100 text-amber-900">
                      <tr>
                        <th className="px-4 py-3 font-semibold">v1 tool</th>
                        <th className="px-4 py-3 font-semibold">Parameters</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-200 bg-white">
                      {v1DeprecatedTools.map(([tool, params]) => (
                        <tr key={tool}>
                          <td className="px-4 py-3 font-mono text-amber-900">{tool}</td>
                          <td className="px-4 py-3 font-mono text-amber-800">{params}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-6 text-sm leading-6 text-amber-900">
                  v1 wire version: <code className="font-mono">1.0.0</code>. Server-card version remains
                  <code className="font-mono"> 1.0.0</code>; the v2 marker lives in the top-level
                  <code className="font-mono"> x-buywhere-v2</code> extension field.
                </p>
              </details>
            </div>
          </section>

          <section className="border-b border-slate-200 bg-white py-16">
            <div className="mx-auto max-w-4xl px-4 sm:px-6">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Empty results</p>
              <h2 className="mt-3 text-3xl font-bold text-slate-900">When a v2 tool returns zero products</h2>
              <p className="mt-4 text-base leading-7 text-slate-600">
                Empty results are still <code className="font-mono">200 OK</code>. The response includes a
                <code className="font-mono">meta.emptiness_reason</code> enum so your agent can distinguish
                &ldquo;no catalog data&rdquo; from &ldquo;query mismatch&rdquo; from &ldquo;API degraded.&rdquo; The field appears only when the
                result array is empty; non-empty responses never carry it.
              </p>

              <div className="mt-8 overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-4 py-3 font-semibold"><code className="font-mono">emptiness_reason</code></th>
                      <th className="px-4 py-3 font-semibold">What it means</th>
                      <th className="px-4 py-3 font-semibold">What your agent should do</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {[
                      ["no_data", "Region has zero products indexed.", "Treat as authoritative; no retry."],
                      ["no_match", "Region has products, but query/filters excluded all of them.", "Widen query or drop filters; do not retry the same query."],
                      ["api_error", "Downstream error caused the engine to fall back to empty.", "Retry once with a short backoff (≤2s); surface as ambiguous if still empty."],
                      ["quota", "Rate-limit guardrail tripped.", "Wait for the rate-limit window; do not retry-storm."],
                      ["region_unsupported", "Country code is not in the supported set.", "Re-issue with a supported region."],
                      ["category_unsupported", "Category slug is unknown or in transition.", "Drop category or consult /v1/categories."],
                      ["deliver_to_missing", "You omitted deliver_to/country_code, but the catalog has matches elsewhere.", "Re-issue with deliver_to set to the buyer's country."],
                      ["invalid_deliver_to", "deliver_to is not a supported ISO code (MCP v2 only).", "Use a supported code from the hint field."],
                    ].map(([reason, meaning, action]) => (
                      <tr key={reason}>
                        <td className="px-4 py-3 font-mono text-slate-700">{reason}</td>
                        <td className="px-4 py-3 text-slate-600">{meaning}</td>
                        <td className="px-4 py-3 text-slate-600">{action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-8 rounded-2xl bg-slate-50 p-6">
                <p className="text-sm font-semibold text-slate-700">Confidence field</p>
                <p className="mt-2 text-base leading-7 text-slate-600">
                  Every empty result also carries <code className="font-mono">meta.confidence</code> of{" "}
                  <code className="font-mono">high</code> or <code className="font-mono">low</code>. When
                  confidence is <code className="font-mono">low</code>, your agent should retry once after a
                  short backoff; otherwise, treat the reason as authoritative.
                </p>
              </div>

              <div className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-6">
                <p className="text-sm font-semibold text-indigo-700">Diagnostic block</p>
                <p className="mt-2 text-base leading-7 text-indigo-900">
                  <code className="font-mono">meta.diagnostic</code> includes{" "}
                  <code className="font-mono">engine_status</code>,{" "}
                  <code className="font-mono">indexed_for_region</code>,{" "}
                  <code className="font-mono">category_recognized</code>,{" "}
                  <code className="font-mono">rate_limit_remaining</code>, and{" "}
                  <code className="font-mono">deliver_to_present</code>. See the full reference in{" "}
                  <a href="/docs/errors#empty-result-envelope-metaemptiness_reason" className="font-semibold underline decoration-indigo-400 underline-offset-2">
                    Error Reference → Empty-Result Envelope
                  </a>.
                </p>
              </div>
            </div>
          </section>

          <section className="bg-[linear-gradient(135deg,#0f172a_0%,#111827_60%,#1d4ed8_100%)] py-16 text-white">
            <div className="mx-auto max-w-5xl px-4 text-center sm:px-6">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Acceptance contract</p>
              <h2 className="mt-4 text-3xl font-bold sm:text-4xl">This page mirrors the MCP server-card</h2>
              <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-slate-300">
                The README at <code className="text-cyan-200">/agent-dx</code> is the canonical copy of this
                document. The MCP server-card at <code className="text-cyan-200">/.well-known/mcp/server-card.json</code>
                mirrors these descriptions word-for-word. Changes to either surface MUST be made in
                lockstep. Atlas (BUY-72482) verifies live parity on every heartbeat.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link
                  href="/integrate"
                  className="inline-flex items-center justify-center rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300"
                >
                  MCP setup
                </Link>
                <a
                  href="/.well-known/mcp/server-card.json"
                  className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                >
                  MCP server-card
                </a>
              </div>
            </div>
          </section>
        </main>

        <Footer />
      </div>
    </>
  );
}
