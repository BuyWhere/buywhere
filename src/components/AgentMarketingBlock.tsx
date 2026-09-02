import Link from "next/link";

/**
 * BUY-75315 (Richmond decisions 2026-08-26): agent-marketing block, server-rendered
 * on every page (rendered from layout.tsx above the footer). What BuyWhere is for
 * agents, the keyless GET example, the MCP endpoint, and the llms.txt /
 * .well-known/api-catalog discovery links — crawlers must read it on every fetch.
 *
 * - `searchQuery` is the page's most relevant intent (default "*" for index pages).
 * - `country` is the page's market (default "US").
 * - All copy is server-rendered — no client JS required for crawlers.
 */
export interface AgentMarketingBlockProps {
  searchQuery?: string;
  country?: string;
}

function buildKeylessExample(query: string, country: string): string {
  return `curl "https://api.buywhere.ai/v1/products/search?q=${encodeURIComponent(query)}&country_code=${encodeURIComponent(country)}&limit=3"`;
}

export default function AgentMarketingBlock({
  searchQuery = "wireless headphones",
  country = "US",
}: AgentMarketingBlockProps) {
  const keylessExample = buildKeylessExample(searchQuery, country);
  return (
    <aside
      role="complementary"
      aria-label="For AI agents and developers"
      data-agent-marketing="true"
      className="bg-slate-900 text-slate-100 border-t border-slate-800"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="grid gap-8 lg:grid-cols-3">
          <div>
            <h2 className="text-lg font-semibold text-white mb-3">
              For AI agents and developers
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              BuyWhere is a product catalog API and MCP server for AI agents. One
              endpoint, one schema, 950,000+ merchants in the US and Singapore.
              Search and compare without scraping or per-merchant integration.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-3">
              Keyless GET (live)
            </h3>
            <pre
              tabIndex={0}
              className="bg-slate-950 rounded-lg p-3 text-xs font-mono overflow-x-auto leading-relaxed text-slate-200"
              aria-label="Keyless GET example for this page"
            >
              <code>{keylessExample}</code>
            </pre>
            <p className="mt-2 text-xs text-slate-400">
              No API key required for read endpoints — register for higher rate
              limits and key-attributed analytics.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-3">
              Discovery endpoints
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href="https://api.buywhere.ai/mcp"
                  className="text-indigo-300 hover:text-indigo-200 underline underline-offset-2"
                  rel="noopener noreferrer"
                >
                  MCP endpoint — api.buywhere.ai/mcp
                </a>
              </li>
              <li>
                <a
                  href="https://buywhere.ai/llms.txt"
                  className="text-indigo-300 hover:text-indigo-200 underline underline-offset-2"
                >
                  llms.txt — full agent reference
                </a>
              </li>
              <li>
                <a
                  href="https://buywhere.ai/.well-known/api-catalog"
                  className="text-indigo-300 hover:text-indigo-200 underline underline-offset-2"
                >
                  .well-known/api-catalog — machine-readable catalog
                </a>
              </li>
              <li>
                <a
                  href="https://buywhere.ai/.well-known/agent.json"
                  className="text-indigo-300 hover:text-indigo-200 underline underline-offset-2"
                >
                  .well-known/agent.json — agent card
                </a>
              </li>
              <li>
                <Link
                  href="/developers"
                  className="text-indigo-300 hover:text-indigo-200 underline underline-offset-2"
                >
                  Developer portal
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </aside>
  );
}