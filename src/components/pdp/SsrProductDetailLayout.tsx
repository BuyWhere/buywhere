import type { ReactNode } from "react";

export type SsrPdpCrumbs = Array<{ href?: string; label: string }>;

/**
 * BUY-82738: desktop PDP was a mobile stack (image full-width, then copy),
 * leaving a ~420px dead zone at 1440px and pushing price + View Deal below
 * the fold. Shared SSR layout: stacked <md, 2-col grid ≥md, wrapping crumbs,
 * title clamp-2 with native tooltip.
 */
export function SsrProductDetailLayout({
  crumbs,
  imageUrl,
  imageAlt,
  title,
  brand,
  priceLabel,
  cta,
  availability,
  description,
  category,
}: {
  crumbs: SsrPdpCrumbs;
  imageUrl?: string | null;
  imageAlt: string;
  title: string;
  brand?: string | null;
  priceLabel?: string | null;
  cta: ReactNode;
  availability: ReactNode;
  description?: string | null;
  category?: string | null;
}) {
  return (
    <main id="main-content" className="max-w-6xl mx-auto px-4 sm:px-6 py-8 min-w-0">
      <nav aria-label="breadcrumb" className="mb-6 text-sm text-gray-500 min-w-0">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          {crumbs.map((crumb, i) => (
            <li key={`${crumb.label}-${i}`} className="flex min-w-0 max-w-full items-center gap-x-2">
              {i > 0 ? <span aria-hidden="true">/</span> : null}
              {crumb.href ? (
                <a href={crumb.href} className="hover:text-indigo-600 shrink-0">
                  {crumb.label}
                </a>
              ) : (
                <span className="text-gray-900 font-medium break-words min-w-0" title={title}>
                  {crumb.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <div
        data-pdp-hero
        className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden grid grid-cols-1 md:grid-cols-[minmax(240px,1fr)_minmax(320px,1fr)] gap-0"
      >
        {imageUrl ? (
          <div className="bg-gray-50 flex items-center justify-center p-4 md:p-6 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={imageAlt}
              className="w-full max-h-64 md:max-h-[28rem] object-contain"
            />
          </div>
        ) : null}

        <div className="p-6 min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 mb-2 line-clamp-2" title={title}>
            {title}
          </h1>

          {brand ? (
            <p className="text-sm text-gray-500 mb-4">
              by <span className="text-gray-700 font-medium">{brand}</span>
            </p>
          ) : null}

          {priceLabel ? (
            <div className="mb-4">
              <span className="text-3xl font-bold text-indigo-600">{priceLabel}</span>
            </div>
          ) : null}

          {cta}

          {availability}

          {description ? (
            <div className="prose prose-sm text-gray-700 mt-4">
              <p>{description}</p>
            </div>
          ) : null}

          {category ? <p className="mt-4 text-xs text-gray-500">Category: {category}</p> : null}
        </div>
      </div>
    </main>
  );
}

export const PDP_PRIMARY_CTA_CLASS =
  "inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2";
