"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export interface WishlistProductInput {
  id: string;
  name: string;
  image: string;
  currentPrice: string | null;
  merchant: string;
  buyUrl: string;
  productUrl: string;
  brand?: string;
  apiProductId?: number;
}

export interface WishlistProduct extends WishlistProductInput {
  savedAt: number;
  priceAtSave: string | null;
}

interface WishlistContextType {
  wishlist: WishlistProduct[];
  addToWishlist: (product: WishlistProductInput) => void;
  removeFromWishlist: (productId: string) => void;
  toggleWishlist: (product: WishlistProductInput) => void;
  updateWishlistItem: (productId: string, updates: Partial<WishlistProductInput>) => void;
  clearWishlist: () => void;
  isInWishlist: (productId: string) => boolean;
  wishlistCount: number;
}

const WishlistContext = createContext<WishlistContextType | undefined>(undefined);

const STORAGE_KEY = "bw_wishlist";

function parseWishlist(raw: string | null): WishlistProduct[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as WishlistProduct[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [wishlist, setWishlist] = useState<WishlistProduct[]>([]);

  useEffect(() => {
    setWishlist(parseWishlist(window.localStorage.getItem(STORAGE_KEY)));

    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setWishlist(parseWishlist(event.newValue));
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(wishlist));
    } catch {
      // Ignore storage write errors.
    }
  }, [wishlist]);

  const addToWishlist = useCallback((product: WishlistProductInput) => {
    setWishlist((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      const baseItem: WishlistProduct = {
        ...product,
        savedAt: existing?.savedAt ?? Date.now(),
        priceAtSave: existing?.priceAtSave ?? product.currentPrice,
      };

      const remaining = prev.filter((item) => item.id !== product.id);
      return [baseItem, ...remaining];
    });
  }, []);

  const removeFromWishlist = useCallback((productId: string) => {
    setWishlist((prev) => prev.filter((item) => item.id !== productId));
  }, []);

  const toggleWishlist = useCallback((product: WishlistProductInput) => {
    setWishlist((prev) => {
      const exists = prev.some((item) => item.id === product.id);
      if (exists) {
        return prev.filter((item) => item.id !== product.id);
      }

      return [
        {
          ...product,
          savedAt: Date.now(),
          priceAtSave: product.currentPrice,
        },
        ...prev,
      ];
    });
  }, []);

  const updateWishlistItem = useCallback((productId: string, updates: Partial<WishlistProductInput>) => {
    setWishlist((prev) =>
      prev.map((item) => {
        if (item.id !== productId) {
          return item;
        }

        return {
          ...item,
          ...updates,
        };
      })
    );
  }, []);

  const clearWishlist = useCallback(() => {
    setWishlist([]);
  }, []);

  const isInWishlist = useCallback(
    (productId: string) => wishlist.some((item) => item.id === productId),
    [wishlist]
  );

  return (
    <WishlistContext.Provider
      value={{
        wishlist,
        addToWishlist,
        removeFromWishlist,
        toggleWishlist,
        updateWishlistItem,
        clearWishlist,
        isInWishlist,
        wishlistCount: wishlist.length,
      }}
    >
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const context = useContext(WishlistContext);
  if (!context) {
    throw new Error("useWishlist must be used within a WishlistProvider");
  }
  return context;
}
