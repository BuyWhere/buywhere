/** Title-case a brand slug for display when the catalog never returned a name. */
export function displayBrandName(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/** BUY-78751: generateMetadata for a valid brand whose catalog fetch failed. */
export function brandCatalogErrorMetadata(slug: string) {
  const name = displayBrandName(slug);
  return {
    title: `${name} — temporarily unavailable | BuyWhere`,
    robots: { index: false, follow: true, nocache: true, noarchive: true },
    other: {
      "x-robots-tag": "noindex, noarchive",
    },
  };
}
