import React from "react";
import type { Alert } from "@/app/api/dashboard/catalog/health/route";

export interface AlertsPanelProps {
  alerts: Alert[];
  onAlertClick?: (alertId: string) => void;
}

export function AlertsPanel({ alerts, onAlertClick }: AlertsPanelProps) {
  const getSeverityIcon = (severity: Alert["severity"]) => {
    switch (severity) {
      case "critical":
        return <span className="text-red-500" aria-label="Critical">🔴</span>;
      case "warning":
        return <span className="text-amber-500" aria-label="Warning">🟡</span>;
      case "resolved":
        return <span className="text-green-500" aria-label="Resolved">🟢</span>;
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Alerts & Issues</h3>
        <a href="/dashboard/catalog/alerts" className="text-sm text-indigo-600 hover:underline">
          View All →
        </a>
      </div>
      <div className="space-y-2" role="list" aria-label="Alerts list">
        {alerts.length === 0 ? (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50">
            <span className="text-lg">🟢</span>
            <span className="text-sm text-green-700">No critical issues detected today</span>
          </div>
        ) : (
          alerts.map((alert) => (
            <div
              key={alert.id}
              className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer"
              onClick={() => onAlertClick?.(alert.id)}
              role="listitem"
            >
              {getSeverityIcon(alert.severity)}
              <span className="flex-1 text-sm text-gray-700">{alert.message}</span>
              {alert.category && (
                <span className="text-xs text-gray-400">{alert.category}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default AlertsPanel;