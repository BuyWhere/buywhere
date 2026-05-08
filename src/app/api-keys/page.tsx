"use client";

import { useState } from "react";
import Script from "next/script";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

const USE_CASES = [
  "AI shopping assistant",
  "Price comparison tool",
  "Affiliate recommendation engine",
  "E-commerce analytics",
  "LangChain / CrewAI agent",
  "Other",
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
      className="text-xs text-gray-400 hover:text-white transition-colors px-2 py-1 rounded border border-gray-700 hover:border-gray-500"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export default function ApiKeysPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [useCase, setUseCase] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/request-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, useCase }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
      } else {
        setApiKey(data.key);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const curlExample = apiKey
    ? `curl "https://api.buywhere.ai/v1/products/search?q=wireless+headphones&limit=5" \\
  -H "Authorization: Bearer ${apiKey}"`
    : "";

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": "https://buywhere.ai/api-keys#faq",
    mainEntity: [
      {
        "@type": "Question",
        name: "How do I get a BuyWhere API key?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Enter your name and email on the BuyWhere API keys page and receive a working API key instantly. No credit card required during beta. The key is displayed on screen and emailed to you."
        }
      },
      {
        "@type": "Question",
        name: "Is the BuyWhere API free?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes — during beta, BuyWhere offers a free tier with 1,000 API calls per month, no credit card required. Paid plans (Developer at $29/month for 50,000 calls, Business at $99/month for 500,000 calls) unlock more capacity and features like price history and webhooks."
        }
      },
      {
        "@type": "Question",
        name: "What can I build with the BuyWhere API?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The BuyWhere API powers AI shopping assistants, price comparison tools, affiliate recommendation engines, e-commerce analytics, and LangChain or CrewAI agents. Any application that needs real-time product search, price comparison, or deal discovery can use the API."
        }
      },
      {
        "@type": "Question",
        name: "What endpoints does the BuyWhere API offer?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The core endpoint is GET /v1/products/search for full-text product search. Additional endpoints include price comparison, product details by ID, deal discovery, and category browsing. The same catalog is available as MCP tools for AI agent integration."
        }
      },
      {
        "@type": "Question",
        name: "Does BuyWhere support MCP (Model Context Protocol)?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes. BuyWhere publishes an official MCP server package (@buywhere/mcp-server) that exposes the product catalog as MCP tools. Install it with npx -y @buywhere/mcp-server and configure it with your API key to use BuyWhere inside Claude Desktop, Cursor, or any MCP-compatible agent."
        }
      },
      {
        "@type": "Question",
        name: "What countries does BuyWhere cover?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "BuyWhere covers Singapore (SGD) with the full catalog live, and United States (USD) in preview. Additional Southeast Asian markets including Malaysia, Thailand, Vietnam, Philippines, and Indonesia are planned."
        }
      }
    ]
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Script id="faq-schema" type="application/ld+json" strategy="afterInteractive">
        {JSON.stringify(faqSchema)}
      </Script>
      <Nav />

      {/* Header */}
      <section className="bg-indigo-600 text-white py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="inline-flex items-center gap-2 bg-indigo-500 text-indigo-100 text-xs font-medium px-3 py-1 rounded-full mb-4">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full"></span>
            Free during beta
          </div>
          <h1 className="text-4xl font-bold mb-3">Get your API key</h1>
          <p className="text-indigo-200 text-lg">
            Enter your email and receive a working API key in seconds. No credit card required.
          </p>
        </div>
      </section>

      <section className="py-16 bg-white flex-1">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">

          {!apiKey ? (
            <div className="grid md:grid-cols-5 gap-10">
              {/* Form */}
              <div className="md:col-span-3">
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Your name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="Jane Smith"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="jane@company.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      What are you building?
                    </label>
                    <select
                      value={useCase}
                      onChange={(e) => setUseCase(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-700"
                    >
                      <option value="">Select a use case (optional)</option>
                      {USE_CASES.map((uc) => (
                        <option key={uc} value={uc}>{uc}</option>
                      ))}
                    </select>
                  </div>

                  {error && (
                    <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-indigo-600 text-white font-semibold py-3 rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {loading ? "Generating key…" : "Get API key →"}
                  </button>

                  <p className="text-xs text-gray-400 text-center">
                    Your key will be shown on screen and emailed to you. Free during beta — no credit card needed.
                  </p>
                </form>
              </div>

              {/* Side info */}
              <div className="md:col-span-2 space-y-5">
                <div className="bg-indigo-50 rounded-xl p-5">
                  <h3 className="font-semibold text-gray-900 mb-3 text-sm">What you get</h3>
                  <ul className="space-y-2 text-sm text-gray-600">
                    {[
                      "Instant API key — no waiting",
                      "Access to GET /v1/products/search",
                      "Product catalog across Singapore and Southeast Asia",
                      "Free usage during beta",
                      "Email support at hello@buywhere.ai",
                    ].map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <svg className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" viewBox="0 0 16 16" fill="none">
                          <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-gray-50 rounded-xl p-5 text-sm text-gray-500">
                  <p className="font-medium text-gray-700 mb-1">Already have a key?</p>
                  <p>Head to the <a href="/quickstart" className="text-indigo-600 hover:underline">canonical quickstart</a> to get started.</p>
                </div>
              </div>
            </div>
          ) : (
            /* Success state */
            <div className="space-y-8">
              <div className="flex items-start gap-4 bg-green-50 border border-green-200 rounded-xl p-5">
                <svg className="w-6 h-6 text-green-500 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="font-semibold text-green-800">Your API key is ready</p>
                  <p className="text-sm text-green-700 mt-0.5">We also sent it to <strong>{email}</strong>. Keep it safe — treat it like a password.</p>
                </div>
              </div>

              {/* Key display */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Your API key</label>
                <div className="bg-gray-900 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
                    <span className="text-xs text-gray-400 font-mono">API key</span>
                    <CopyButton text={apiKey} />
                  </div>
                  <pre className="p-4 text-sm text-green-400 font-mono overflow-x-auto">
                    <code>{apiKey}</code>
                  </pre>
                </div>
              </div>

              {/* Quick test */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Quick test — paste this into your terminal</label>
                <div className="bg-gray-900 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
                    <span className="text-xs text-gray-400 font-mono">bash</span>
                    <CopyButton text={curlExample} />
                  </div>
                  <pre className="p-4 text-sm text-gray-300 font-mono overflow-x-auto leading-relaxed whitespace-pre">
                    <code>{curlExample}</code>
                  </pre>
                </div>
              </div>

              {/* Next steps */}
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  {
                    title: "Open quickstart",
                    desc: "Canonical onboarding path from API key to first query and MCP setup.",
                    href: "/quickstart",
                    cta: "View quickstart →",
                  },
                  {
                    title: "See example agents",
                    desc: "Working LangChain and CrewAI agents that search Singapore products.",
                    href: "https://github.com/richmondteo-code/buywhere-agent-examples",
                    cta: "View on GitHub →",
                    external: true,
                  },
                  {
                    title: "Questions?",
                    desc: "Reach us directly at hello@buywhere.ai or via the contact page.",
                    href: "/contact",
                    cta: "Contact us →",
                  },
                ].map((card) => (
                  <a
                    key={card.title}
                    href={card.href}
                    target={card.external ? "_blank" : undefined}
                    rel={card.external ? "noopener noreferrer" : undefined}
                    className="block bg-gray-50 hover:bg-indigo-50 border border-gray-200 hover:border-indigo-200 rounded-xl p-5 transition-colors"
                  >
                    <p className="font-semibold text-gray-900 mb-1 text-sm">{card.title}</p>
                    <p className="text-xs text-gray-500 mb-3">{card.desc}</p>
                    <span className="text-xs text-indigo-600 font-medium">{card.cta}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}
