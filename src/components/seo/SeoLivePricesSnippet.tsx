import type { SeoLandingPageConfig } from "@/lib/seo-landing-pages";

/**
 * Per-page "Check live prices yourself" snippet block.
 *
 * BUY-74862 (Day 1): an agent or developer who lands on an intent page should
 * be able to pull the same live prices the page shows without reverse-
 * engineering the page. We render the three call paths server-side so they
 * are visible to crawlers (ChatGPT-User, ClaudeBot, PerplexityBot all fetch
 * our pages — `seo_pages` should answer "how do I get this data" inline).
 *
 *   1. REST:  curl /v1/products/search?q=<searchQuery>&country_code=<country>
 *   2. MCP:   https://mcp.buywhere.ai  (stdio/HTTP per MCP spec)
 *   3. Self-serve API key: POST /v1/auth/register?verify=false (one call, free tier)
 *
 * The block reads `searchQuery` and `country` from the page's SeoLandingPageConfig,
 * so every intent page gets a snippet tuned to its own query — not a generic
 * developer CTA. The body copy is intentionally NOT hidden in a `<details>`
 * or behind a client toggle, because answer engines won't run JS to expand it.
 */
export function SeoLivePricesSnippet({ config }: { config: SeoLandingPageConfig }) {
  const searchQuery = config.searchQuery;
  const country = config.country;
  const truncatedQuery = searchQuery.length > 48 ? `${searchQuery.slice(0, 45)}…` : searchQuery;

  const restEndpoint = `https://api.buywhere.ai/v1/products/search?q=${encodeURIComponent(searchQuery)}&country_code=${country.toLowerCase()}`;
  const restCurl = `curl "${restEndpoint}&limit=6"`;

  const registerCurl = `curl -X POST "https://api.buywhere.ai/v1/auth/register?verify=false" \\
  -H "Content-Type: application/json" \\
  -d '{"agent_name":"my-agent"}'`;

  return (
    <section
      className="bg-slate-900 py-16 text-slate-100"
      aria-labelledby="live-prices-snippet-title"
      data-intent-page="live-prices-snippet"
    >
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">
          Check live prices yourself
        </p>
        <h2
          id="live-prices-snippet-title"
          className="mt-3 text-3xl font-semibold tracking-tight text-white"
        >
          Pull the same {truncatedQuery} prices your browser just saw
        </h2>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300">
          Every product card on this page is a snapshot of BuyWhere&apos;s live catalog. If
          you are building an agent, a price tracker, or just want to verify a listing,
          you can hit the same endpoint the page renders. No scraping, no proxies — one
          signed HTTP call and the JSON comes back. Three ways in:
        </p>

        <ol className="mt-10 space-y-6">
          <li>
            <h3 className="text-lg font-semibold text-white">
              1. REST — direct catalog search
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              No auth required for low-volume reads. Returns the same merchant metadata
              this page ranks on.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950/70 p-4 text-xs leading-5 text-emerald-200 ring-1 ring-white/10">
              <code>{restCurl}</code>
            </pre>
          </li>

          <li>
            <h3 className="text-lg font-semibold text-white">
              2. MCP — tool-callable from any agent
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Connect once and your agent can call <code className="rounded bg-slate-800 px-1.5 py-0.5 text-emerald-200">search_products</code>,
              {" "}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-emerald-200">find_best_price</code>, and
              {" "}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-emerald-200">get_deals</code> directly.
            </p>
            <p className="mt-3 text-sm">
              <a
                href="https://mcp.buywhere.ai"
                className="font-semibold text-amber-200 underline-offset-4 hover:text-amber-100 hover:underline"
              >
                https://mcp.buywhere.ai →
              </a>
            </p>
          </li>

          <li>
            <h3 className="text-lg font-semibold text-white">
              3. Self-serve API key — one call, no dashboard
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Higher rate limits and MCP access need a key. Register takes one POST; the
              free tier is enough for most prototypes.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950/70 p-4 text-xs leading-5 text-emerald-200 ring-1 ring-white/10">
              <code>{registerCurl}</code>
            </pre>
          </li>
        </ol>
      </div>
    </section>
  );
}
