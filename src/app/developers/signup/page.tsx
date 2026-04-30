'use client';

import * as React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import { Auth } from '@/lib/auth';

type SignupStatus = 'idle' | 'loading' | 'success' | 'error';

export default function DeveloperSignupPage() {
  const [status, setStatus] = useState<SignupStatus>('idle');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [useCase, setUseCase] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [copyLabel, setCopyLabel] = useState('Copy');

  const hideError = () => setErrorMsg('');
  const showError = (msg: string) => setErrorMsg(msg);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    hideError();

    if (!name.trim() || !email.trim()) {
      showError('Please fill in all required fields.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('Please enter a valid email address.');
      return;
    }

    setStatus('loading');

    try {
      const data = await Auth.register({
        agent_name: name.trim(),
        email: email.trim(),
        use_case: useCase || undefined,
      });

      const rawKey = data.api_key;
      window.localStorage.setItem("bw_developer_email", email.trim().toLowerCase());
      window.localStorage.setItem("bw_developer_name", name.trim());
      setApiKey(rawKey);
      setStatus('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setStatus('error');
    }
  };

  const resetForm = () => {
    setName('');
    setEmail('');
    setUseCase('');
    setErrorMsg('');
    setStatus('idle');
  };

  const copyApiKey = () => {
    navigator.clipboard.writeText(apiKey).then(() => {
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy'), 2000);
    });
  };

  const curlExample = `curl "https://api.buywhere.ai/v1/products/search?q=wireless+headphones&limit=5" \\
  -H "Authorization: Bearer ${apiKey}"`;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Nav />

      <section className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(79,70,229,0.15),_transparent_40%),linear-gradient(135deg,#0f172a_0%,#1e1b4b_100%)] text-white">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.15em] text-indigo-200">
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400"></span>
            Developer beta
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Get your API key
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-slate-300 max-w-xl mx-auto">
            Enter your details, get instant API access, and move straight into your first working request.
          </p>
        </div>
      </section>

      <main className="flex-1 mx-auto max-w-5xl w-full px-4 py-14 sm:px-6">

        {status === 'idle' || status === 'loading' || status === 'error' ? (
          <div className="grid md:grid-cols-5 gap-10">
            <div className="md:col-span-3">
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
                <h2 className="text-xl font-bold text-slate-900 mb-1">Create your account</h2>
                <p className="text-sm text-slate-500 mb-6">
                  Your API key is shown immediately after signup — no email confirmation required.
                </p>

                <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                  <div>
                    <label htmlFor="dev-name" className="mb-1.5 block text-sm font-medium text-slate-700">
                      Your name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      id="dev-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      autoComplete="name"
                      placeholder="Jane Smith"
                      className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-sm transition-shadow placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="dev-email" className="mb-1.5 block text-sm font-medium text-slate-700">
                      Work email <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      id="dev-email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      placeholder="jane@company.com"
                      className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-sm transition-shadow placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="use-case" className="mb-1.5 block text-sm font-medium text-slate-700">
                      What are you building?
                    </label>
                    <select
                      id="use-case"
                      value={useCase}
                      onChange={(e) => setUseCase(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-sm transition-shadow text-slate-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">Select a use case (optional)</option>
                      <option value="ai_shopping_assistant">AI shopping assistant</option>
                      <option value="price_comparison_tool">Price comparison tool</option>
                      <option value="affiliate_recommendation_engine">Affiliate recommendation engine</option>
                      <option value="ecommerce_analytics">E-commerce analytics</option>
                      <option value="langchain_crewai_agent">LangChain / CrewAI agent</option>
                      <option value="research">Product research</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  {errorMsg && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {errorMsg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={status === 'loading'}
                    className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-indigo-600 px-4 py-3.5 text-sm font-semibold text-white transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {status === 'loading' ? (
                      <>
                        <span>Generating…</span>
                        <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      </>
                    ) : (
                      'Get API key'
                    )}
                  </button>

                  <p className="text-center text-xs text-slate-400 leading-relaxed">
                    Free tier. No credit card. Your key is shown immediately after submission.
                  </p>
                </form>
              </div>
            </div>

            <div className="md:col-span-2 space-y-4">
              <div className="rounded-2xl bg-indigo-50 p-5">
                <h3 className="mb-3 text-sm font-semibold text-slate-900">What you get</h3>
                <ul className="space-y-2.5 text-sm text-slate-600">
                  {[
                    'Live API key shown on screen instantly',
                    'Free tier — no card required to start',
                    'Direct path into the 5-minute quickstart',
                    'US + SEA product data coverage',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <svg className="mt-0.5 w-4 h-4 shrink-0 text-indigo-500" fill="none" viewBox="0 0 16 16">
                        <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl bg-slate-50 p-5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Best next click</p>
                <p className="text-sm text-slate-600">
                  After you get your key, open the{' '}
                  <Link href="/quickstart" className="font-medium text-indigo-600 hover:underline">quickstart</Link>
                  {' '}to make your first authenticated request before exploring docs or MCP setup.
                </p>
              </div>

              <div className="rounded-2xl border border-gray-200 p-5 text-sm text-slate-500">
                Questions? Email{' '}
                <Link href="mailto:hello@buywhere.ai" className="text-indigo-600 hover:underline">hello@buywhere.ai</Link>
              </div>
            </div>
          </div>
        ) : null}

        {status === 'loading' ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="h-10 w-10 rounded-full border-[3px] border-indigo-200 border-t-indigo-600 animate-spin" />
            <p className="mt-4 text-sm text-slate-500">Generating your API key…</p>
          </div>
        ) : null}

        {status === 'success' ? (
          <div>
            <div className="mb-8 flex items-start gap-4 rounded-2xl border border-green-200 bg-green-50 p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100">
                <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-green-800">API key generated</p>
                <p className="text-xs text-green-700 mt-0.5">Store it securely — this is the only time it will be shown.</p>
              </div>
            </div>

            <div className="mb-8 overflow-hidden rounded-2xl bg-slate-900 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-4 py-3">
                <span className="font-mono text-xs text-slate-400">API key</span>
                <button
                  onClick={copyApiKey}
                  className="flex items-center gap-1.5 rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 transition-colors hover:border-slate-500 hover:text-white"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                    <rect x="5" y="5" width="9" height="9" rx="1.5" strokeWidth="1.5"/>
                    <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  {copyLabel}
                </button>
              </div>
              <div className="p-5">
                <pre className="break-all font-mono text-sm leading-relaxed text-green-400">{apiKey}</pre>
              </div>
            </div>

            <div className="mb-8 grid gap-4 sm:grid-cols-3">
              <Link
                href="/quickstart"
                className="group rounded-xl border border-indigo-200 bg-indigo-50 p-5 transition-all hover:border-indigo-300 hover:bg-indigo-100"
              >
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-indigo-500">Step 1</p>
                <p className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">Open quickstart</p>
                <p className="mt-1 text-xs text-slate-500">Make your first authenticated request</p>
              </Link>
              <Link
                href="/integrate"
                className="group rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-gray-300 hover:bg-gray-50"
              >
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Step 2</p>
                <p className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">Connect MCP</p>
                <p className="mt-1 text-xs text-slate-500">Claude Desktop, Cursor, or custom agent</p>
              </Link>
              <Link
                href="/docs"
                className="group rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-gray-300 hover:bg-gray-50"
              >
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Step 3</p>
                <p className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">Browse docs</p>
                <p className="mt-1 text-xs text-slate-500">Full endpoint reference and SDK guides</p>
              </Link>
            </div>

            <div className="mb-8 overflow-hidden rounded-2xl bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-4 py-3">
                <span className="font-mono text-xs text-slate-400">bash — copy and run</span>
                <button
                  onClick={() => navigator.clipboard.writeText(curlExample)}
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 transition-colors hover:border-slate-500 hover:text-white"
                >
                  Copy
                </button>
              </div>
              <div className="p-4">
                <pre className="whitespace-pre font-mono text-xs leading-relaxed text-slate-300">{curlExample}</pre>
              </div>
            </div>

            <div className="text-center">
              <p className="text-sm text-slate-500">Already familiar? Jump to your</p>
              <Link href="/api-keys" className="mt-1 inline-block text-sm font-semibold text-indigo-600 hover:underline">
                API key dashboard →
              </Link>
            </div>
          </div>
        ) : null}

        {status === 'error' ? (
          <div className="mx-auto max-w-md text-center py-16">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/>
              </svg>
            </div>
            <h2 className="mb-2 text-xl font-bold text-slate-900">Something went wrong</h2>
            <p className="mb-6 text-sm text-slate-500">{errorMsg}</p>
            <button
              onClick={resetForm}
              className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              Try again
            </button>
          </div>
        ) : null}

      </main>

      <Footer />
    </div>
  );
}
