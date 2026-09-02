'use client';

import React, { memo } from 'react';

interface Spec {
  label: string;
  values: Record<string, string | null>;
}

interface CompareSpecTableProps {
  specs: Spec[];
  merchantLabels: string[];
  className?: string;
}

export const CompareSpecTable = memo(function CompareSpecTable({
  specs,
  merchantLabels,
  className = '',
}: CompareSpecTableProps) {
  if (!specs || specs.length === 0) {
    return null;
  }

  return (
    <table className={`w-full text-sm ${className}`} aria-label="Product specifications comparison">
      <thead className="sr-only">
        <tr>
          <th scope="col">Specification</th>
          {merchantLabels.map((label) => (
            <th key={label} scope="col" className="text-center">{label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {specs.map((spec, idx) => (
          <tr key={spec.label} className={idx % 2 === 0 ? 'bg-slate-50' : 'bg-white'}>
            <td className="px-3 py-2.5 font-medium text-slate-700 align-top whitespace-nowrap">
              {spec.label}
            </td>
            {merchantLabels.map((merchant) => {
              const value = spec.values[merchant];
              const isMissing = value === null || value === undefined;
              return (
                <td
                  key={merchant}
                  className={`px-3 py-2.5 text-center align-top ${isMissing ? 'text-slate-400 italic' : 'text-slate-900'}`}
                >
                  {isMissing ? '—' : value}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
});

export default CompareSpecTable;