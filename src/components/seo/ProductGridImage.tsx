"use client";

import { useState } from "react";

interface ProductGridImageProps {
  src: string;
  alt: string;
  brand?: string | null;
  merchant?: string;
  className?: string;
}

function Placeholder({ alt, brand, merchant }: { alt: string; brand?: string | null; merchant?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-slate-100 p-4 text-center">
      <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 text-slate-400">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a2.25 2.25 0 002.25-2.25V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
        </svg>
      </div>
      <span className="text-sm font-semibold leading-tight text-slate-600 line-clamp-2">{alt}</span>
      {(brand || merchant) && (
        <span className="mt-1 text-xs text-slate-400">{brand || merchant}</span>
      )}
    </div>
  );
}

export function ProductGridImage({ src, alt, brand, merchant, className }: ProductGridImageProps) {
  const [hasError, setHasError] = useState(false);

  if (hasError || !src) {
    return <Placeholder alt={alt} brand={brand} merchant={merchant} />;
  }

  // Use a plain <img> (not next/image) so the SSR HTML shows the image
  // directly on first paint. next/image + loading="lazy" causes a visible
  // loading flash where the background gradient (or empty box) is rendered
  // before the image resolves — QA saw this as "static noise/wireframe".
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer-when-downgrade"
      className={className ?? "h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"}
      onError={() => setHasError(true)}
    />
  );
}
