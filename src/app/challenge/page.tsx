import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Build With BuyWhere — Showcase Your AI Shopping Agent",
  description:
    "Build an AI shopping agent using BuyWhere's API or MCP tools and showcase it to the community. Get started with free API credits and join developers building the future of shopping.",
  alternates: {
    canonical: "https://buywhere.ai/challenge",
  },
  openGraph: {
    title: "Build With BuyWhere",
    description:
      "Build an AI shopping agent using BuyWhere's API or MCP tools and showcase it to the community.",
    url: "https://buywhere.ai/challenge",
    type: "website",
  },
};

const quickStartCode = `{
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

const searchToolSchema = `{
  "type": "function",
  "function": {
    "name": "search_products",
    "description": "Search BuyWhere catalog for products",
    "parameters": {
      "type": "object",
      "properties": {
        "q": { "type": "string" },
        "country_code": { "type": "string" },
        "max_price": { "type": "number" },
        "limit": { "type": "integer", "default": 5 }
      },
      "required": ["q", "country_code"]
    }
  }
}`;

const agentExample = `User: best laptop under $1000

Agent -> search_products({
  "q": "laptop",
  "country_code": "US",
  "max_price": 1000,
  "limit": 5
})

Agent: Top recommendation: Acer Aspire 5 at $899.
Alternatives: Lenovo at $749, ASUS at $999.`;

const projectIdeas = [
  {
    name: "Deal Discord Bot",
    description: "A Discord bot that lets users search products and get price comparisons right in chat.",
    code: `// MCP tool call in your Discord bot
const result = await agent.callTool("search_products", {
  q: query,
  country_code: "US",
  max_price: budget,
  limit: 5
});`,
    tags: ["Discord", "Node.js", "MCP"],
  },
  {
    name: "Price Tracker Telegram Bot",
    description: "A Telegram bot that monitors prices on your wishlist and alerts you when prices drop.",
    code: `// Search and compare prices
const products = await buywhere.search({
  q: "wireless headphones",
  country_code: "SG",
  limit: 10
});`,
    tags: ["Telegram", "Python", "Price Alerts"],
  },
  {
    name: "BuyWhere Cursor Plugin",
    description: "A Cursor editor extension that helps developers test BuyWhere API calls while building agents.",
    code: `// Tool schema ready to paste into Cursor
// Use search_products before answering
// any shopping-related questions`,
    tags: ["Cursor", "MCP", "Developer Tool"],
  },
];

const steps = [
  {
    step: "1",
    title: "Get your API key",
    desc: "Sign up for a free BuyWhere API key. No credit card required.",
    cta: { label: "Get API key", href: "/api-keys" },
  },
  {
    step: "2",
    title: "Connect MCP",
    desc: "Add BuyWhere MCP to Claude Desktop, Cursor, or any MCP-compatible client in under 5 minutes.",
    cta: { label: "Read the quickstart", href: "/quickstart" },
  },
  {
    step: "3",
    title: "Build and share",
    desc: "Build an agent that uses BuyWhere product search. Share your project with the community.",
    cta: { label: "Submit your project", href: "https://github.com/buywhere/buywhere-site/issues/new?labels=showcase&template=build-with-buywhere-submission.yml" },
  },
];

const showcaseProjects = [
  {
    name: "Be the first to build",
    builder: "the community",
    description: "No projects featured yet. Be the first to build an AI shopping agent with BuyWhere MCP and get featured on this page.",
    tags: ["MCP", "API"],
    link: "https://github.com/buywhere/buywhere-site/issues/new?labels=showcase&template=build-with-buywhere-submission.yml",
  },
];

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

