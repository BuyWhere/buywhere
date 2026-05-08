import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Build With BuyWhere Challenge — Win an M3 MacBook Air",
  description:
    "Build an AI shopping agent using BuyWhere's API or MCP tools. Win an M3 MacBook Air, $1,000 in API credits, and BuyWhere swag. Open to all developers.",
  alternates: {
    canonical: "https://buywhere.ai/challenge",
  },
  openGraph: {
    title: "Build With BuyWhere Challenge",
    description:
      "Build an AI shopping agent using BuyWhere's API or MCP tools. Win an M3 MacBook Air, $1,000 in API credits, and BuyWhere swag.",
    url: "https://buywhere.ai/challenge",
    type: "website",
  },
};

const prizes = [
  {
    place: "Grand Prize",
    items: ["Apple M3 MacBook Air", "$1,000 in BuyWhere API credits", "BuyWhere swag box", "Featured on buywhere.ai"],
    highlight: true,
  },
  {
    place: "Runner-up",
    items: ["$500 in BuyWhere API credits", "BuyWhere swag box", "Shoutout on social channels"],
    highlight: false,
  },
  {
    place: "Community Favorite",
    items: ["$250 in BuyWhere API credits", "BuyWhere swag box", "Most +1 reactions on submission issue"],
    highlight: false,
  },
];

const judgingCriteria = [
  { name: "Utility", weight: "40%", desc: "How useful is the agent for real shopping scenarios? Does it solve a genuine problem?" },
  { name: "MCP Usage", weight: "30%", desc: "How well does the submission integrate BuyWhere tools via MCP or API?" },
  { name: "Polish", weight: "20%", desc: "Is the agent well-built? Clean UI, clear instructions, error handling." },
  { name: "Creativity", weight: "10%", desc: "Originality of the concept. Bonus for novel agent patterns or unique integrations." },
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
    title: "Build your agent",
    desc: "Use BuyWhere's REST API or MCP server to give your agent live product search, comparison, and merchant handoff.",
    cta: { label: "Read the quickstart", href: "/quickstart" },
  },
  {
    step: "3",
    title: "Submit your project",
    desc: "Open a GitHub issue using the challenge submission template with your repo URL, demo link, and a short description.",
    cta: { label: "Submit via GitHub", href: "https://github.com/buywhere/buywhere-site/issues/new?labels=challenge,submission&template=build-with-buywhere-submission.yml" },
  },
];

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
              Developer Challenge
            </div>
            <h1 className="max-w-3xl text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">
              Build With BuyWhere
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
              Build an AI shopping agent using BuyWhere&apos;s product catalog API or MCP tools. Win an M3 MacBook Air, API credits, and swag.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/api-keys"
                className="inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-semibold text-indigo-700 transition-colors hover:bg-slate-100"
              >
                Start building →
              </Link>
              <a
                href="https://github.com/buywhere/buywhere-site/issues/new?labels=challenge,submission&template=build-with-buywhere-submission.yml"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Submit your agent
              </a>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-slate-50 py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">How it works</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                Three steps to enter
              </h2>
              <p className="mt-4 text-lg leading-8 text-slate-600">
                Anyone can enter. Get your key, build your agent, submit your project.
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

        <section className="border-b border-slate-200 bg-white py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Prizes</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                What you can win
              </h2>
              <p className="mt-4 text-lg leading-8 text-slate-600">
                Top submissions earn hardware, credits, and recognition.
              </p>
            </div>

            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {prizes.map((prize) => (
                <div
                  key={prize.place}
                  className={`rounded-[28px] border p-6 shadow-sm ${
                    prize.highlight
                      ? "border-indigo-200 bg-gradient-to-b from-indigo-50 to-white ring-1 ring-indigo-100"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <h3 className={`text-xl font-semibold ${prize.highlight ? "text-indigo-900" : "text-slate-900"}`}>
                    {prize.place}
                  </h3>
                  <ul className="mt-4 space-y-3">
                    {prize.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-sm leading-6 text-slate-600">
                        <svg className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-slate-50 py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Judging</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                How submissions are scored
              </h2>
              <p className="mt-4 text-lg leading-8 text-slate-600">
                Each entry is reviewed by the BuyWhere team on four criteria.
              </p>
            </div>

            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {judgingCriteria.map((criterion) => (
                <div key={criterion.name} className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-lg font-semibold text-slate-900">{criterion.name}</h3>
                    <span className="text-2xl font-bold text-indigo-600">{criterion.weight}</span>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{criterion.desc}</p>
                </div>
              ))}
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
