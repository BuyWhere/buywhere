'use client';

import Link from 'next/link';
import { Shield, Headphones, RefreshCw, Mail } from 'lucide-react';

const trustIndicators = [
  {
    icon: <RefreshCw className="w-5 h-5" />,
    label: 'API Version',
    value: 'v1',
    badge: 'Stable',
    badgeColor: 'bg-green-100 text-green-700',
  },
  {
    icon: <Shield className="w-5 h-5" />,
    label: 'Uptime SLA',
    value: '99.9%',
    badge: 'Last 90 days',
    badgeColor: 'bg-indigo-100 text-indigo-700',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12,6 12,12 16,14" />
      </svg>
    ),
    label: 'Avg. Latency',
    value: '120ms',
    badge: 'P50',
    badgeColor: 'bg-slate-100 text-slate-700',
  },
];

export function TrustLayer() {
  return (
    <section className="py-16 bg-gray-50 border-t border-gray-100" aria-labelledby="trust-heading">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 id="trust-heading" className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">
              Built for Reliability
            </h2>
            <p className="text-gray-500 mb-8 leading-relaxed">
              BuyWhere is production-ready infrastructure. We provide predictable latency, high uptime, and transparent versioning so your agents always know what to expect.
            </p>
            <div className="flex flex-col sm:flex-row gap-6">
              <div className="flex items-center gap-3">
                <Headphones className="w-5 h-5 text-indigo-600 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-gray-900">Developer Support</div>
                  <Link
                    href="mailto:support@buywhere.ai"
                    className="text-sm text-indigo-600 hover:text-indigo-700 hover:underline"
                  >
                    support@buywhere.ai
                  </Link>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-indigo-600 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-gray-900">Enterprise Inquiries</div>
                  <Link
                    href="mailto:enterprise@buywhere.ai"
                    className="text-sm text-indigo-600 hover:text-indigo-700 hover:underline"
                  >
                    enterprise@buywhere.ai
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 lg:grid-cols-3 gap-4">
            {trustIndicators.map((item) => (
              <div
                key={item.label}
                className="bg-white border border-gray-100 rounded-xl p-5 text-center hover:border-indigo-200 hover:shadow-md transition-all"
              >
                <div className="flex items-center justify-center w-10 h-10 bg-indigo-50 rounded-lg text-indigo-600 mb-3 mx-auto">
                  {item.icon}
                </div>
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{item.label}</div>
                <div className="text-2xl font-bold text-gray-900 mb-2">{item.value}</div>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.badgeColor}`}>
                  {item.badge}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default TrustLayer;