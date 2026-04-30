"use client";

import { useState, useEffect, useCallback } from "react";
import { CatalogHealthDashboard } from "@/components/catalog/CatalogHealthDashboard";
import type { CatalogHealthData } from "@/app/api/dashboard/catalog/health/route";

export default function CatalogHealthPage() {
  const [data, setData] = useState<CatalogHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/dashboard/catalog/health");
      if (!response.ok) {
        throw new Error("Failed to fetch catalog health data");
      }
      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex flex-col min-h-screen">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-3 text-gray-500">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Loading catalog health data...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col min-h-screen">
        <div className="flex-1 flex items-center justify-center">
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center max-w-md">
            <p className="text-red-700 font-medium mb-2">Failed to load catalog health data</p>
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <button
              onClick={loadData}
              className="text-sm text-indigo-600 hover:underline"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <CatalogHealthDashboard data={data} />;
}