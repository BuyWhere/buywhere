'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import { RetailerPrice, SortOption } from '@/types/compare';
import styles from './PriceTable.module.css';

interface PriceTableProps {
  retailers: RetailerPrice[];
  lowestPrice: number;
  lastUpdated?: string;
  highestPrice?: number;
  averagePrice?: number;
}

interface RankingBadges {
  cheapest?: string;
  bestRated?: string;
  fastestShipping?: string;
}

const REGION_LABELS: Record<RetailerPrice['region'], string> = {
  SG: 'Singapore',
  US: 'United States',
  VN: 'Vietnam',
  TH: 'Thailand',
  MY: 'Malaysia',
};

const AVAILABILITY_BADGE: Record<RetailerPrice['availability'], { label: string; className: string }> = {
  in_stock: { label: 'In stock', className: 'inStock' },
  low_stock: { label: 'Low stock', className: 'lowStock' },
  out_of_stock: { label: 'Out of stock', className: 'outOfStock' },
  refresh_pending: { label: 'Refresh pending', className: 'refreshPending' },
};

const DEFAULT_AVAILABILITY = { label: 'Unknown', className: 'unknown' };

function getAvailabilityBadge(availability?: RetailerPrice['availability']) {
  if (!availability || !(availability in AVAILABILITY_BADGE)) {
    return DEFAULT_AVAILABILITY;
  }
  return AVAILABILITY_BADGE[availability];
}

function formatFreshness(dateStr?: string) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
}

