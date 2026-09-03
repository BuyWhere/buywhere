"use client";

import { useCallback, useEffect, useState } from "react";
import { useDeveloperAuth } from "@/lib/developer-auth";

const STORAGE_KEY = "bw_welcome_banner_dismissed";

function isWelcomeBannerDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

function dismissWelcomeBanner(): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, "1");
  }
}

const WELCOME_BULLETS = [
  "Search any product across 15+ retailers and compare prices instantly",
  "Track price history to know if you're getting a real deal",
  "Set price alerts and we'll notify you when prices drop",
];

export default function WelcomeBanner() {
  const { developer, status } = useDeveloperAuth();
  const [visible, setVisible] = useState(false);

  const dismiss = useCallback(() => {
    dismissWelcomeBanner();
    setVisible(false);
  }, []);

  useEffect(() => {
    if (status === "authenticated" && developer) {
      const createdAt = new Date(developer.created_at);
      const now = new Date();
      const daysSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCreation < 7 && !isWelcomeBannerDismissed()) {
        setVisible(true);
      }
    }
  }, [status, developer]);

  if (!visible) return null;

  return (
    <div
      className="mx-auto max-w-6xl px-4 sm:px-6"
      role="region"
      aria-label="Welcome to BuyWhere"
    >
      <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-6 shadow-sm dark:border-amber-500/30 dark:from-amber-950/50 dark:to-orange-950/50">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              Welcome to BuyWhere! Here&apos;s how to get the most out of it:
            </h2>
            <ul className="mt-3 space-y-2">
              {WELCOME_BULLETS.map((bullet, index) => (
                <li key={index} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <svg
                    className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {bullet}
                </li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/50 hover:text-slate-600 dark:hover:bg-slate-800/50 dark:hover:text-slate-200"
            aria-label="Dismiss welcome banner"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}