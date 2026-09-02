'use client';

import { useId } from 'react';

const steps = [
  {
    number: '01',
    title: 'User Asks',
    description: 'A user asks their AI agent a product question like "best laptop under $1000"',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    number: '02',
    title: 'AI Agent Queries BuyWhere',
    description: 'The agent calls BuyWhere\'s resolve_product_query tool with the natural language request',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    number: '03',
    title: 'BuyWhere Resolves & Ranks',
    description: 'BuyWhere searches across 15+ retailers, normalizes data, and ranks products by value, price, and availability',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
    ),
  },
  {
    number: '04',
    title: 'Merchant Offers Returned',
    description: 'BuyWhere returns structured product data with prices, merchant info, ratings, and purchase links',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9,22 9,12 15,12 15,22" />
      </svg>
    ),
  },
  {
    number: '05',
    title: 'User Purchases',
    description: 'The agent presents the top options and the user completes the purchase on their preferred merchant\'s site',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    ),
  },
];

function StepCard({ step, isLast }: { step: typeof steps[0]; isLast: boolean }) {
  void useId();
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative z-10 w-16 h-16 flex items-center justify-center bg-indigo-600 rounded-2xl text-white mb-4 shadow-lg shadow-indigo-200">
        {step.icon}
      </div>
      <div className="text-xs font-semibold uppercase tracking-wider text-indigo-600 mb-1">{step.number}</div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{step.title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed max-w-[200px]">{step.description}</p>
      {isLast ? null : (
        <div className="hidden lg:block absolute top-8 left-full w-full h-0.5 bg-gradient-to-r from-indigo-300 to-transparent -translate-x-1/2" aria-hidden="true" />
      )}
    </div>
  );
}

export function HowItWorksSection() {
  return (
    <section className="py-20 bg-white" aria-labelledby="how-it-works-heading">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-16">
          <h2 id="how-it-works-heading" className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            How It Works
          </h2>
          <p className="text-lg text-gray-500 max-w-2xl mx-auto">
            From natural language query to purchase-ready product data — BuyWhere handles the complexity so your agents don&apos;t have to.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-4">
          {steps.map((step, index) => (
            <StepCard key={step.number} step={step} isLast={index === steps.length - 1} />
          ))}
        </div>
      </div>
    </section>
  );
}

export default HowItWorksSection;