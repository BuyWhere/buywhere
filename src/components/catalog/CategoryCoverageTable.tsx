import React from "react";
import type { CategoryHealth } from "@/app/api/dashboard/catalog/health/route";

export interface CategoryCoverageTableProps {
  categories: CategoryHealth[];
  onCategoryClick?: (categoryId: string) => void;
}

export function CategoryCoverageTable({ categories, onCategoryClick }: CategoryCoverageTableProps) {
  const formatLastUpdated = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hr ago`;
    return `${Math.floor(diffHours / 24)} days ago`;
  };

  const getCoverageColor = (coverage: number) => {
    if (coverage >= 85) return "text-green-600";
    if (coverage >= 60) return "text-amber-600";
    return "text-red-600";
  };

  const getStatusColor = (status: CategoryHealth["status"]) => {
    if (status === "ok") return "text-green-600";
    if (status === "warning") return "text-amber-600";
    return "text-red-600";
  };

  const getDotColor = (status: CategoryHealth["status"]) => {
    if (status === "ok") return "bg-green-500";
    if (status === "warning") return "bg-amber-500";
    return "bg-red-500";
  };

  const getStatusLabel = (status: CategoryHealth["status"]) => {
    if (status === "ok") return "OK";
    if (status === "warning") return "Warn";
    return "Low";
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Category Coverage</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase">
            <tr>
              <th className="px-6 py-3 text-left">Category</th>
              <th className="px-6 py-3 text-right">Products</th>
              <th className="px-6 py-3 text-right">Coverage</th>
              <th className="px-6 py-3 text-right">Last Updated</th>
              <th className="px-6 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {categories.map((cat) => (
              <tr
                key={cat.id}
                className="hover:bg-gray-50 cursor-pointer"
                onClick={() => onCategoryClick?.(cat.id)}
              >
                <td className="px-6 py-4 font-medium text-gray-900">{cat.name}</td>
                <td className="px-6 py-4 text-right text-gray-600">
                  {cat.product_count.toLocaleString()}
                </td>
                <td className="px-6 py-4 text-right">
                  <span className={`font-medium ${getCoverageColor(cat.coverage)}`}>
                    {cat.coverage}%
                  </span>
                </td>
                <td className="px-6 py-4 text-right text-gray-500">
                  {formatLastUpdated(cat.last_updated)}
                </td>
                <td className="px-6 py-3 text-center">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${getStatusColor(cat.status)}`}>
                    <span className={`w-2 h-2 rounded-full ${getDotColor(cat.status)}`} />
                    {getStatusLabel(cat.status)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CategoryCoverageTable;