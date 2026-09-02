"use client";

import { useWishlist, type WishlistProductInput } from "@/lib/wishlist-context";

interface WishlistButtonProps {
  product: WishlistProductInput;
  variant?: "icon" | "pill";
  className?: string;
}

export default function WishlistButton({
  product,
  variant = "icon",
  className = "",
}: WishlistButtonProps) {
  const { isInWishlist, toggleWishlist } = useWishlist();
  const active = isInWishlist(product.id);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    toggleWishlist(product);
  };

  if (variant === "pill") {
    return (
      <button
        onClick={handleClick}
        className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
          active
            ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
            : "border-white/20 bg-white/10 text-white hover:bg-white/20"
        } ${className}`}
        aria-label={active ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
          />
        </svg>
        {active ? "Saved" : "Save"}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full border shadow-sm transition-all ${
        active
          ? "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
          : "border-white/70 bg-white/95 text-slate-400 hover:border-amber-200 hover:text-rose-600"
      } ${className}`}
      aria-label={active ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
        />
      </svg>
    </button>
  );
}
