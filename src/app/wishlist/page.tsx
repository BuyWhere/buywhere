import type { Metadata } from "next";
import WishlistPageClient from "@/components/WishlistPageClient";
import { buildPageMetadata } from "@/lib/page-metadata";

const WISHLIST_TITLE = "Wishlist - BuyWhere";
const WISHLIST_DESCRIPTION = "Track saved products and revisit price changes across BuyWhere.";

export const metadata: Metadata = buildPageMetadata({
  title: WISHLIST_TITLE,
  description: WISHLIST_DESCRIPTION,
  path: "/wishlist",
});

export default function WishlistPage() {
  return <WishlistPageClient />;
}
