'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import styles from './Pagination.module.css';

interface PaginationProps {
  total: number;
  limit: number;
  offset: number;
  category?: string;
  basePath?: string;
  searchQ?: string;
}

export default function Pagination({ total, limit, offset, category, basePath, searchQ }: PaginationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);
  const hasNext = offset + limit < total;
  const hasPrev = offset > 0;

  const getBasePath = () => {
    if (basePath) return basePath;
    if (searchQ) return '/search';
    if (category) return `/category/${category}`;
    return '/';
  };

  const goToPage = useCallback(
    (page: number) => {
      const newOffset = (page - 1) * limit;
      const params = new URLSearchParams(searchParams.toString());
      if (searchQ) {
        params.set('q', searchQ);
      }
      params.set('offset', String(newOffset));
      router.push(`${getBasePath()}?${params.toString()}`, { scroll: false });
    },
    [limit, router, searchParams, searchQ]
  );

  const getVisiblePages = () => {
    const pages: (number | 'ellipsis')[] = [];
    const showEllipsis = totalPages > 7;

    if (!showEllipsis) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else if (currentPage <= 4) {
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push('ellipsis');
      pages.push(totalPages);
    } else if (currentPage >= totalPages - 3) {
      pages.push(1);
      pages.push('ellipsis');
      for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      pages.push('ellipsis');
      for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
      pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  };

  if (totalPages <= 1) return null;

  return (
    <nav className={styles.pagination} aria-label="Pagination">
      <button
        type="button"
        className={`${styles.pageButton} ${styles.navButton}`}
        onClick={() => goToPage(currentPage - 1)}
        disabled={!hasPrev}
        aria-label="Previous page"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <div className={styles.pages}>
        {getVisiblePages().map((page, idx) =>
          page === 'ellipsis' ? (
            <span key={`ellipsis-${idx}`} className={styles.ellipsis}>
              …
            </span>
          ) : (
            <button
              key={page}
              type="button"
              className={`${styles.pageButton} ${page === currentPage ? styles.active : ''}`}
              onClick={() => goToPage(page)}
              aria-current={page === currentPage ? 'page' : undefined}
              aria-label={`Page ${page}`}
            >
              {page}
            </button>
          )
        )}
      </div>

      <button
        type="button"
        className={`${styles.pageButton} ${styles.navButton}`}
        onClick={() => goToPage(currentPage + 1)}
        disabled={!hasNext}
        aria-label="Next page"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </nav>
  );
}