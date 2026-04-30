'use client';

import { useState } from 'react';
import { Check, Copy, Terminal, Zap } from 'lucide-react';

const DEMO_API_KEY = 'bw_demo_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

const codeExample = `curl "https://api.buywhere.ai/v1/products/search?q=iphone+15+pro&limit=5" \\
  -H "Authorization: Bearer ${DEMO_API_KEY}"`;

const responseExample = `{
  "total": 847,
  "limit": 5,
  "offset": 0,
  "has_more": true,
  "items": [
    {
      "id": 18472931,
      "sku": "IPHONE15PRO256",
      "source": "shopee_sg",
      "name": "iPhone 15 Pro 256GB Natural Titanium",
      "price": "1349.00",
      "currency": "SGD",
      "buy_url": "https://shopee.sg/product/...",
      "image_url": "https://cf.shopee.sg/file/...",
      "brand": "Apple",
      "rating": "4.8",
      "review_count": 2341,
      "confidence_score": 0.95
    }
  ]
}`;

export function FirstCallBlock() {
  const [copied, setCopied] = useState(false);
  const [showResponse, setShowResponse] = useState(true);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(codeExample);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden">
      <div className="bg-slate-900 px-6 py-4 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            <span className="text-sm font-medium text-slate-400">Terminal</span>
          </div>
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-green-400" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      <div className="p-6">
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Terminal className="w-5 h-5 text-indigo-600" />
            <span className="text-sm font-semibold text-slate-900">Make your first API call</span>
          </div>
          <p className="text-sm text-slate-600">
            Copy this command and run it in your terminal. Replace <code className="px-1.5 py-0.5 bg-slate-200 rounded text-slate-700 text-xs">YOUR_API_KEY</code> with your key from the API key step, then use quickstart for the full guided flow.
          </p>
        </div>

        <pre className="overflow-x-auto p-4 bg-slate-950 rounded-xl text-sm leading-6 text-slate-100 font-mono" role="region" aria-label="curl command example">
          <code>{codeExample}</code>
        </pre>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a
            href="/api-keys"
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Zap className="w-4 h-4" />
            Start free
          </a>
          <a
            href="/quickstart"
            className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-100 transition-colors"
          >
            View quickstart
          </a>
          <button
            onClick={() => setShowResponse(!showResponse)}
            className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-100 transition-colors"
          >
            {showResponse ? 'Hide' : 'Show'} sample response
          </button>
        </div>

        {showResponse && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Sample Response</span>
            </div>
            <pre className="overflow-x-auto p-4 bg-slate-900 rounded-xl text-sm leading-6 text-slate-100 font-mono border border-slate-700" role="region" aria-label="Sample JSON response">
              <code>{responseExample}</code>
            </pre>
          </div>
        )}
      </div>

      <div className="px-6 py-4 bg-slate-100 border-t border-slate-200">
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            No credit card required
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            60 requests/min free tier
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            MCP-compatible
          </span>
        </div>
      </div>
    </div>
  );
}

export default FirstCallBlock;
