"use client";

import { useState } from "react";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

type Goal = {
  id: string;
  label: string;
  icon: string;
  description: string;
};

type Category = {
  id: string;
  label: string;
  icon: string;
};

const GOALS: Goal[] = [
  {
    id: "compare-prices",
    label: "Compare prices",
    icon: "💰",
    description: "Find the best deals across Amazon, Walmart, Target, and more",
  },
  {
    id: "track-deals",
    label: "Track price drops",
    icon: "📉",
    description: "Get notified when products go on sale",
  },
  {
    id: "build-agent",
    label: "Build a shopping agent",
    icon: "🤖",
    description: "Use the API or MCP to power AI shopping experiences",
  },
  {
    id: "research",
    label: "Research products",
    icon: "🔍",
    description: "Read reviews, compare specs, and make informed choices",
  },
  {
    id: "merchant",
    label: "List my products",
    icon: "🏪",
    description: "Get your catalog in front of AI-driven shoppers",
  },
  {
    id: "explore",
    label: "Just browsing",
    icon: "👀",
    description: "See what's available and what BuyWhere can do",
  },
];

const CATEGORIES: Category[] = [
  { id: "electronics", label: "Electronics", icon: "💻" },
  { id: "fashion", label: "Fashion", icon: "👕" },
  { id: "home-living", label: "Home & Living", icon: "🏠" },
  { id: "beauty", label: "Beauty & Health", icon: "✨" },
  { id: "sports", label: "Sports & Outdoors", icon: "⚽" },
  { id: "toys", label: "Toys & Games", icon: "🎮" },
  { id: "grocery", label: "Grocery", icon: "🛒" },
  { id: "automotive", label: "Automotive", icon: "🚗" },
  { id: "pet-supplies", label: "Pet Supplies", icon: "🐾" },
  { id: "books", label: "Books & Media", icon: "📚" },
];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const toggleGoal = (id: string) => {
    setSelectedGoals((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  };

  const toggleCategory = (id: string) => {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const totalSteps = 3;

  const handleContinue = () => {
    if (step < totalSteps - 1) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Nav />
      <main id="main-content" className="flex-1 bg-gradient-to-b from-indigo-50 to-white py-12">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          {/* Progress */}
          <div className="mb-10">
            <div className="flex items-center justify-center gap-2">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                      i <= step
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {i + 1}
                  </div>
                  {i < totalSteps - 1 && (
                    <div
                      className={`h-0.5 w-12 transition-colors ${
                        i < step ? "bg-indigo-600" : "bg-gray-200"
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Step 0: Goals */}
          {step === 0 && (
            <section>
              <div className="text-center mb-8">
                <h1 className="text-3xl font-bold text-gray-900">
                  What brings you here?
                </h1>
                <p className="mt-2 text-gray-500">
                  Pick all that apply — we&apos;ll tailor the experience for you.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {GOALS.map((goal) => {
                  const selected = selectedGoals.includes(goal.id);
                  return (
                    <button
                      key={goal.id}
                      type="button"
                      onClick={() => toggleGoal(goal.id)}
                      className={`group rounded-2xl border-2 p-5 text-left transition-all ${
                        selected
                          ? "border-indigo-500 bg-indigo-50 shadow-sm"
                          : "border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm"
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg transition-colors ${
                            selected
                              ? "bg-indigo-100"
                              : "bg-gray-50 group-hover:bg-gray-100"
                          }`}
                        >
                          {goal.icon}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <h3
                              className={`font-semibold ${
                                selected ? "text-indigo-700" : "text-gray-900"
                              }`}
                            >
                              {goal.label}
                            </h3>
                            <div
                              className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
                                selected
                                  ? "border-indigo-500 bg-indigo-500"
                                  : "border-gray-300"
                              }`}
                            >
                              {selected && (
                                <svg
                                  className="h-3 w-3 text-white"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={3}
                                    d="M5 13l4 4L19 7"
                                  />
                                </svg>
                              )}
                            </div>
                          </div>
                          <p className="mt-1 text-sm text-gray-500">
                            {goal.description}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Step 1: Categories */}
          {step === 1 && (
            <section>
              <div className="text-center mb-8">
                <h1 className="text-3xl font-bold text-gray-900">
                  What products interest you?
                </h1>
                <p className="mt-2 text-gray-500">
                  Select categories to personalize your feed and alerts.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                {CATEGORIES.map((cat) => {
                  const selected = selectedCategories.includes(cat.id);
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => toggleCategory(cat.id)}
                      className={`inline-flex items-center gap-2 rounded-full border-2 px-5 py-3 text-sm font-medium transition-all ${
                        selected
                          ? "border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm"
                          : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:shadow-sm"
                      }`}
                    >
                      <span className="text-lg">{cat.icon}</span>
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Step 2: Welcome / Done */}
          {step === 2 && (
            <section className="text-center">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
                <svg
                  className="h-10 w-10 text-green-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-gray-900">
                You&apos;re all set!
              </h1>
              <p className="mt-3 text-lg text-gray-500 max-w-md mx-auto">
                {selectedGoals.length > 0
                  ? `We'll help you ${selectedGoals
                      .map(
                        (g) => GOALS.find((goal) => goal.id === g)?.label
                      )
                      .filter(Boolean)
                      .join(", ")}.`
                  : "Start exploring products and deals right away."}
              </p>
              <div className="mt-4 text-sm text-gray-400">
                {selectedCategories.length > 0 && (
                  <p>
                    Categories:{" "}
                    {selectedCategories
                      .map((c) => CATEGORIES.find((cat) => cat.id === c)?.label)
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
              </div>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link
                  href="/search"
                  className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-indigo-700"
                >
                  Start searching products
                </Link>
                <Link
                  href="/compare/us"
                  className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-8 py-4 text-base font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Compare prices
                </Link>
              </div>
              <p className="mt-6 text-sm text-gray-400">
                Or browse{" "}
                <Link href="/deals/us" className="text-indigo-600 hover:underline">
                  today&apos;s deals
                </Link>
              </p>
            </section>
          )}

          {/* Navigation */}
          <div className="mt-10 flex items-center justify-between">
            <div>
              {step > 0 && step < totalSteps - 1 && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                  Back
                </button>
              )}
            </div>
            <div>
              {step < totalSteps - 1 && (
                <button
                  type="button"
                  onClick={handleContinue}
                  disabled={step === 0 && selectedGoals.length === 0}
                  className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Continue
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
