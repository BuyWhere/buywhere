'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export interface RecentlyViewedProduct {
  id: string;
  name: string;
  image: string;
  price: string | null;
  merchant: string;
  url: string;
  viewedAt: number;
}

interface RecentlyViewedContextType {
  recentlyViewed: RecentlyViewedProduct[];
  addToRecentlyViewed: (product: Omit<RecentlyViewedProduct, 'viewedAt'>) => void;
  clearRecentlyViewed: () => void;
}

const RecentlyViewedContext = createContext<RecentlyViewedContextType | undefined>(undefined);

const STORAGE_KEY = 'bw_recently_viewed';
const MAX_RECENTLY_VIEWED = 8;

export function RecentlyViewedProvider({ children }: { children: React.ReactNode }) {
  const [recentlyViewed, setRecentlyViewed] = useState<RecentlyViewedProduct[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setRecentlyViewed(JSON.parse(stored));
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recentlyViewed));
    } catch {
      // ignore storage errors
    }
  }, [recentlyViewed]);

  const addToRecentlyViewed = useCallback((product: Omit<RecentlyViewedProduct, 'viewedAt'>) => {
    setRecentlyViewed((prev) => {
      const filtered = prev.filter((p) => p.id !== product.id);
      const newProduct: RecentlyViewedProduct = {
        ...product,
        viewedAt: Date.now(),
      };
      return [newProduct, ...filtered].slice(0, MAX_RECENTLY_VIEWED);
    });
  }, []);

  const clearRecentlyViewed = useCallback(() => {
    setRecentlyViewed([]);
  }, []);

  return (
    <RecentlyViewedContext.Provider
      value={{
        recentlyViewed,
        addToRecentlyViewed,
        clearRecentlyViewed,
      }}
    >
      {children}
    </RecentlyViewedContext.Provider>
  );
}

export function useRecentlyViewed() {
  const context = useContext(RecentlyViewedContext);
  if (!context) {
    throw new Error('useRecentlyViewed must be used within a RecentlyViewedProvider');
  }
  return context;
}