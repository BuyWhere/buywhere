"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "bw_producthunt_banner_dismissed";
const LAUNCH_DATE = new Date("2026-05-06T00:00:00Z");

function isBannerDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

function dismissBanner(): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, "1");
  }
}

function calculateTimeLeft() {
  const now = new Date();
  const diff = LAUNCH_DATE.getTime() - now.getTime();

  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  return { days, hours, minutes, seconds };
}

function CountdownTimer() {
  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2 text-sm font-medium">
      <span className="text-amber-900">We&apos;re live on ProductHunt in</span>
      <div className="flex items-center gap-1 font-mono">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500 text-white font-bold">
          {String(timeLeft.days).padStart(2, "0")}
        </span>
        <span className="text-amber-600">:</span>
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500 text-white font-bold">
          {String(timeLeft.hours).padStart(2, "0")}
        </span>
        <span className="text-amber-600">:</span>
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500 text-white font-bold">
          {String(timeLeft.minutes).padStart(2, "0")}
        </span>
        <span className="text-amber-600">:</span>
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500 text-white font-bold">
          {String(timeLeft.seconds).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}

export default function ProductHuntBanner() {
  const [visible, setVisible] = useState(false);

  const dismiss = useCallback(() => {
    dismissBanner();
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!isBannerDismissed()) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  return (
    <div
      className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500"
      role="region"
      aria-label="ProductHunt launch announcement"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <svg
                className="h-5 w-5 text-white"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
              <span className="text-white font-bold text-sm tracking-wide uppercase">
                ProductHunt
              </span>
            </div>
            <div className="h-6 w-px bg-white/30 hidden sm:block" />
            <div className="min-w-0">
              <CountdownTimer />
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <a
              href="https://producthunt.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-amber-700 hover:bg-amber-50 transition-colors"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
              Upvote us
            </a>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-full p-1.5 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
              aria-label="Dismiss banner"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
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
    </div>
  );
}