import React from "react";

export interface HealthScoreGaugeProps {
  score: number;
  coverage: number;
  freshness: number;
  completeness: number;
  error_rate: number;
}

export function HealthScoreGauge({ score, coverage, freshness, completeness, error_rate }: HealthScoreGaugeProps) {
  const getScoreColor = (s: number) => {
    if (s >= 90) return "bg-green-500";
    if (s >= 70) return "bg-amber-500";
    if (s >= 50) return "bg-red-500";
    return "bg-red-700";
  };

  const getScoreLabel = (s: number) => {
    if (s >= 90) return "Excellent";
    if (s >= 70) return "Fair";
    if (s >= 50) return "Poor";
    return "Critical";
  };

  const getScoreBg = (s: number) => {
    if (s >= 90) return "bg-green-100 text-green-700";
    if (s >= 70) return "bg-amber-100 text-amber-700";
    return "bg-red-100 text-red-700";
  };

  const getErrorColor = (rate: number) => {
    if (rate > 5) return "text-red-600";
    if (rate > 2) return "text-amber-600";
    return "text-green-600";
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">Catalog Health Score</h3>
      <div className="flex items-center gap-4 mb-4">
        <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${getScoreColor(score)}`}
            style={{ width: `${score}%` }}
            role="progressbar"
            aria-valuenow={score}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Health score: ${score} out of 100`}
          />
        </div>
        <span className="text-2xl font-bold text-gray-900">{score}/100</span>
        <span className={`text-sm font-medium px-2 py-1 rounded-full ${getScoreBg(score)}`}>
          {getScoreLabel(score)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-100">
        <div className="text-center">
          <div className="text-lg font-semibold text-gray-900">{coverage}%</div>
          <div className="text-xs text-gray-500">Coverage</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold text-gray-900">{freshness}%</div>
          <div className="text-xs text-gray-500">Freshness</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold text-gray-900">{completeness}%</div>
          <div className="text-xs text-gray-500">Completeness</div>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-gray-100 text-center">
        <span className="text-xs text-gray-500">Error Rate: </span>
        <span className={`text-xs font-medium ${getErrorColor(error_rate)}`}>
          {error_rate}%
        </span>
      </div>
    </div>
  );
}

export default HealthScoreGauge;