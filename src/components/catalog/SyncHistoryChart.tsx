import React from "react";
import type { SyncEvent } from "@/app/api/dashboard/catalog/health/route";

export interface SyncHistoryChartProps {
  syncHistory: SyncEvent[];
}

export function SyncHistoryChart({ syncHistory }: SyncHistoryChartProps) {
  const maxEvents = Math.max(...syncHistory.map((h) => h.events_count));

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString("en-US", { hour: "numeric", hour12: true });
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Sync History (Last 24 Hours)</h3>
      <div className="h-48 flex items-end gap-2">
        {syncHistory.slice(0, 24).reverse().map((hour, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex flex-col-reverse" style={{ height: "160px" }}>
              {hour.errors > 0 && (
                <div
                  className="w-full bg-red-500"
                  style={{ height: `${Math.max((hour.errors / maxEvents) * 100, 2)}%` }}
                  title={`${hour.errors} errors`}
                  role="img"
                  aria-label={`${hour.errors} errors`}
                />
              )}
              <div
                className="w-full bg-indigo-500"
                style={{ height: `${(hour.products_updated / maxEvents) * 100}%` }}
                title={`${hour.products_updated} updated`}
                role="img"
                aria-label={`${hour.products_updated} products updated`}
              />
              <div
                className="w-full bg-indigo-300"
                style={{ height: `${(hour.products_added / maxEvents) * 100}%` }}
                title={`${hour.products_added} added`}
                role="img"
                aria-label={`${hour.products_added} products added`}
              />
            </div>
            <span className="text-xs text-gray-400">{formatTime(hour.timestamp)}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-6 mt-4">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-indigo-300" />
          <span className="text-xs text-gray-500">Added</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-indigo-500" />
          <span className="text-xs text-gray-500">Updated</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-red-500" />
          <span className="text-xs text-gray-500">Errors</span>
        </div>
      </div>
    </div>
  );
}

export default SyncHistoryChart;