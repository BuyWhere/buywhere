import React from "react";

export type StatStatus = "ok" | "warning" | "critical";

export interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  status?: StatStatus;
}

export function StatCard({ label, value, trend, status = "ok" }: StatCardProps) {
  const borderColor = status === "ok" ? "border-l-green-500" : status === "warning" ? "border-l-amber-500" : "border-l-red-500";
  const dotColor = status === "ok" ? "bg-green-500" : status === "warning" ? "bg-amber-500" : "bg-red-500";

  return (
    <div
      className={`bg-white rounded-xl shadow-sm border border-gray-200 p-5 border-l-4 ${borderColor}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {trend && <div className="text-xs text-gray-400 mt-1">{trend}</div>}
    </div>
  );
}

export default StatCard;