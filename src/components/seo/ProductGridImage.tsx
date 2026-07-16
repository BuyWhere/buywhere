"use client";

import { useState } from "react";
import Image from "next/image";

interface ProductGridImageProps {
  src: string;
  alt: string;
  brand?: string | null;
  merchant?: string | null;
}

export function ProductGridImage({ src, alt, brand, merchant }: ProductGridImageProps) {
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    const initials = (brand || merchant || "?")
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();

    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
        <span className="text-2xl font-bold text-slate-400">{initials}</span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
      className="object-contain transition-transform duration-300 group-hover:scale-105"
      onError={() => setErrored(true)}
    />
  );
}
