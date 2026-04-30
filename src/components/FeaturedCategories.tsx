import Link from "next/link";

interface Category {
  slug: string;
  name: string;
  icon: React.ReactNode;
  productCount: number;
  color: string;
}

const categories: Category[] = [
  {
    slug: "electronics",
    name: "Electronics",
    productCount: 342891,
    color: "text-blue-600",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
  {
    slug: "home-living",
    name: "Home Appliances",
    productCount: 198234,
    color: "text-emerald-600",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 9h18M5 9v11a1 1 0 001 1h12a1 1 0 001-1V9M5 9a2 2 0 012-2h10a2 2 0 012 2M7 9V6a2 2 0 012-2h6a2 2 0 012 2v3" />
      </svg>
    ),
  },
  {
    slug: "fashion",
    name: "Fashion",
    productCount: 267432,
    color: "text-pink-600",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0" />
      </svg>
    ),
  },
  {
    slug: "beauty-health",
    name: "Beauty",
    productCount: 156782,
    color: "text-purple-600",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 3h6v4l2 2v11a1 1 0 01-1 1H8a1 1 0 01-1-1V9l2-2V3zM12 3v4M9 13h6" />
      </svg>
    ),
  },
  {
    slug: "health",
    name: "Health",
    productCount: 89234,
    color: "text-red-600",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      </svg>
    ),
  },
  {
    slug: "sports-outdoors",
    name: "Sports",
    productCount: 124891,
    color: "text-orange-600",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    slug: "grocery",
    name: "Kitchen",
    productCount: 68429,
    color: "text-amber-600",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2M7 2v20M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" />
      </svg>
    ),
  },
  {
    slug: "toys-games",
    name: "Gaming",
    productCount: 156782,
    color: "text-indigo-600",
    icon: (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="6" width="20" height="12" rx="3" />
        <path d="M6 12h4M8 10v4M15 11h1M15 13h1M17 11h.5M17 13h.5" />
      </svg>
    ),
  },
];

function formatCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M+`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(0)}K+`;
  }
  return `${count}+`;
}

export function FeaturedCategories() {
  return (
    <section className="py-16 bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between mb-10">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Featured Categories</h2>
            <p className="text-sm text-gray-500 mt-1">Browse top categories across all retailers</p>
          </div>
          <Link
            href="/categories"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            View all →
          </Link>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {categories.map((category) => (
            <Link
              key={category.slug}
              href={`/categories/${category.slug}`}
              className="group bg-white p-5 border border-gray-100 rounded-xl hover:border-indigo-200 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
            >
              <div className="flex flex-col gap-3">
                <div className={`w-12 h-12 flex items-center justify-center rounded-lg bg-gray-50 text-gray-600 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors ${category.color}`}>
                  {category.icon}
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-900 group-hover:text-indigo-700 transition-colors">
                    {category.name}
                  </h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {formatCount(category.productCount)} products
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}