"use client";

import { useState, useEffect, useCallback } from "react";

export interface Retailer {
  id: string;
  name: string;
  icon: string;
  color: string;
  bgColor: string;
  enabled: boolean;
}

interface RetailerSwitcherProps {
  onChange?: (enabledRetailers: string[]) => void;
  className?: string;
  storageKey?: string;
}

const DEFAULT_RETAILERS: Retailer[] = [
  { id: "amazon", name: "Amazon.com", icon: "📦", color: "text-orange-600", bgColor: "bg-orange-50", enabled: true },
  { id: "walmart", name: "Walmart", icon: "🛒", color: "text-blue-600", bgColor: "bg-blue-50", enabled: true },
  { id: "target", name: "Target", icon: "🎯", color: "text-red-600", bgColor: "bg-red-50", enabled: true },
  { id: "bestbuy", name: "Best Buy", icon: "🏪", color: "text-blue-700", bgColor: "bg-blue-50", enabled: true },
];

function loadRetailersFromStorage(storageKey: string): Retailer[] {
  if (typeof window === "undefined") return DEFAULT_RETAILERS;
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const enabledIds: string[] = JSON.parse(stored);
      return DEFAULT_RETAILERS.map((r) => ({
        ...r,
        enabled: enabledIds.includes(r.id),
      }));
    }
  } catch {}
  return DEFAULT_RETAILERS;
}

function saveRetailersToStorage(storageKey: string, retailers: Retailer[]): void {
  if (typeof window === "undefined") return;
  try {
    const enabledIds = retailers.filter((r) => r.enabled).map((r) => r.id);
    localStorage.setItem(storageKey, JSON.stringify(enabledIds));
  } catch {}
}

export function RetailerSwitcher({
  onChange,
  className = "",
  storageKey = "bw_retailer_switcher",
}: RetailerSwitcherProps) {
  const [retailers, setRetailers] = useState<Retailer[]>(DEFAULT_RETAILERS);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setRetailers(loadRetailersFromStorage(storageKey));
    setMounted(true);
  }, [storageKey]);

  const handleToggle = useCallback(
    (retailerId: string) => {
      setRetailers((prev) => {
        const updated = prev.map((r) =>
          r.id === retailerId ? { ...r, enabled: !r.enabled } : r
        );
        saveRetailersToStorage(storageKey, updated);
        const enabledIds = updated.filter((r) => r.enabled).map((r) => r.id);
        onChange?.(enabledIds);
        return updated;
      });
    },
    [storageKey, onChange]
  );

  const handleSelectAll = useCallback(() => {
    const updated = DEFAULT_RETAILERS.map((r) => ({ ...r, enabled: true }));
    setRetailers(updated);
    saveRetailersToStorage(storageKey, updated);
    onChange?.(updated.map((r) => r.id));
  }, [storageKey, onChange]);

  const handleClearAll = useCallback(() => {
    const updated = DEFAULT_RETAILERS.map((r) => ({ ...r, enabled: false }));
    setRetailers(updated);
    saveRetailersToStorage(storageKey, updated);
    onChange?.([]);
  }, [storageKey, onChange]);

  const enabledCount = retailers.filter((r) => r.enabled).length;
  const allSelected = enabledCount === retailers.length;

  return (
    <div className={`w-full overflow-x-auto pb-2 -mb-2 ${className}`} role="group" aria-label="Filter retailers">
      <div className="inline-flex flex-wrap items-center gap-2 min-w-max">
        <span className="text-sm font-medium text-gray-700 mr-1">Retailers:</span>
        {mounted ? (
          <>
            {retailers.map((retailer) => (
              <button
                key={retailer.id}
                onClick={() => handleToggle(retailer.id)}
                aria-pressed={retailer.enabled}
                aria-label={`${retailer.enabled ? "Hide" : "Show"} prices from ${retailer.name}`}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-all min-h-[44px] touch-manipulation ${
                  retailer.enabled
                    ? `${retailer.bgColor} ${retailer.color} border-2 border-current shadow-sm hover:shadow-md active:scale-95`
                    : "bg-gray-100 text-gray-400 border-2 border-transparent hover:bg-gray-200 active:scale-95"
                }`}
              >
                <span className="text-base flex-shrink-0" aria-hidden="true">{retailer.icon}</span>
                <span className="hidden sm:inline">{retailer.name}</span>
                {retailer.enabled && (
                  <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </>
        ) : (
          <>
            {DEFAULT_RETAILERS.map((retailer) => (
              <div
                key={retailer.id}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium min-h-[44px] ${retailer.bgColor} ${retailer.color} opacity-50`}
              >
                <span className="text-base" aria-hidden="true">{retailer.icon}</span>
                <span className="hidden sm:inline">{retailer.name}</span>
              </div>
            ))}
          </>
        )}
        <div className="ml-2 flex items-center gap-1 border-l border-gray-200 pl-2">
          <button
            onClick={handleSelectAll}
            disabled={allSelected}
            className="text-xs text-gray-500 hover:text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed px-1 py-0.5 transition-colors"
            aria-label="Select all retailers"
          >
            All
          </button>
          <span className="text-gray-300" aria-hidden="true">/</span>
          <button
            onClick={handleClearAll}
            disabled={enabledCount === 0}
            className="text-xs text-gray-500 hover:text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed px-1 py-0.5 transition-colors"
            aria-label="Clear all retailer filters"
          >
            None
          </button>
        </div>
      </div>
    </div>
  );
}

export function useRetailerFilter(storageKey = "bw_retailer_switcher") {
  const [enabledRetailers, setEnabledRetailers] = useState<string[]>([]);

  useEffect(() => {
    const retailers = loadRetailersFromStorage(storageKey);
    setEnabledRetailers(retailers.filter((r) => r.enabled).map((r) => r.id));
  }, [storageKey]);

  const handleRetailerChange = useCallback((ids: string[]) => {
    setEnabledRetailers(ids);
  }, []);

  return {
    enabledRetailers,
    handleRetailerChange,
    isRetailerEnabled: (id: string) => enabledRetailers.includes(id),
  };
}

export function filterByRetailers<T extends { merchant: string }>(
  items: T[],
  enabledRetailers: string[]
): T[] {
  if (enabledRetailers.length === 0) return items;
  const merchantIdMap: Record<string, string> = {
    "Amazon.com": "amazon",
    Walmart: "walmart",
    Target: "target",
    "Best Buy": "bestbuy",
  };
  return items.filter((item) => {
    const id = merchantIdMap[item.merchant];
    return id ? enabledRetailers.includes(id) : true;
  });
}

export default RetailerSwitcher;