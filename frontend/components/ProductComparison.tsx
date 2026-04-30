'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import { ProductResponse } from '@/types/category';
import { formatPrice } from '@/lib/categoryApi';
import styles from './ProductComparison.module.css';

interface ProductComparisonProps {
  products: ProductResponse[];
  maxProducts?: 2 | 3 | 4;
  onRemove?: (productId: number) => void;
  onCompare?: (productIds: number[]) => void;
}

interface SpecRow {
  label: string;
  values: (string | null)[];
}

export default function ProductComparison({
  products,
  maxProducts = 4,
  onRemove,
  onCompare,
}: ProductComparisonProps) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectCount, setSelectCount] = useState<2 | 3 | 4>(2);

  const selectableProducts = useMemo(() => products.slice(0, maxProducts), [products, maxProducts]);

  const selectedProducts = useMemo(
    () => selectableProducts.filter((p) => selectedIds.includes(p.id)),
    [selectableProducts, selectedIds]
  );

  const toggleProduct = (productId: number) => {
    setSelectedIds((prev) => {
      if (prev.includes(productId)) {
        return prev.filter((id) => id !== productId);
      }
      if (prev.length >= selectCount) {
        return prev;
      }
      return [...prev, productId];
    });
  };

  const specRows: SpecRow[] = useMemo(() => {
    if (selectedProducts.length === 0) return [];

    const allSpecs = new Map<string, (string | null)[]>();

    selectedProducts.forEach((product) => {
      const rawSpecs = 'specs' in product ? (product as unknown as { specs?: unknown }).specs : undefined;
      let specs: Record<string, string> = {};

      if (typeof rawSpecs === 'string') {
        try {
          specs = JSON.parse(rawSpecs);
        } catch {
          specs = {};
        }
      } else if (Array.isArray(rawSpecs)) {
        rawSpecs.forEach((s: unknown) => {
          if (typeof s === 'object' && s !== null && 'label' in s && 'value' in s) {
            specs[(s as { label: string }).label] = String((s as { value: unknown }).value);
          }
        });
      } else if (typeof rawSpecs === 'object') {
        specs = rawSpecs as Record<string, string>;
      }

      Object.entries(specs).forEach(([label, value]) => {
        const current = allSpecs.get(label) || Array(selectedProducts.length).fill(null);
        const productIndex = selectedProducts.findIndex((p) => p.id === product.id);
        current[productIndex] = value;
        allSpecs.set(label, current);
      });
    });

    return Array.from(allSpecs.entries()).map(([label, values]) => ({ label, values }));
  }, [selectedProducts]);

  const handleCompare = () => {
    if (onCompare && selectedIds.length === selectCount) {
      onCompare(selectedIds);
    }
  };

  const isSelected = (productId: number) => selectedIds.includes(productId);
  const canAddMore = selectedIds.length < selectCount;

  return (
    <section className={styles.section} aria-label="Product Comparison">
      <div className={styles.header}>
        <h2 className={styles.title}>Compare Products</h2>
        <div className={styles.controls}>
          <div className={styles.selectCount} role="group" aria-label="Number of products to compare">
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                className={`${styles.countPill} ${selectCount === n ? styles.countPillActive : ''}`}
                onClick={() => {
                  setSelectCount(n as 2 | 3 | 4);
                  setSelectedIds((prev) => prev.slice(0, n));
                }}
                aria-pressed={selectCount === n}
              >
                {n} Products
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.selectionGrid} style={{ '--col-count': selectCount } as React.CSSProperties}>
        {selectableProducts.map((product) => {
          const selected = isSelected(product.id);
          const disabled = !selected && !canAddMore;
          return (
            <button
              key={product.id}
              type="button"
              className={`${styles.selectionCard} ${selected ? styles.selectionCardSelected : ''} ${disabled ? styles.selectionCardDisabled : ''}`}
              onClick={() => toggleProduct(product.id)}
              disabled={disabled}
              aria-pressed={selected}
              aria-label={`Select ${product.name} for comparison`}
            >
              <div className={styles.selectionImage}>
                {product.image_url ? (
                  <Image
                    src={product.image_url}
                    alt={product.name}
                    fill
                    sizes="150px"
                    className={styles.image}
                  />
                ) : (
                  <div className={styles.imagePlaceholder}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                  </div>
                )}
                {selected && (
                  <div className={styles.checkBadge} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
              </div>
              <span className={styles.selectionName}>{product.name}</span>
              <span className={styles.selectionPrice}>
                {formatPrice(product.price, product.currency)}
              </span>
            </button>
          );
        })}
      </div>

      {selectedProducts.length === selectCount && (
        <div className={styles.comparisonTable}>
          <div className={styles.tableHeader}>
            <div className={styles.attrHeader}></div>
            {selectedProducts.map((product) => (
              <div key={product.id} className={styles.productHeader}>
                <div className={styles.productHeaderImage}>
                  {product.image_url ? (
                    <Image
                      src={product.image_url}
                      alt={product.name}
                      fill
                      sizes="80px"
                      className={styles.image}
                    />
                  ) : (
                    <div className={styles.imagePlaceholder} />
                  )}
                </div>
                <span className={styles.productHeaderName}>{product.name}</span>
                {onRemove && (
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={() => onRemove(product.id)}
                    aria-label={`Remove ${product.name} from comparison`}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className={styles.tableBody}>
            <div className={styles.row}>
              <div className={styles.attrLabel}>Price</div>
              {selectedProducts.map((product) => (
                <div key={product.id} className={styles.valueCell}>
                  <span className={styles.priceValue}>
                    {formatPrice(product.price, product.currency)}
                  </span>
                </div>
              ))}
            </div>

            <div className={styles.row}>
              <div className={styles.attrLabel}>Rating</div>
              {selectedProducts.map((product) => (
                <div key={product.id} className={styles.valueCell}>
                  {product.rating !== undefined && product.rating !== null ? (
                    <div className={styles.rating}>
                      <span className={styles.ratingStars} aria-label={`${product.rating} out of 5 stars`}>
                        {'★'.repeat(Math.round(Number(product.rating)))}
                        {'☆'.repeat(5 - Math.round(Number(product.rating)))}
                      </span>
                      {product.review_count !== undefined && product.review_count !== null && (
                        <span className={styles.reviewCount}>({product.review_count})</span>
                      )}
                    </div>
                  ) : (
                    <span className={styles.noValue}>—</span>
                  )}
                </div>
              ))}
            </div>

            <div className={styles.row}>
              <div className={styles.attrLabel}>Availability</div>
              {selectedProducts.map((product) => {
                const stockLabel = product.is_available
                  ? product.in_stock === false
                    ? 'Out of stock'
                    : 'In stock'
                  : 'Out of stock';
                const stockClass = product.is_available
                  ? product.in_stock === false
                    ? styles.outOfStock
                    : styles.inStock
                  : styles.outOfStock;
                return (
                  <div key={product.id} className={styles.valueCell}>
                    <span className={`${styles.stockBadge} ${stockClass}`}>{stockLabel}</span>
                  </div>
                );
              })}
            </div>

            <div className={styles.row}>
              <div className={styles.attrLabel}>Brand</div>
              {selectedProducts.map((product) => (
                <div key={product.id} className={styles.valueCell}>
                  <span className={styles.brandValue}>{product.brand || '—'}</span>
                </div>
              ))}
            </div>

            <div className={styles.row}>
              <div className={styles.attrLabel}>Source</div>
              {selectedProducts.map((product) => (
                <div key={product.id} className={styles.valueCell}>
                  <span className={styles.sourceValue}>{product.source?.replace(/_/g, ' ') || '—'}</span>
                </div>
              ))}
            </div>

            {specRows.map((specRow) => (
              <div key={specRow.label} className={styles.row}>
                <div className={styles.attrLabel}>{specRow.label}</div>
                {specRow.values.map((value, idx) => (
                  <div key={idx} className={styles.valueCell}>
                    <span className={styles.specValue}>{value || '—'}</span>
                  </div>
                ))}
              </div>
            ))}

            <div className={`${styles.row} ${styles.actionRow}`}>
              <div className={styles.attrLabel}></div>
              {selectedProducts.map((product) => (
                <div key={product.id} className={styles.valueCell}>
                  <a
                    href={product.affiliate_url || product.buy_url}
                    className={styles.cta}
                    target="_blank"
                    rel="noopener sponsored"
                    aria-label={`Buy ${product.name}`}
                  >
                    View Deal
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedProducts.length === selectCount && onCompare && (
        <div className={styles.compareActions}>
          <button
            type="button"
            className={styles.compareBtn}
            onClick={handleCompare}
          >
            Compare {selectCount} Products
          </button>
        </div>
      )}
    </section>
  );
}