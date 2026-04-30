"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { AffiliateLink } from "@/components/AffiliateLink";
import { useWishlist, type WishlistProduct } from "@/lib/wishlist-context";

const API_BASE_URL = process.env.NEXT_PUBLIC_BUYWHERE_API_URL || "https://api.buywhere.ai";
const API_KEY = process.env.NEXT_PUBLIC_BUYWHERE_API_KEY || "";

interface ProductMatchesResponse {
  matches?: Array<{
    price: number;
    name: string;
  }>;
}

function formatPrice(price: string | null): string {
  if (!price) {
    return "Price unavailable";
  }

  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice)) {
    return price;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(numericPrice);
}

function getPriceDrop(item: WishlistProduct): number | null {
  if (!item.currentPrice || !item.priceAtSave) {
    return null;
  }

  const current = Number(item.currentPrice);
  const saved = Number(item.priceAtSave);
  if (!Number.isFinite(current) || !Number.isFinite(saved) || current >= saved) {
    return null;
  }

  return saved - current;
}

function WishlistCard({ item, onRemove }: { item: WishlistProduct; onRemove: (id: string) => void }) {
  const priceDrop = getPriceDrop(item);
  const internalProduct = item.productUrl.startsWith("/");

  const content = (
    <>
      <div className="relative aspect-square overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.18),_rgba(248,250,252,0.95)_55%,_rgba(226,232,240,0.92))]">
        {item.image ? (
          <Image
            src={item.image}
            alt={item.name}
            fill
            sizes="(max-width: 768px) 100vw, 320px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl text-slate-300">◎</div>
        )}
        {priceDrop !== null ? (
          <div className="absolute left-3 top-3 rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white">
            Price dropped
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{item.brand || item.merchant}</p>
            <h2 className="mt-2 text-lg font-semibold leading-tight text-slate-900">{item.name}</h2>
          </div>
          <button
            onClick={() => onRemove(item.id)}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:border-rose-200 hover:text-rose-600"
          >
            Remove
          </button>
        </div>

        <div className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Current price</p>
              <p className="text-2xl font-semibold text-slate-900">{formatPrice(item.currentPrice)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Saved at</p>
              <p className="text-sm font-semibold text-slate-600">{formatPrice(item.priceAtSave)}</p>
            </div>
          </div>
          {priceDrop !== null ? (
            <p className="text-sm font-medium text-emerald-700">
              Price dropped since saved! Now {formatPrice(String(priceDrop))} lower.
            </p>
          ) : (
            <p className="text-sm text-slate-500">Tracking from {new Date(item.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
          )}
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          {internalProduct ? (
            <Link
              href={item.productUrl}
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-amber-300 hover:text-amber-700"
            >
              View details
            </Link>
          ) : null}
          <AffiliateLink
            productId={item.id}
            platform={item.merchant.toLowerCase().replace(".", "")}
            productName={item.name}
            href={item.buyUrl}
            className="inline-flex items-center justify-center rounded-xl bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-300"
          >
            Buy now
          </AffiliateLink>
        </div>
      </div>
    </>
  );

  if (internalProduct) {
    return (
      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        {content}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      {content}
    </div>
  );
}

export default function WishlistPageClient() {
  const { wishlist, removeFromWishlist, updateWishlistItem, clearWishlist } = useWishlist();
  const refreshedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const refreshPrices = async () => {
      await Promise.all(
        wishlist.map(async (item) => {
          if (!item.apiProductId || refreshedIdsRef.current.has(item.id)) {
            return;
          }

          refreshedIdsRef.current.add(item.id);

          try {
            const response = await fetch(`${API_BASE_URL}/v1/products/${item.apiProductId}/matches`, {
              headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : undefined,
            });

            if (!response.ok) {
              return;
            }

            const payload = (await response.json()) as ProductMatchesResponse;
            const prices = Array.isArray(payload.matches)
              ? payload.matches.map((match) => match.price).filter((value) => Number.isFinite(value))
              : [];

            if (prices.length === 0) {
              return;
            }

            const nextPrice = String(Math.min(...prices));
            if (nextPrice !== item.currentPrice) {
              updateWishlistItem(item.id, { currentPrice: nextPrice });
            }
          } catch {
            // Ignore refresh failures and keep the saved snapshot visible.
          }
        })
      );
    };

    void refreshPrices();
  }, [updateWishlistItem, wishlist]);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f8fafc_0%,_#ffffff_28%,_#f8fafc_100%)]">
      <Nav />
      <main className="pb-20">
        <section className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.16),_rgba(255,255,255,0)_34%),linear-gradient(135deg,_#0f172a,_#1e293b_58%,_#334155)] py-16 text-white">
          <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 sm:px-6">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-300">Wishlist</p>
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Saved products to track</h1>
                <p className="mt-3 max-w-2xl text-sm text-slate-300 sm:text-base">
                  Keep a shortlist of products, revisit the latest price, and jump back out when a deal looks ready.
                </p>
              </div>
              {wishlist.length > 0 ? (
                <button
                  onClick={clearWishlist}
                  className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/15"
                >
                  Clear wishlist
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          {wishlist.length === 0 ? (
            <div className="rounded-[32px] border border-dashed border-slate-300 bg-white p-12 text-center shadow-sm">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-3xl text-amber-700">
                ♥
              </div>
              <h2 className="mt-6 text-2xl font-semibold text-slate-900">Your wishlist is empty</h2>
              <p className="mt-3 text-slate-500">Search for a product and click ♥ to save it.</p>
              <Link
                href="/search"
                className="mt-6 inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
              >
                Explore products
              </Link>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {wishlist.map((item) => (
                <WishlistCard key={item.id} item={item} onRemove={removeFromWishlist} />
              ))}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
