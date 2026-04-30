"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDeveloperAuth } from "@/lib/developer-auth";

interface TourStep {
  id: string;
  title: string;
  description: string;
  targetSelector: string;
  position: "top" | "bottom" | "left" | "right";
}

const TOUR_STEPS: TourStep[] = [
  {
    id: "search",
    title: "Search for any product",
    description: "Search across 15+ retailers including Amazon, Walmart, Target, and Best Buy.",
    targetSelector: "[data-tour='search-bar']",
    position: "bottom",
  },
  {
    id: "price-history",
    title: "See historical prices",
    description: "Check the price history chart to know if it's really a deal.",
    targetSelector: "[data-tour='price-history']",
    position: "right",
  },
  {
    id: "alerts",
    title: "Set price alerts",
    description: "Set a price alert and we'll email you when the price drops.",
    targetSelector: "[data-tour='alerts-bell']",
    position: "bottom",
  },
];

const STORAGE_KEY = "bw_first_visit_done";

function isFirstVisit(): boolean {
  if (typeof window === "undefined") return false;
  return !window.localStorage.getItem(STORAGE_KEY);
}

function markTourDone(): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, "1");
  }
}

function Tooltip({
  step,
  isLast,
  onNext,
  onDismiss,
  targetRect,
}: {
  step: TourStep;
  isLast: boolean;
  onNext: () => void;
  onDismiss: () => void;
  targetRect: DOMRect | null;
}) {
  const [tooltipStyle, setTooltipStyle] = useState({});
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!targetRect || !tooltipRef.current) return;

    const tooltip = tooltipRef.current.getBoundingClientRect();
    const offset = 12;
    let top = 0;
    let left = 0;

    switch (step.position) {
      case "bottom":
        top = targetRect.bottom + offset;
        left = targetRect.left + targetRect.width / 2 - tooltip.width / 2;
        break;
      case "top":
        top = targetRect.top - tooltip.height - offset;
        left = targetRect.left + targetRect.width / 2 - tooltip.width / 2;
        break;
      case "right":
        top = targetRect.top + targetRect.height / 2 - tooltip.height / 2;
        left = targetRect.right + offset;
        break;
      case "left":
        top = targetRect.top + targetRect.height / 2 - tooltip.height / 2;
        left = targetRect.left - tooltip.width - offset;
        break;
    }

    left = Math.max(16, Math.min(left, window.innerWidth - tooltip.width - 16));
    top = Math.max(16, Math.min(top, window.innerHeight - tooltip.height - 16));

    setTooltipStyle({ top, left });
  }, [step.position, targetRect]);

  return (
    <div
      ref={tooltipRef}
      style={{
        position: "fixed",
        zIndex: 9999,
        ...tooltipStyle,
      }}
      className="w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      role="dialog"
      aria-modal="true"
      aria-label={`Tour step: ${step.title}`}
    >
      <div className="absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-l border-t border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900" />
      <h3 className="text-base font-semibold text-slate-900 dark:text-white">{step.title}</h3>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{step.description}</p>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex gap-1.5">
          {TOUR_STEPS.map((s) => (
            <div
              key={s.id}
              className={`h-1.5 w-1.5 rounded-full ${s.id === step.id ? "bg-indigo-500" : "bg-slate-300 dark:bg-slate-600"}`}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={onNext}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            {isLast ? "Got it" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OnboardingTour() {
  const { developer, status } = useDeveloperAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const stepIndexRef = useRef(0);

  const showTour = useCallback(() => {
    if (!isFirstVisit()) return;
    setVisible(true);
  }, []);

  const dismissTour = useCallback(() => {
    markTourDone();
    setVisible(false);
  }, []);

  useEffect(() => {
    if (status === "authenticated" && developer) {
      const createdAt = new Date(developer.created_at);
      const now = new Date();
      const daysSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCreation < 7) {
        showTour();
      }
    }
  }, [status, developer, showTour]);

  useEffect(() => {
    if (!visible) return;

    const updateTargetRect = () => {
      const step = TOUR_STEPS[stepIndexRef.current];
      const element = document.querySelector(step.targetSelector);
      if (element) {
        setTargetRect(element.getBoundingClientRect());
      } else {
        setTargetRect(null);
      }
    };

    updateTargetRect();
    window.addEventListener("resize", updateTargetRect);
    window.addEventListener("scroll", updateTargetRect);

    return () => {
      window.removeEventListener("resize", updateTargetRect);
      window.removeEventListener("scroll", updateTargetRect);
    };
  }, [visible, currentStep]);

  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      stepIndexRef.current = currentStep + 1;
      setCurrentStep(currentStep + 1);
    } else {
      dismissTour();
    }
  };

  const handleDismiss = () => {
    dismissTour();
  };

  if (!visible) return null;

  const step = TOUR_STEPS[currentStep];

  return (
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9998,
          background: "rgba(0, 0, 0, 0.4)",
        }}
        onClick={handleDismiss}
        aria-hidden="true"
      />
      {targetRect && (
        <div
          style={{
            position: "fixed",
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            border: "2px solid #4f46e5",
            borderRadius: "8px",
            zIndex: 9999,
            pointerEvents: "none",
          }}
          aria-hidden="true"
        />
      )}
      <Tooltip
        step={step}
        isLast={currentStep === TOUR_STEPS.length - 1}
        onNext={handleNext}
        onDismiss={handleDismiss}
        targetRect={targetRect}
      />
    </>
  );
}