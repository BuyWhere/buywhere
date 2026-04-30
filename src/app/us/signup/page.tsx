'use client';

import * as React from 'react';
import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { AmazonLogo } from '@/components/logos/AmazonLogo';
import { WalmartLogo } from '@/components/logos/WalmartLogo';
import { TargetLogo } from '@/components/logos/TargetLogo';

interface SignupState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
}

interface ProductCount {
  count: number;
  loading: boolean;
  error: boolean;
}

const FEATURES = [
  {
    icon: (
      <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
    title: 'Search once, compare everywhere',
    description: 'Enter a product name or URL and instantly see prices from Amazon, Walmart, Target, and more.',
  },
  {
    icon: (
      <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
    title: 'Find the lowest price',
    description: 'We highlight the best deals so you can save money without visiting multiple websites.',
  },
  {
    icon: (
      <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: 'Trustworthy data',
    description: 'Prices updated daily with stock status so you know what\'s available before you buy.',
  },
];

function LogoRetailers() {
  return (
    <div className="flex items-center justify-center gap-8 md:gap-12">
      <div className="text-gray-400 hover:text-gray-600 transition-all duration-200 hover:scale-105" style={{ height: '28px' }}>
        <AmazonLogo className="h-full w-auto" />
      </div>
      <div className="text-gray-400 hover:text-gray-600 transition-all duration-200 hover:scale-105" style={{ height: '28px' }}>
        <WalmartLogo className="h-full w-auto" />
      </div>
      <div className="text-gray-400 hover:text-gray-600 transition-all duration-200 hover:scale-105" style={{ height: '28px' }}>
        <TargetLogo className="h-full w-auto" />
      </div>
    </div>
  );
}

function ProductCountDisplay({ productCount }: { productCount: ProductCount }) {
  if (productCount.loading) {
    return (
      <div className="flex items-center justify-center gap-2">
        <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-gray-500">Loading...</span>
      </div>
    );
  }

  if (productCount.error) {
    return <span className="text-gray-500">10M+ products</span>;
  }

  return (
    <span className="font-semibold text-indigo-600">
      {productCount.count.toLocaleString()}+ products
    </span>
  );
}

function ThankYouState() {
  return (
    <div className="text-center py-12 px-6">
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4">
        You&apos;re subscribed.
      </h2>
      <p className="text-gray-600 max-w-md mx-auto mb-8">
        We&apos;ll send product updates and launch notes to your inbox. BuyWhere US is already live in beta if you want to start exploring now.
      </p>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link
          href="/api-keys"
          className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
        >
          Get API access
        </Link>
        <Link
          href="/compare/us"
          className="inline-flex items-center justify-center rounded-xl border border-gray-200 px-5 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
        >
          Browse price comparisons
        </Link>
      </div>
    </div>
  );
}

function SignupForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [signupState, setSignupState] = useState<SignupState>({ status: 'idle' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setSignupState({ status: 'loading' });

    try {
      const res = await fetch('/api/us-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Something went wrong');
      }

      setSignupState({ status: 'success' });
      onSuccess();
    } catch (err) {
      setSignupState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      });
    }
  };

  if (signupState.status === 'success') {
    return <ThankYouState />;
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md mx-auto">
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email address"
          required
          className="flex-1 px-4 py-3 rounded-lg border border-gray-300 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          aria-label="Email address"
          disabled={signupState.status === 'loading'}
        />
        <Button
          type="submit"
          size="lg"
          variant="primary"
          loading={signupState.status === 'loading'}
          className="whitespace-nowrap"
        >
          Get product updates
        </Button>
      </div>
      {signupState.status === 'error' && (
        <p className="mt-3 text-sm text-red-600 text-center" role="alert">
          {signupState.message}
        </p>
      )}
      <p className="mt-4 text-xs text-gray-500 text-center">
        Optional updates only. API access is available separately.
      </p>
    </form>
  );
}

