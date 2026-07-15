"use client";

import React from "react";
import Image from "next/image";
import type { LandingProduct } from "@/lib/seo-landing-pages";

function buildCategoryImage(product: LandingProduct) {
  const label = encodeURIComponent(product.category || product.brand || product.name);
  const brand = encodeURIComponent(product.brand || "BuyWhere");
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 420'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop stop-color='%23eff6ff'/%3E%3Cstop offset='1' stop-color='%23fef3c7'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='420' fill='url(%23g)'/%3E%3Crect x='118' y='92' width='404' height='236' rx='32' fill='white' stroke='%23cbd5e1' stroke-width='6'/%3E%3Ccircle cx='470' cy='142' r='26' fill='%23f59e0b'/%3E%3Cpath d='M196 272h248M226 218h188M256 164h128' stroke='%230f172a' stroke-width='18' stroke-linecap='round'/%3E%3Ctext x='320' y='374' text-anchor='middle' font-family='Arial,sans-serif' font-size='30' font-weight='700' fill='%230f172a'%3E${label}%3C/text%3E%3Ctext x='320' y='404' text-anchor='middle' font-family='Arial,sans-serif' font-size='18' fill='%23475569'%3E${brand}%3C/text%3E%3C/svg%3E`;
}

export function ProductGridImage({ product }: { product: LandingProduct }) {
  const [imageError, setImageError] = React.useState(false);
  const fallbackImageUrl = buildCategoryImage(product);
  const imageUrl = product.imageUrl || fallbackImageUrl;
  const displayUrl = imageError ? fallbackImageUrl : imageUrl;

  return (
    <Image
      src={displayUrl}
      alt={product.name}
      fill
      sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 25vw"
      unoptimized={displayUrl.startsWith("data:image/svg+xml")}
      onError={() => setImageError(true)}
      className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
    />
  );
}
