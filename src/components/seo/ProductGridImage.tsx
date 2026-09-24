"use client";

import { useState } from "react";

interface ProductGridImageProps {
  src: string;
  alt: string;
  brand?: string | null;
  merchant?: string;
  // BUY-69167: the upstream category label (e.g. "Robot Vacuums"). When the
  // <img> fires onError we fall through to the inline BrandedPlaceholder —
  // pick the category-appropriate silhouette so the fallback matches the
  // page instead of always rendering the generic laptop-looking icon.
  category?: string | null;
  className?: string;
}

function isCatalogPhotoSrc(src?: string | null): boolean {
  if (!src) return false;
  if (src.startsWith("data:image/svg")) return false;
  return src.startsWith("http") || src.startsWith("/api/image-proxy");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ProductGridImage({ src, alt, brand, merchant, category, className }: ProductGridImageProps) {
  const [hasError, setHasError] = useState(false);

  // BUY-79843: never SSR the branded SVG wireframe into Live Catalog Snapshot.
  // VidMee treats inline <svg> as an empty catalog even when titles/prices exist.
  if (hasError || !isCatalogPhotoSrc(src)) {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-slate-100"
        data-missing-catalog-photo=""
        aria-hidden="true"
      />
    );
  }

  // BUY-65158: Use a plain <img> (not next/image) so the SSR HTML shows the
  // image directly on first paint. next/image + loading="lazy" causes a visible
  // loading flash where the background gradient (or empty box) is rendered
  // before the image resolves — QA saw this as "static noise/wireframe" on
  // /best-gaming-laptops-us and /air-purifier-singapore.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer-when-downgrade"
      className={className ?? "h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"}
      onError={() => setHasError(true)}
    />
  );
}