export default function USSignupPage() {
  const [productCount, setProductCount] = useState<ProductCount>({ count: 0, loading: true, error: false });
  const [showThankYou, setShowThankYou] = useState(false);

  useEffect(() => {
    async function fetchProductCount() {
      try {
        const res = await fetch('https://api.buywhere.ai/v1/catalog/stats', {
          headers: {
            'Accept': 'application/json',
          },
        });
        if (res.ok) {
          const data = await res.json();
          setProductCount({ count: data.total_products || 50000000, loading: false, error: false });
        } else {
          throw new Error('Failed to fetch');
        }
      } catch {
        setProductCount({ count: 50000000, loading: false, error: true });
      }
    }

    fetchProductCount();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white">
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg text-indigo-600">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="28" height="28" rx="6" fill="#4f46e5" />
              <path d="M7 10h14M7 14h10M7 18h12" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
            BuyWhere
          </Link>
          <div className="flex items-center gap-4 text-sm font-medium text-gray-600">
            <Link href="/compare/us" className="hover:text-indigo-600 transition-colors">
              Browse Products
            </Link>
            <Link href="/dashboard" className="hover:text-indigo-600 transition-colors">
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-16 md:py-24">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-100 text-emerald-700 text-sm font-medium rounded-full mb-6">
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600"></span>
            Now live in beta
          </div>
          
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 leading-tight mb-6" style={{ lineHeight: 1.1 }}>
            Compare US retail prices without tab juggling.
          </h1>
          
          <p className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto mb-8">
            BuyWhere is live with Amazon, Walmart, and Target price comparisons. Browse the catalog now, or subscribe for product updates and launch notes.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-8">
            <Link
              href="/compare/us"
              className="inline-flex min-w-[220px] items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              Start comparing prices
            </Link>
            <Link
              href="/api-keys"
              className="inline-flex min-w-[220px] items-center justify-center rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
            >
              Get API access
            </Link>
          </div>

          <div className="flex items-center justify-center gap-2 text-base md:text-lg mb-10">
            <span className="text-gray-500">Join</span>
            <Suspense fallback={<span className="text-gray-500">loading...</span>}>
              <ProductCountDisplay productCount={productCount} />
            </Suspense>
            <span className="text-gray-500">already comparing prices</span>
          </div>

          <SignupForm onSuccess={() => setShowThankYou(true)} />
        </div>

        <div className="mt-16 mb-16">
          <p className="text-sm text-gray-500 text-center mb-6">Trusted retailers</p>
          <LogoRetailers />
        </div>

        <div className="grid gap-8 md:grid-cols-3 mb-16">
          {FEATURES.map((feature, index) => (
            <div key={index} className="text-center p-6 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                {feature.icon}
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">{feature.title}</h3>
              <p className="text-sm text-gray-600">{feature.description}</p>
            </div>
          ))}
        </div>

        <div className="text-center p-8 bg-indigo-600 rounded-2xl text-white">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            Want product updates as we expand coverage?
          </h2>
          <p className="text-indigo-100 mb-6 max-w-lg mx-auto">
            Subscribe for launch notes, retailer additions, and comparison product updates while you use the live beta.
          </p>
          {!showThankYou && (
            <SignupForm onSuccess={() => setShowThankYou(true)} />
          )}
        </div>
      </main>

      <footer className="border-t border-gray-200 py-8 mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 font-bold text-indigo-600">
              <svg width="24" height="24" viewBox="0 0 28 28" fill="none">
                <rect width="28" height="28" rx="6" fill="#4f46e5" />
                <path d="M7 10h14M7 14h10M7 18h12" stroke="white" strokeWidth="2" strokeLinecap="round" />
              </svg>
              BuyWhere
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-500">
              <Link href="/privacy" className="hover:text-gray-700">Privacy</Link>
              <Link href="/terms" className="hover:text-gray-700">Terms</Link>
              <Link href="/contact" className="hover:text-gray-700">Contact</Link>
            </div>
            <p className="text-sm text-gray-500">
              © 2026 BuyWhere. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
