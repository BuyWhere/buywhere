'use client';

interface SpecSectionProps {
  specs: Record<string, string>;
  category: string;
  importanceMap?: Record<string, 'primary' | 'secondary' | 'tertiary'>;
  collapsible?: boolean;
}

const DEFAULT_CATEGORY_MAP: Record<string, string[]> = {
  'Core Specifications': ['Brand', 'Model', 'Color', 'SKU', 'UPC', 'EAN'],
  'Audio Specifications': ['Type', 'Noise Cancel', 'Noise Cancellation', 'Battery Life', 'Charging', 'Bluetooth', 'Wireless'],
  'Connectivity': ['Bluetooth', 'Wi-Fi', 'NFC', 'USB', 'Port', 'Connector', 'multipoint', 'App Support', 'Ethernet', 'Ports', 'HDMI'],
  'Display': ['Screen Size', 'Resolution', 'Display Type', 'Refresh Rate', 'Brightness', 'Contrast Ratio'],
  'Performance': ['Processor', 'CPU', 'GPU', 'RAM', 'Memory', 'Storage', 'Battery Life'],
  'Physical': ['Dimensions', 'Weight', 'Height', 'Width', 'Depth', 'Size', 'Form Factor'],
  'Camera': ['Camera', 'Megapixels', 'Lens', 'Resolution', 'Zoom', 'Flash'],
};

function getSpecCategory(specName: string): string {
  const normalizedSpec = specName.toLowerCase();
  
  for (const [category, keywords] of Object.entries(DEFAULT_CATEGORY_MAP)) {
    if (keywords.some(keyword => normalizedSpec.includes(keyword.toLowerCase()))) {
      return category;
    }
  }
  
  return 'Other Specifications';
}

import React from 'react';

function formatSpecValue(value: string): React.ReactNode {
  // Add units where missing for common measurements
  if (value.match(/^\d+$/)) {
    // Check if it looks like a measurement that needs units
    // This is a simplified approach - in reality, we'd need more context
    return value;
  }
  
  // Handle boolean values
  if (value.toLowerCase() === 'yes' || value.toLowerCase() === 'no') {
    const isYes = value.toLowerCase() === 'yes';
    return (
      <span className={`inline-flex items-center gap-1 ${isYes ? 'text-green-700' : 'text-red-700'}`}>
        {isYes ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        <span>{value}</span>
      </span>
    );
  }
  
  // Handle ratings
  if (value.match(/^\d+\.?\d*\s*\/\s*5$/)) {
    return value;
  }
  
  return value;
}

export default function SpecSection({
  specs,
  category,
  importanceMap = {},
}: SpecSectionProps) {
  // Filter specs for this category
  const categorySpecs: Record<string, string> = {};
  
  for (const [specName, specValue] of Object.entries(specs)) {
    const specCategory = getSpecCategory(specName);
    if (specCategory === category) {
      categorySpecs[specName] = specValue;
    }
  }
  
  if (Object.keys(categorySpecs).length === 0) {
    return null;
  }
  
  // Sort by importance: primary first, then secondary, then tertiary
  const sortedSpecs = Object.entries(categorySpecs).sort(([nameA], [nameB]) => {
    const importanceA = importanceMap[nameA] || 'secondary';
    const importanceB = importanceMap[nameB] || 'secondary';
    
    const importanceOrder = { primary: 0, secondary: 1, tertiary: 2 };
    return importanceOrder[importanceA] - importanceOrder[importanceB];
  });
  
  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-3 border-b-2 pb-1">
        {category}
      </h3>
      <div className="space-y-2">
        {sortedSpecs.map(([specName, specValue], index) => {
          const importance = importanceMap[specName] || 'secondary';
          
          return (
            <div 
              key={`${category}-${specName}`} 
              className={`flex items-start gap-3 py-1 ${
                index === sortedSpecs.length - 1 ? 'border-b-0' : 'border-b border-b-gray-100'
              }`}
            >
              <span className={`flex-shrink-0 w-36 text-sm font-medium ${
                importance === 'primary' 
                  ? 'text-gray-900' 
                  : importance === 'secondary' 
                  ? 'text-gray-700' 
                  : 'text-gray-500'
              }`}>
                {specName}:
              </span>
              <span className={`flex-1 text-sm ${
                importance === 'primary' 
                  ? 'font-semibold text-gray-900' 
                  : importance === 'secondary' 
                  ? 'text-gray-700' 
                  : 'text-gray-500'
              }`}>
                {formatSpecValue(specValue)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}