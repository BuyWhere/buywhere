'use client';

interface ReliabilityMetric {
  label: string;
  value: string;
  sublabel?: string;
  badge?: string;
  badgeColor?: string;
}

interface ReliabilityMetricsProps {
  latencyP50?: string;
  latencyP95?: string;
  uptime?: string;
  freshnessWindow?: string;
  matchAccuracy?: string;
  variant?: 'default' | 'inline';
}

function MetricCard({ metric }: { metric: ReliabilityMetric }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-gray-100 bg-gray-50 p-4 text-center hover:border-indigo-200 transition-colors">
      <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{metric.label}</div>
      <div className="text-2xl font-bold text-gray-900 mb-1">{metric.value}</div>
      {metric.sublabel && (
        <div className="text-xs text-gray-500">{metric.sublabel}</div>
      )}
      {metric.badge && (
        <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${metric.badgeColor || 'bg-slate-100 text-slate-600'}`}>
          {metric.badge}
        </span>
      )}
    </div>
  );
}

export function ReliabilityMetrics({
  latencyP50 = '120ms',
  latencyP95 = '210ms',
  uptime = '99.9%',
  freshnessWindow = '24h',
  matchAccuracy = '94%',
  variant = 'default',
}: ReliabilityMetricsProps) {
  const metrics: ReliabilityMetric[] = [
    {
      label: 'P50 Latency',
      value: latencyP50,
      sublabel: 'Median response',
      badge: 'Fast',
      badgeColor: 'bg-green-100 text-green-700',
    },
    {
      label: 'P95 Latency',
      value: latencyP95,
      sublabel: '95th percentile',
      badge: 'Predictable',
      badgeColor: 'bg-blue-100 text-blue-700',
    },
    {
      label: 'Uptime',
      value: uptime,
      sublabel: 'Last 90 days',
      badge: 'SLA',
      badgeColor: 'bg-indigo-100 text-indigo-700',
    },
    {
      label: 'Data Freshness',
      value: freshnessWindow,
      sublabel: 'Max age window',
      badge: 'Live',
      badgeColor: 'bg-amber-100 text-amber-700',
    },
    {
      label: 'Match Accuracy',
      value: matchAccuracy,
      sublabel: 'Correct product resolution',
      badge: 'High',
      badgeColor: 'bg-emerald-100 text-emerald-700',
    },
  ];

  if (variant === 'inline') {
    return (
      <div className="flex flex-wrap items-center gap-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{metric.label}:</span>
            <span className="text-sm font-semibold text-gray-900">{metric.value}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-6">
        <svg className="h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <h3 className="text-lg font-semibold text-gray-900">Proof of Reliability</h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </div>

      <div className="mt-6 pt-5 border-t border-gray-100">
        <p className="text-xs text-gray-400 text-center">
          Metrics based on rolling 30-day window across all API requests. Updated daily.
        </p>
      </div>
    </div>
  );
}

export default ReliabilityMetrics;