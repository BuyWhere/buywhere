import type { Metadata } from "next";
import WishlistPageClient from "@/components/WishlistPageClient";

export const metadata: Metadata = {
  title: "Wishlist - BuyWhere",
  description: "Track saved products and revisit price changes across BuyWhere.",
};

export default function WishlistPage() {
  return <WishlistPageClient />;
}
