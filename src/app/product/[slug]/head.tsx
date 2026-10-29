// BUY-70240: Next.js Metadata API rejects Open Graph's "product" object type
// at runtime, so we emit the og:type tag from a route-level head.tsx instead.
// og:type=product tells social crawlers this is a product page for rich previews.
export default function ProductHead() {
  return <meta property="og:type" content="product" />;
}
