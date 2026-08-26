import type { CategoryProduct, CategoryProductCountry } from "@/lib/category-products";
import { getCategoryProductLocale } from "@/lib/category-products";

function formatPrice(price: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}

function formatCheckedDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function CategoryProductGrid({
  products,
  country,
  title,
  description,
}: {
  products: CategoryProduct[];
  country: CategoryProductCountry;
  title: string;
  description?: string;
}) {
  if (products.length === 0) return null;

  const locale = getCategoryProductLocale(country);
  const checkedAt = new Date();
  const checkedIso = checkedAt.toISOString();
  const checkedLabel = formatCheckedDate(checkedAt);

  return (
    <section
      aria-labelledby="category-products-heading"
      data-ssr-category-products={country.toLowerCase()}
      data-ssr-prices-checked={checkedIso}
      className="py-16 bg-white"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="max-w-3xl mb-8">
          <h2 id="category-products-heading" className="text-2xl md:text-3xl font-bold text-gray-900 mb-3">
            {title}
          </h2>
          {description ? <p className="text-lg text-gray-600 mb-3">{description}</p> : null}
          <p className="text-sm text-gray-500">
            Prices checked <time dateTime={checkedIso}>{checkedLabel}</time>. BuyWhere found {products.length}{" "}
            live product{products.length === 1 ? "" : "s"} with merchant redirect links.
          </p>
        </div>

        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((product) => {
            const displayPrice = formatPrice(product.price, product.currency, locale);
            return (
              <li key={`${product.id}-${product.href}`}>
                <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-shadow hover:shadow-md">
                  {product.imageUrl ? (
                    <div className="aspect-[4/3] bg-gray-50">
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        loading="lazy"
                        className="h-full w-full object-contain p-4"
                      />
                    </div>
                  ) : null}
                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500" data-merchant={product.merchant}>
                      {product.merchant}
                    </div>
                    <h3 className="line-clamp-3 text-base font-semibold leading-snug text-gray-900">
                      {product.name}
                    </h3>
                    {product.brand ? <p className="text-sm text-gray-600">{product.brand}</p> : null}
                    <div className="mt-auto space-y-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-gray-500">Current price</p>
                        <p className="text-xl font-bold text-indigo-700" data-price={product.price}>
                          {displayPrice}
                        </p>
                        <p className="text-sm text-gray-500">{product.availability}</p>
                      </div>
                      <a
                        href={product.href}
                        rel="nofollow sponsored"
                        className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                      >
                        View at {product.merchant}
                      </a>
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
