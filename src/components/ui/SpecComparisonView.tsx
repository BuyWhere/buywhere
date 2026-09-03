'use client';

import { USProduct } from '@/components/USPriceComparison';

interface SpecComparisonViewProps {
  products: USProduct[]; // 2-4 products for comparison
  categoriesToShow?: string[]; // Filter spec categories
  comparisonType?: 'detailed' | 'highlight-differences';
}

const DEFAULT_CATEGORY_MAP: Record<string, string[]> = {
  'Core Specifications': ['Brand', 'Model', 'Color', 'SKU', 'UPC', 'EAN'],
  'Audio Specifications': ['Type', 'Noise Cancel', 'Noise Cancellation', 'Battery Life', 'Charging', 'Bluetooth', 'Wireless'],
  'Connectivity': ['Bluetooth', 'Wi-Fi', 'NFC', 'USB', 'Port', 'Connector', 'multipoint', 'App Support'],
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

function areSpecsEqual(val1: string, val2: string): boolean {
  // Handle boolean values
  const bool1 = val1.toLowerCase() === 'yes' || val1.toLowerCase() === 'true';
  const bool2 = val2.toLowerCase() === 'yes' || val2.toLowerCase() === 'true';
  if ((bool1 || val1.toLowerCase() === 'no' || val1.toLowerCase() === 'false') && 
      (bool2 || val2.toLowerCase() === 'no' || val2.toLowerCase() === 'false')) {
    return bool1 === bool2;
  }
  
  // Handle numeric values with potential units
  const num1 = parseFloat(val1.replace(/[^0-9.-]/g, ''));
  const num2 = parseFloat(val2.replace(/[^0-9.-]/g, ''));
  
  if (!isNaN(num1) && !isNaN(num2)) {
    return Math.abs(num1 - num2) < 0.01; // Allow small floating point differences
  }
  
  // String comparison
  return val1.trim().toLowerCase() === val2.trim().toLowerCase();
}

function formatSpecValue(value: string): string {
  // Handle boolean values
  if (value.toLowerCase() === 'yes' || value.toLowerCase() === 'true') {
    return '✅ Yes';
  }
  if (value.toLowerCase() === 'no' || value.toLowerCase() === 'false') {
    return '❌ No';
  }
  
  // Handle ratings
  if (value.match(/^\d+\.?\d*\s*\/\s*5$/)) {
    return value;
  }
  
  return value;
}

function getSpecDifferenceType(val1: string, val2: string): 'same' | 'different' | 'numeric' {
  if (areSpecsEqual(val1, val2)) {
    return 'same';
  }
  
  // Check if both are numeric for difference calculation
  const num1 = parseFloat(val1.replace(/[^0-9.-]/g, ''));
  const num2 = parseFloat(val2.replace(/[^0-9.-]/g, ''));
  
  if (!isNaN(num1) && !isNaN(num2)) {
    return 'numeric';
  }
  
  return 'different';
}

function calculateNumericDifference(val1: string, val2: string): { value: string; unit: string } | null {
  // Extract numbers and units
  const match1 = val1.match(/^([0-9.-]+)\s*(.*)$/);
  const match2 = val2.match(/^([0-9.-]+)\s*(.*)$/);
  
  if (!match1 || !match2) return null;
  
  const num1 = parseFloat(match1[1]);
  const num2 = parseFloat(match2[1]);
  
  if (isNaN(num1) || isNaN(num2)) return null;
  
  const unit1 = match1[2].trim();
  const unit2 = match2[2].trim();
  
  // Use the first unit if they match, otherwise show both
  const unit = unit1 === unit2 && unit1 !== '' ? unit1 : `${unit1}/${unit2}`;
  
  const difference = num2 - num1; // Product B - Product A
  
  return {
    value: Math.abs(difference).toFixed(1),
    unit: unit
  };
}

export default function SpecComparisonView({
  products,
  categoriesToShow,
  comparisonType = 'highlight-differences',
}: SpecComparisonViewProps) {
  if (products.length < 2) {
    return (
      <div className="bg-gray-50 p-4 rounded-lg text-center text-gray-500">
        Need at least 2 products for comparison
      </div>
    );
  }
  
  // Collect all unique spec categories from all products
  const allCategories = new Set<string>();
  products.forEach(product => {
    Object.keys(product.specs).forEach(specName => {
      allCategories.add(getSpecCategory(specName));
    });
  });
  
  // Filter categories if specified
  const categories = categoriesToShow 
    ? Array.from(allCategories).filter(cat => categoriesToShow.includes(cat))
    : Array.from(allCategories);
  
  // Sort categories with common ones first
  const sortedCategories = categories.sort((a, b) => {
    const priority: Record<string, number> = {
      'Core Specifications': 1,
      'Audio Specifications': 2,
      'Connectivity': 3,
      'Display': 4,
      'Performance': 5,
      'Physical': 6,
      'Camera': 7,
    };
    
    return (priority[a] || 99) - (priority[b] || 99);
  });
  
  return (
    <div className="space-y-6">
      {sortedCategories.map(category => {
        // Gather specs for this category from all products
        const categorySpecs: Record<string, Record<string, string>> = {};
        
        products.forEach((product, productIndex) => {
          Object.entries(product.specs).forEach(([specName, specValue]) => {
            if (getSpecCategory(specName) === category) {
              if (!categorySpecs[specName]) {
                categorySpecs[specName] = {};
              }
              categorySpecs[specName][`product${productIndex}`] = specValue;
            }
          });
        });
        
        if (Object.keys(categorySpecs).length === 0) {
          return null;
        }
        
        return (
          <div key={category} className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 border-b-2 pb-2">
              {category}
            </h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Specification
                    </th>
                    {products.map((product, index) => (
                      <th 
                        key={`product-${index}`} 
                        className={`px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-weter`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-medium">
                            {product.name.split(' ')[0]} {/* First word of product name */}
                          </span>
                        </div>
                      </th>
                    ))}
                    {comparisonType === 'highlight-differences' && (
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Difference
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {Object.entries(categorySpecs).map(([specName, values]) => {
                    // Check if all values are the same
                    const valueArray = Object.values(values);
                    const allSame = valueArray.every(val => 
                      areSpecsEqual(val, valueArray[0])
                    );
                    
                    const differenceType = comparisonType === 'highlight-differences' 
                      ? getSpecDifferenceType(
                          values.product0 || '', 
                          values.product1 || ''
                        )
                      : 'same';
                    
                    return (
                      <tr 
                        key={specName} 
                        className={`hover:bg-gray-50 ${
                          allSame 
                            ? '' 
                            : comparisonType === 'highlight-differences' 
                            ? 'border-l-2 border-l-blue-400' 
                            : ''
                        }`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {specName}
                        </td>
                        {products.map((product, index) => {
                          const value = values[`product${index}`] || '—';
                          
                          return (
                            <td 
                              key={`product-${index}`} 
                              className={`px-6 py-4 whitespace-nowrap text-sm ${
                                allSame 
                                  ? 'text-gray-700' 
                                  : 'font-medium text-gray-900'
                              }`}
                            >
                              {formatSpecValue(value)}
                            </td>
                          );
                        })}
                        {comparisonType === 'highlight-differences' && (
                          <td 
                            className={`px-6 py-4 whitespace-nowrap text-sm ${
                              allSame 
                                ? 'text-green-600' 
                                : differenceType === 'numeric' 
                                ? 'text-blue-600 font-medium' 
                                : 'text-red-600'
                            }`}
                          >
                            {allSame ? (
                              <span className="text-xs">Same</span>
                            ) : differenceType === 'numeric' ? (
                              <>
                                <div className="text-xs mb-1 flex items-center gap-1">
                                  {parseFloat(values.product1 || '0') > parseFloat(values.product0 || '0') 
                                    ? '+' 
                                    : '-'}
                                </div>
                                <div className="font-medium block">
                                  {calculateNumericDifference(
                                    values.product0 || '0', 
                                    values.product1 || '0'
                                  )?.value}
                                  {calculateNumericDifference(
                                    values.product0 || '0', 
                                    values.product1 || '0'
                                  )?.unit}
                                </div>
                              </>
                            ) : (
                              <span className="text-xs">Different</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}