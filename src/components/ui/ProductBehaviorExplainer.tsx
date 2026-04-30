'use client';

interface RankingCriterion {
  label: string;
  description: string;
  icon: React.ReactNode;
}

interface PriceComparisonPoint {
  label: string;
  description: string;
}

interface AvailabilityCheck {
  label: string;
  description: string;
}

interface MerchantSelectionPoint {
  label: string;
  description: string;
}

interface ProductBehaviorExplainerProps {
  productName?: string;
  variant?: 'default' | 'compact';
}

function RankingLogicSection() {
  const criteria: RankingCriterion[] = [
    {
      label: 'Best Value',
      description: 'Balances price, merchant reliability, and availability for the overall smartest choice.',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: 'Lowest Price',
      description: 'Sorts all available offers by price, including shipping estimates when available.',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13v12H3V4zm0 0v12m18-12v12M9 8h12M9 12h12M9 16h12" />
        </svg>
      ),
    },
    {
      label: 'Fastest Delivery',
      description: 'Prioritizes offers with Prime, store pickup, or the shortest estimated delivery window.',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
    {
      label: 'Highest Rated',
      description: 'Uses aggregate retailer ratings weighted by review count for quality-first decisions.',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Ranking Logic</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {criteria.map((criterion) => (
          <div key={criterion.label} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
            <div className="text-indigo-600 mt-0.5">{criterion.icon}</div>
            <div>
              <div className="text-sm font-medium text-gray-900">{criterion.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{criterion.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PriceComparisonSection() {
  const points: PriceComparisonPoint[] = [
    {
      label: 'Real-time price sync',
      description: 'Prices refresh multiple times daily across all tracked retailers.',
    },
    {
      label: 'Shipping included',
      description: 'We estimate total cost including standard shipping when price is below free-shipping threshold.',
    },
    {
      label: 'MSRP comparison',
      description: 'When MSRP is available, we show how much you save off the suggested retail price.',
    },
    {
      label: 'Tax excluded',
      description: 'Prices shown are pre-tax estimates. Final cost varies by shipping address.',
    },
  ];

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Price Comparison</h4>
      <div className="space-y-2">
        {points.map((point) => (
          <div key={point.label} className="flex items-start gap-2">
            <svg className="h-4 w-4 text-green-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <div>
              <span className="text-sm font-medium text-gray-900">{point.label}</span>
              <span className="text-sm text-gray-500"> — {point.description}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AvailabilityChecksSection() {
  const checks: AvailabilityCheck[] = [
    {
      label: 'In-stock only',
      description: 'Out-of-stock offers are hidden by default. Toggle to see all offers.',
    },
    {
      label: 'Freshness indicator',
      description: 'Each price shows when it was last verified — within the hour, 24h, or older.',
    },
    {
      label: 'Stock signals',
      description: 'We surface Prime eligibility, store pickup, and release windows when available.',
    },
  ];

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Availability Checks</h4>
      <div className="space-y-2">
        {checks.map((check) => (
          <div key={check.label} className="flex items-start gap-2">
            <svg className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <span className="text-sm font-medium text-gray-900">{check.label}</span>
              <span className="text-sm text-gray-500"> — {check.description}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MerchantSelectionSection() {
  const points: MerchantSelectionPoint[] = [
    {
      label: 'Verified retailers',
      description: 'Only retailers with direct data partnerships appear on BuyWhere.',
    },
    {
      label: 'Reliability scoring',
      description: 'Each merchant gets a reliability score based on data quality and uptime.',
    },
    {
      label: 'Affiliate disclosure',
      description: 'All purchase links are affiliate links. We disclose this transparently.',
    },
  ];

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Merchant Selection</h4>
      <div className="space-y-2">
        {points.map((point) => (
          <div key={point.label} className="flex items-start gap-2">
            <svg className="h-4 w-4 text-indigo-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-4 4h1m-5 4h1" />
            </svg>
            <div>
              <span className="text-sm font-medium text-gray-900">{point.label}</span>
              <span className="text-sm text-gray-500"> — {point.description}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProductBehaviorExplainer({ productName, variant = 'default' }: ProductBehaviorExplainerProps) {
  if (variant === 'compact') {
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <svg className="h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-semibold text-gray-900">How ranking works</span>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs text-gray-600">Results are sorted by <span className="font-medium text-gray-900">Best Value</span> by default — balancing price, merchant reliability, and stock status.</div>
          <div className="text-xs text-gray-600">Toggle to <span className="font-medium text-gray-900">Lowest Price</span>, <span className="font-medium text-gray-900">Fastest Delivery</span>, or <span className="font-medium text-gray-900">Highest Rated</span>.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-6">
        <svg className="h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="text-lg font-semibold text-gray-900">
          {productName ? `How we rank ${productName}` : 'How ranking works'}
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <RankingLogicSection />
        <PriceComparisonSection />
        <AvailabilityChecksSection />
        <MerchantSelectionSection />
      </div>

      <div className="mt-6 pt-5 border-t border-gray-100">
        <p className="text-xs text-gray-400 text-center">
          BuyWhere shows all ranked offers so your agent can make the decision that fits your priorities.
        </p>
      </div>
    </div>
  );
}

export default ProductBehaviorExplainer;