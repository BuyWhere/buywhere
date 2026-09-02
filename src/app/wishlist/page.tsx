import Schema from "@/components/Schema";
import WishlistPageClient from "@/components/WishlistPageClient";
import { buildPageMetadata } from "@/lib/page-metadata";
import { buildWebPageSchema } from "@/lib/page-schema";

const WISHLIST_TITLE = "Saved Products to Track | BuyWhere";
const WISHLIST_DESCRIPTION = "Track saved products and revisit price changes across BuyWhere.";

export const metadata = buildPageMetadata({
  title: WISHLIST_TITLE,
  description: WISHLIST_DESCRIPTION,
  path: "/wishlist",
});

export default function WishlistPage() {
  const schema = buildWebPageSchema({
    path: "/wishlist",
    name: WISHLIST_TITLE,
    description: WISHLIST_DESCRIPTION,
    breadcrumb: [
      { name: "Home", path: "/" },
      { name: "Wishlist", path: "/wishlist" },
    ],
  });

  return (
    <>
      <Schema data={schema} />
      <WishlistPageClient />
    </>
  );
}