export default function PriceTable({ retailers, lowestPrice, lastUpdated, highestPrice, averagePrice }: PriceTableProps) {
  const [sortBy, setSortBy] = useState<SortOption>('price_low_to_high');

  const rankings = useMemo<RankingBadges>(() => {
    const inStockRetailers = retailers.filter(r => r.availability === 'in_stock' || r.availability === 'low_stock');
    
    const cheapestId = inStockRetailers.length > 0
      ? inStockRetailers.reduce((min, r) => r.price < min.price ? r : min, inStockRetailers[0]).retailer_id
      : undefined;

    const bestRatedRetailer = retailers
      .filter(r => r.availability === 'in_stock' || r.availability === 'low_stock')
      .sort((a, b) => (b as unknown as { rating?: number }).rating ?? 0 - ((a as unknown as { rating?: number }).rating ?? 0))[0];
    const bestRatedId = bestRatedRetailer ? bestRatedRetailer.retailer_id : undefined;

    const fastestShippingRetailer = retailers
      .filter(r => (r.availability === 'in_stock' || r.availability === 'low_stock') && r.shipping_days !== undefined)
      .sort((a, b) => (a.shipping_days ?? Infinity) - (b.shipping_days ?? Infinity))[0];
    const fastestShippingId = fastestShippingRetailer ? fastestShippingRetailer.retailer_id : undefined;

    return {
      cheapest: cheapestId,
      bestRated: bestRatedId,
      fastestShipping: fastestShippingId,
    };
  }, [retailers]);

  const sortedRetailers = useMemo(() => {
    const sorted = [...retailers];
    switch (sortBy) {
      case 'price_low_to_high':
        return sorted.sort((a, b) => a.price - b.price);
      case 'price_high_to_low':
        return sorted.sort((a, b) => b.price - a.price);
      case 'availability':
        const availabilityOrder: Record<string, number> = { in_stock: 0, low_stock: 1, out_of_stock: 2, refresh_pending: 3, unknown: 4 };
        return sorted.sort(
          (a, b) => (availabilityOrder[a.availability] ?? 4) - (availabilityOrder[b.availability] ?? 4)
        );
      default:
        return sorted;
    }
  }, [retailers, sortBy]);

  const freshness = formatFreshness(lastUpdated);

  return (
    <section className={styles.section} aria-label="Price Comparison">
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.titleRow}>
            <h2 className={styles.title}>Compare Prices</h2>
            {freshness && (
              <span className={styles.freshness}>Updated {freshness}</span>
            )}
          </div>

          {(highestPrice !== undefined && averagePrice !== undefined) && (
            <div className={styles.statsBar}>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Lowest</span>
                <span className={styles.statValue}>{lowestPrice.toFixed(2)}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Average</span>
                <span className={styles.statValue}>{averagePrice.toFixed(2)}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Highest</span>
                <span className={styles.statValue}>{highestPrice.toFixed(2)}</span>
              </div>
            </div>
          )}

          <div className={styles.sortPills} role="group" aria-label="Sort options">
            <button
              type="button"
              className={`${styles.sortPill} ${sortBy === 'price_low_to_high' ? styles.sortPillActive : ''}`}
              onClick={() => setSortBy('price_low_to_high')}
              aria-pressed={sortBy === 'price_low_to_high'}
            >
              Price: Low to High
            </button>
            <button
              type="button"
              className={`${styles.sortPill} ${sortBy === 'price_high_to_low' ? styles.sortPillActive : ''}`}
              onClick={() => setSortBy('price_high_to_low')}
              aria-pressed={sortBy === 'price_high_to_low'}
            >
              Price: High to Low
            </button>
            <button
              type="button"
              className={`${styles.sortPill} ${sortBy === 'availability' ? styles.sortPillActive : ''}`}
              onClick={() => setSortBy('availability')}
              aria-pressed={sortBy === 'availability'}
            >
              Availability
            </button>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table} role="grid" aria-label="Retailer comparison table">
            <thead>
              <tr>
                <th scope="col" className={styles.retailerHeader}>Retailer</th>
                <th scope="col" className={styles.regionHeader}>Region</th>
                <th scope="col" className={styles.availabilityHeader}>Availability</th>
                <th scope="col" className={styles.priceHeader}>Price</th>
                <th scope="col" className={styles.deliveryHeader}>Delivery / Pickup</th>
                <th scope="col" className={styles.buyHeader}></th>
              </tr>
            </thead>
            <tbody>
              {sortedRetailers.map((retailer) => {
                const isLowest = retailer.price === lowestPrice && (retailer.availability === 'in_stock' || retailer.availability === 'low_stock');
                const isCheapest = rankings.cheapest === retailer.retailer_id;
                const isBestRated = rankings.bestRated === retailer.retailer_id;
                const isFastestShipping = rankings.fastestShipping === retailer.retailer_id;
                const hasRanking = isCheapest || isBestRated || isFastestShipping;

                return (
                  <tr
                    key={retailer.retailer_id}
                    className={`${styles.row} ${isLowest ? styles.lowestRow : ''}`}
                  >
                    <td className={styles.retailerCell}>
                      <div className={styles.retailerInfo}>
                        {hasRanking && (
                          <div className={styles.rankingBadge}>
                            {isCheapest && (
                              <span className={`${styles.badgePill} ${styles.cheapestBadge}`}>
                                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={styles.badgeIcon}>
                                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                                </svg>
                                CHEAPEST
                              </span>
                            )}
                            {isBestRated && (
                              <span className={`${styles.badgePill} ${styles.bestRatedBadge}`}>
                                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={styles.badgeIcon}>
                                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                                </svg>
                                BEST RATED
                              </span>
                            )}
                            {isFastestShipping && !isCheapest && (
                              <span className={`${styles.badgePill} ${styles.fastestBadge}`}>
                                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={styles.badgeIcon}>
                                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                                </svg>
                                FASTEST
                              </span>
                            )}
                          </div>
                        )}
                        <Image
                          src={retailer.retailer_logo_url}
                          alt={retailer.retailer_name}
                          width={80}
                          height={32}
                          className={styles.retailerLogo}
                        />
                        <span className={styles.retailerName}>{retailer.retailer_name}</span>
                      </div>
                    </td>
                    <td className={styles.regionCell}>
                      <span className={styles.regionBadge} data-region={retailer.region?.toLowerCase() || 'unknown'}>
                        {REGION_LABELS[retailer.region] || 'Unknown'}
                      </span>
                    </td>
                    <td className={styles.availabilityCell}>
                      {(() => {
                        const badge = getAvailabilityBadge(retailer.availability);
                        return (
                          <span className={`${styles.badge} ${styles[badge.className]}`}>
                            {badge.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className={styles.priceCell}>
                      <span className={styles.price}>{retailer.price_formatted}</span>
                      {isLowest && (
                        <span className={styles.bestPriceLabel}>Best current price</span>
                      )}
                      {retailer.delta_vs_lowest !== undefined && retailer.delta_vs_lowest > 0 && (
                        <span className={styles.priceDelta}>+{retailer.delta_vs_lowest.toFixed(2)} more</span>
                      )}
                    </td>
                    <td className={styles.deliveryCell}>
                      <span className={styles.deliveryNote}>{retailer.shipping_note || '—'}</span>
                    </td>
                    <td className={styles.buyCell}>
                      <a
                        href={retailer.affiliate_url || retailer.url}
                        className={`${styles.cta} ${isLowest ? styles.ctaPrimary : ''}`}
                        target="_blank"
                        rel="noopener sponsored"
                        aria-label={`Buy from ${retailer.retailer_name}`}
                      >
                        {isLowest ? 'Best Price' : 'View Deal'}
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={styles.disclosure}>
          Prices and stock may change after the last sync. We may earn a commission when you click.
        </div>
      </div>

      <div className={styles.mobileCards} role="list" aria-label="Retailer offers">
        {sortedRetailers.map((retailer) => {
          const isLowest = retailer.price === lowestPrice && (retailer.availability === 'in_stock' || retailer.availability === 'low_stock');
          const isCheapest = rankings.cheapest === retailer.retailer_id;
          const isBestRated = rankings.bestRated === retailer.retailer_id;
          const isFastestShipping = rankings.fastestShipping === retailer.retailer_id;

          return (
            <article
              key={retailer.retailer_id}
              className={`${styles.mobileCard} ${isLowest ? styles.mobileCardBest : ''}`}
              role="listitem"
            >
              {(isCheapest || isBestRated || isFastestShipping) && (
                <div className={styles.mobileBadges}>
                  {isCheapest && (
                    <span className={`${styles.mobileBadge} ${styles.cheapestBadge}`}>CHEAPEST</span>
                  )}
                  {isBestRated && (
                    <span className={`${styles.mobileBadge} ${styles.bestRatedBadge}`}>BEST RATED</span>
                  )}
                  {isFastestShipping && !isCheapest && (
                    <span className={`${styles.mobileBadge} ${styles.fastestBadge}`}>FASTEST SHIP</span>
                  )}
                </div>
              )}
              {isLowest && (
                <div className={styles.bestPriceBanner}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Best current price
                </div>
              )}
              <div className={styles.mobileCardHeader}>
                <Image
                  src={retailer.retailer_logo_url}
                  alt={retailer.retailer_name}
                  width={64}
                  height={24}
                  className={styles.mobileLogo}
                />
                <span className={styles.mobilePrice}>{retailer.price_formatted}</span>
              </div>
              <div className={styles.mobileCardMeta}>
                {(() => {
                  const badge = getAvailabilityBadge(retailer.availability);
                  return (
                    <span className={`${styles.badge} ${styles[badge.className]}`}>
                      {badge.label}
                    </span>
                  );
                })()}
                <span className={styles.mobileRegion}>{REGION_LABELS[retailer.region] || 'Unknown'}</span>
              </div>
              {retailer.shipping_note && (
                <p className={styles.mobileDelivery}>{retailer.shipping_note}</p>
              )}
              <a
                href={retailer.affiliate_url || retailer.url}
                className={`${styles.mobileCta} ${isLowest ? styles.mobileCtaPrimary : ''}`}
                target="_blank"
                rel="noopener sponsored"
              >
                {isLowest ? 'Get Best Price' : 'View Deal'}
              </a>
            </article>
          );
        })}
      </div>
    </section>
  );
}