export default function ChallengePage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Nav />

      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-slate-200 bg-[radial-gradient(circle_at_20%_10%,_rgba(99,102,241,0.32),_transparent_40%),radial-gradient(circle_at_80%_80%,_rgba(168,85,247,0.15),_transparent_36%),linear-gradient(135deg,#0f172a_0%,#1e1b4b_48%,#0f172a_100%)] text-white">
          <div className="absolute inset-0 opacity-20">
            <div className="absolute left-[-8rem] top-[-4rem] h-72 w-72 rounded-full bg-indigo-500/30 blur-3xl" />
            <div className="absolute right-[-4rem] bottom-[-2rem] h-64 w-64 rounded-full bg-purple-500/20 blur-3xl" />
          </div>

          <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-indigo-200">
              Developer Showcase
            </div>
            <h1 className="max-w-3xl text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">
              Build With BuyWhere
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
              Build an AI shopping agent using BuyWhere&apos;s product catalog API or MCP tools. Share your build with the community.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/api-keys"
                className="inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-semibold text-indigo-700 transition-colors hover:bg-slate-100"
              >
                Start building →
              </Link>
              <a
                href="https://github.com/buywhere/buywhere-site/issues/new?labels=showcase&template=build-with-buywhere-submission.yml"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Submit your project
              </a>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-slate-50 py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Get started</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                Three steps to build
              </h2>
              <p className="mt-4 text-lg leading-8 text-slate-600">
                Get your key, build your agent, and share it with the community.
              </p>
            </div>

            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {steps.map((item) => (
                <div
                  key={item.step}
                  className="relative rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
                    {item.step}
                  </div>
                  <h3 className="text-xl font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{item.desc}</p>
                  <Link
                    href={item.cta.href}
                    className="mt-4 inline-flex text-sm font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    {item.cta.label} →
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-slate-950 py-16 text-white">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mb-10">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">Quick start</p>
              <h2 className="mt-3 text-3xl font-bold text-white">Connect BuyWhere MCP in under 5 minutes</h2>
              <p className="mt-4 text-lg leading-8 text-slate-300">
                Add BuyWhere product search to any MCP-compatible agent client.
              </p>
            </div>

            <div className="grid gap-8 lg:grid-cols-2">
              <div className="space-y-6">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                  <p className="text-sm font-semibold text-white">1. Install MCP server</p>
                  <code className="mt-2 block text-sm text-slate-300">npx -y @buywhere/mcp-server</code>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                  <p className="text-sm font-semibold text-white">2. Configure your MCP client</p>
                  <p className="mt-2 text-sm text-slate-300">Add this to your Claude Desktop, Cursor, or other MCP-compatible client config:</p>
                </div>
                <CodeBlock label="mcp_config.json" code={quickStartCode} />
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                  <p className="text-sm font-semibold text-white">3. Use the search_products tool</p>
                  <p className="mt-2 text-sm text-slate-300">Pass this schema to your agent to enable product search:</p>
                </div>
                <CodeBlock label="tool schema" code={searchToolSchema} />
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                  <p className="text-sm font-semibold text-white">4. Try an example</p>
                </div>
                <CodeBlock label="agent flow" code={agentExample} />
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Project ideas</p>
                <h3 className="mt-3 text-xl font-semibold text-white">Start building something</h3>
                <div className="mt-6 space-y-6">
                  {projectIdeas.map((idea) => (
                    <div key={idea.name} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                      <h4 className="font-semibold text-white">{idea.name}</h4>
                      <p className="mt-2 text-sm text-slate-300">{idea.description}</p>
                      <pre className="mt-3 overflow-x-auto text-xs text-slate-400">
                        <code>{idea.code}</code>
                      </pre>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {idea.tags.map((tag) => (
                          <span key={tag} className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-slate-300">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-6">
                  <Link
                    href="/quickstart"
                    className="inline-flex items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-300 transition-colors hover:bg-cyan-400/20"
                  >
                    Full quickstart guide →
                  </Link>
                </div>
              </div>
            </div>

            <div className="mt-10 flex flex-wrap gap-4">
              <Link
                href="/api-keys"
                className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-indigo-700 transition-colors hover:bg-slate-100"
              >
                Get API key
              </Link>
              <Link
                href="/docs/api-reference"
                className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                API docs
              </Link>
              <Link
                href="/integrate"
                className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                MCP integration guide
              </Link>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-white py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Showcase</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                Featured builds
              </h2>
              <p className="mt-4 text-lg leading-8 text-slate-600">
                See what developers are building with BuyWhere.
              </p>
            </div>

            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {showcaseProjects.map((project) => (
                <a
                  key={project.name}
                  href={project.link}
                  className="group rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-indigo-200 hover:shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-semibold text-slate-900 group-hover:text-indigo-600">{project.name}</h3>
                    <svg className="h-5 w-5 text-slate-400 group-hover:text-indigo-600" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                    </svg>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">by {project.builder}</p>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{project.description}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {project.tags.map((tag) => (
                      <span key={tag} className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        {tag}
                      </span>
                    ))}
                  </div>
                </a>
              ))}
            </div>

            <div className="mt-10 text-center">
              <a
                href="https://github.com/buywhere/buywhere-site/issues/new?labels=showcase&template=build-with-buywhere-submission.yml"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-6 py-3 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
              >
                Submit your project to be featured →
              </a>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-gradient-to-b from-indigo-950 to-slate-950 py-16 text-white">
          <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Ready to build?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg leading-8 text-slate-300">
              Get your free API key and start building today. No credit card required.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/api-keys"
                className="inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-semibold text-indigo-700 transition-colors hover:bg-slate-100"
              >
                Get API key
              </Link>
              <Link
                href="/quickstart"
                className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Read the quickstart
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
