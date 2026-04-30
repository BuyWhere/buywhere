'use client';

import { useId } from 'react';
import { Bot, Zap, ShoppingCart } from 'lucide-react';

const steps = [
  {
    number: '1',
    title: 'Agent Sends Query',
    description: 'Your AI agent calls BuyWhere with a natural language product request',
    icon: Bot,
    color: 'bg-indigo-600',
  },
  {
    number: '2',
    title: 'BuyWhere Resolves',
    description: 'We search 15+ retailers, normalize data, and rank products by value',
    icon: Zap,
    color: 'bg-violet-600',
  },
  {
    number: '3',
    title: 'Agent Completes Purchase',
    description: 'Structured product data returned — agent presents options and user purchases',
    icon: ShoppingCart,
    color: 'bg-purple-600',
  },
];

function StepItem({
  step,
  isLast,
}: {
  step: (typeof steps)[0];
  isLast: boolean;
}) {
  const id = useId();
  const Icon = step.icon;

  return (
    <div className="flex flex-col items-center text-center relative flex-1">
      <div
        className={`relative z-10 w-16 h-16 flex items-center justify-center ${step.color} rounded-2xl text-white mb-4 shadow-lg`}
        aria-hidden="true"
      >
        <Icon className="w-7 h-7" />
      </div>
      <div
        className="text-xs font-semibold uppercase tracking-wider text-indigo-600 mb-1"
        id={`step-label-${id}`}
      >
        Step {step.number}
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{step.title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed max-w-[240px]">
        {step.description}
      </p>
      {!isLast && (
        <div
          className="hidden lg:block absolute top-8 left-1/2 w-full h-0.5 bg-gradient-to-r from-indigo-300 to-violet-300 -translate-x-1/2"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export function AgentFlowStepper() {
  const headingId = useId();

  return (
    <section
      className="py-20 bg-gradient-to-b from-white to-slate-50"
      aria-labelledby={headingId}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-16">
          <h2
            id={headingId}
            className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4"
          >
            From Query to Purchase in Three Steps
          </h2>
          <p className="text-lg text-gray-500 max-w-2xl mx-auto">
            BuyWhere handles the complexity of product discovery so your agents can focus on helping users buy.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-8 lg:gap-4 px-4 lg:px-12">
          {steps.map((step, index) => (
            <StepItem
              key={step.number}
              step={step}
              isLast={index === steps.length - 1}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export default AgentFlowStepper;