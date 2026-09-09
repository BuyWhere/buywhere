'use client';

import { ArrowRight } from 'lucide-react';

interface PriceData {
  merchant: string;
  price: string | null;
  inStock: boolean;
  rating?: number;
}

interface USProduct {
  id: string;
  name: string;
  brand: string;
  sku?: string;
  msrp?: string;
  prices: PriceData[];
}

interface PriceComparisonProps {
  products: USProduct[];
  onProductClick: (name: string) => void;
}

const MerchantIcon = ({ merchant }: { merchant: string }) => {
  const icon = merchant === 'Amazon.com' ? '📦' : merchant === 'Walmart' ? '🛒' : merchant === 'Target' ? '🎯' : '🏪';
  return <span className="text-xl">{icon}</span>;
};

export function PriceComparison({ products, onProductClick }: PriceComparisonProps) {
  return (
    <div className="mt-16">
      <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-6 text-center">
        See how we compare prices on popular products
      </h2>
      <div className="grid gap-8 md:grid-cols-3">
        {products.map((product) => {
          const prices = product.prices.filter(p => p.price !== null);
          const lowestPrice = prices.length > 0 
            ? Math.min(...prices.map(p => parseFloat(p.price as string)))
            : null;

          return (
            <div key={product.id} className="bg-white rounded-2xl border border-gray-200 p-6 hover:shadow-lg transition-all hover:border-indigo-100">
              <div className="mb-4">
                <h3 className="text-xl font-bold text-gray-900">{product.name}</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {product.brand} • {product.sku || 'SKU-US-1000'}
                </p>
              </div>
              
              <div className="space-y-4">
                {product.prices.map((price) => {
                  const isLowest = price.price !== null && parseFloat(price.price) === lowestPrice;
                  
                  return (
                    <div key={price.merchant} className="flex items-start gap-4 py-3 border-t border-gray-100 first:border-t-0">
                      <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                        <MerchantIcon merchant={price.merchant} />
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex justify-between items-start">
                          <div className="text-sm font-medium text-gray-700">{price.merchant}</div>
                          <div className="text-sm text-gray-500">
                            {price.inStock ? 'In Stock' : 'Out of Stock'}
                          </div>
                        </div>
                        <div className={`
                          text-2xl font-bold 
                          ${isLowest ? 'text-indigo-600' : 'text-gray-900'}
                          ${price.price === null ? 'text-gray-400' : ''}
                          relative
                        `}>
                          {price.price !== null ? `$${price.price}` : '—'}
                          {isLowest && price.price !== null && (
                            <span className="absolute -top-2 left-2 bg-indigo-600 text-white text-xs font-bold rounded-full px-2 py-0.5">
                              Lowest
                            </span>
                          )}
                        </div>
                        {price.rating && (
                          <div className="flex items-center gap-1 text-sm text-gray-500">
                            <span className="text-yellow-400">★</span>
                            <span>{price.rating.toFixed(1)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
             
              {product.msrp && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="text-sm text-gray-500">MSRP: ${product.msrp}</div>
                </div>
              )}
              
              <div className="mt-6 pt-4 border-t border-gray-200">
                <button
                  onClick={() => onProductClick(product.name)}
                  className="w-full flex items-center justify-center px-5 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  See full comparison
                  <ArrowRight className="ml-2 h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default PriceComparison;
